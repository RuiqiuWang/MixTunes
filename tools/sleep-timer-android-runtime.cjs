'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('../app/node_modules/playwright-core');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'android/web/runtime.js'),'utf8');
const nativeSource=fs.readFileSync(path.join(root,'android/native/src/local/mixtunes/mobile/NativeBridge.java'),'utf8');
const timerMethods=[...nativeSource.matchAll(/case "(sleep-timer-[^"]+)"/g)].map(m=>m[1]);

test('generated Android runtime connects sleep timer UI to native methods and the real engine',async t=>{
  const browser=await chromium.launch({channel:process.env.MIXTUNES_TEST_BROWSER||'msedge',headless:true});
  t.after(()=>browser.close());
  async function fixture(){
    const page=await browser.newPage();t.after(()=>page.close());
    await page.route('http://mixtunes.test/',r=>r.fulfill({contentType:'text/html',body:'<html><body><div id="anchor"></div></body></html>'}));
    await page.goto('http://mixtunes.test/');
    await page.evaluate(methods=>{
      window.nativeCalls=[];window.timer={active:false,endsAt:null,remainingMs:0,minutes:null};
      const track={key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'Fixture',durationMs:180000};
      const library={schemaVersion:2,tracks:[track],playlists:[{id:'source',name:'Source',queue:[track.key],currentKey:track.key}],activePlaylistId:'source',currentKey:track.key,queue:[track.key]};
      window.MixTunesBridge={postMessage(text){
        const {id,method,payload}=JSON.parse(text);window.nativeCalls.push({method,payload});
        let value=true,error;
        if(method==='storage-load')value={json:JSON.stringify(library)};
        else if(method==='cookies')value=[];
        else if(method==='fetch'||method==='share-fetch')error='Network disabled in isolated fixture';
        else if(method.startsWith('sleep-timer-')){
          if(!methods.includes(method))error='Unsupported native method: '+method;
          else{
            if(method==='sleep-timer-set')window.timer={active:true,minutes:payload.minutes,endsAt:Date.now()+payload.minutes*60000,remainingMs:payload.minutes*60000};
            if(method==='sleep-timer-cancel')window.timer={active:false,endsAt:null,remainingMs:0,minutes:null};
            value={ok:true,...window.timer};
          }
        }else if(method==='audio-load')value={token:'native-fixture',key:payload.key,generation:payload.generation};
        queueMicrotask(()=>window.__mixNativeReply({id,ok:!error,value,error}));
      }};
    },timerMethods);
    await page.addScriptTag({content:runtime});
    await page.evaluate(async()=>{
      const proto=window.__mixRequire('./engine.cjs').PlayerEngine.prototype,original=proto.snapshot;
      proto.snapshot=function(){window.fixtureEngine=this;return original.call(this);};
      await window.playerAPI.getState();
      window.fixtureEngine.resolveTrack=async()=>({url:'https://m.music.126.net/fixture.mp3'});
      window.timerPanel=window.mixTunesSleepTimer.mount({api:window.playerAPI,anchor:document.getElementById('anchor')});
    });
    return page;
  }
  await t.test('get/set/cancel and remount use native state, including get-to-state mapping',async()=>{
    const page=await fixture();
    await page.locator('[data-sleep-minutes="15"]').click();
    assert.equal((await page.evaluate(()=>window.playerAPI.sleepTimer('get'))).minutes,15);
    assert.ok((await page.evaluate(()=>window.nativeCalls)).some(c=>c.method==='sleep-timer-state'));
    await page.evaluate(()=>{window.timerPanel.destroy();window.timerPanel=window.mixTunesSleepTimer.mount({api:window.playerAPI,anchor:document.getElementById('anchor')});});
    await page.waitForFunction(()=>document.getElementById('sleep-timer-status').textContent.includes('15 分'));
    await page.locator('#sleep-timer-cancel').click();
    assert.equal((await page.evaluate(()=>window.playerAPI.sleepTimer('get'))).active,false);
  });
  await t.test('native expiry pauses the runtime engine while preserving position and queues',async()=>{
    const page=await fixture();
    await page.evaluate(async()=>{
      const engine=window.fixtureEngine;await engine.playKey('netease:1');
      engine.onEvent({type:'playing',key:'netease:1',generation:engine.generation});
      engine.onEvent({type:'progress',key:'netease:1',generation:engine.generation,positionMs:23456,durationMs:180000});
    });
    const before=await page.evaluate(()=>window.playerAPI.getState());assert.equal(before.status,'playing');
    const previousCalls=await page.evaluate(()=>window.nativeCalls.length);
    await page.evaluate(()=>window.__mixNativeEvent({type:'sleep-timer-expired'}));
    await page.waitForFunction(()=>window.playerAPI.getState().then(s=>s.status==='paused'));
    const after=await page.evaluate(()=>window.playerAPI.getState());
    for(const key of ['currentKey','positionMs','queue','playbackQueue','playbackPlaylistId','playlists'])assert.deepEqual(after[key],before[key],key);
    // The original engine.pause() uses stopBackends -> audio-stop, retaining
    // pending position/queue state; do not require a different playback design.
    const calls=(await page.evaluate(()=>window.nativeCalls)).slice(previousCalls);
    assert.equal(calls.filter(c=>c.method==='audio-stop').length,1);
    assert.equal(calls.filter(c=>c.method==='audio-activate').length,0);
  });
  await t.test('paused expiry never sends play/pause and resume refreshes authority state',async()=>{
    const page=await fixture();
    await page.evaluate(()=>{window.fixtureEngine.state.status='paused';window.nativeCalls=[];window.__mixNativeEvent({type:'sleep-timer-expired'});});
    await page.waitForTimeout(100);
    assert.equal((await page.evaluate(()=>window.playerAPI.getState())).status,'paused');
    assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>['audio-stop','audio-pause','audio-activate','video-play','web-play'].includes(c.method)).length,0);
    await page.evaluate(()=>{window.timer={active:true,minutes:5,endsAt:Date.now()+300000,remainingMs:300000};window.__mixNativeEvent({type:'accounts-refresh'});});
    await page.waitForFunction(()=>document.getElementById('sleep-timer-status').textContent.includes('5 分'));
  });
  for (const status of ['playing', 'paused', 'idle']) await t.test('expiry cancels delayed search playback from '+status,async()=>{
    const page=await fixture();
    await page.evaluate(async status=>{
      window.fixtureEngine.state.status=status;
      let serial=0;
      window.MixTunesBridge.crypto=text=>{
        const request=JSON.parse(text);
        if(request.op==='randomUUID')return JSON.stringify({ok:true,value:'00000000-0000-4000-8000-'+String(++serial).padStart(12,'0')});
        return JSON.stringify({ok:false,error:'Unexpected fixture crypto operation'});
      };
      const proto=window.__mixRequire('./search-service.cjs').SearchService.prototype, original=proto.search;
      proto.search=async function(payload){
        this.searchPlatform=async()=>({items:[{platform:'netease',id:'2',url:'https://music.163.com/song?id=2',title:'Delayed'}],total:1});
        this.importResource=()=>new Promise(resolve=>{window.releaseImport=()=>resolve({tracks:[{platform:'netease',sourceId:'2',key:'netease:2',url:'https://music.163.com/song?id=2',title:'Delayed'}]});});
        return original.call(this,payload);
      };
      const q=await window.playerAPI.search({platform:'netease',query:'Delayed'});
      if(!q.ok)throw Error(q.error);
      window.pendingPlay=window.playerAPI.playSearchResult({requestId:q.requestId,platform:'netease',id:'2'});
    },status);
    await page.waitForFunction(()=>typeof window.releaseImport==='function');
    await page.evaluate(()=>window.__mixNativeEvent({type:'sleep-timer-expired'}));
    // A following IPC snapshot runs after the queued native-event handler.
    const atExpiry=await page.evaluate(()=>window.playerAPI.getState());
    await page.evaluate(()=>window.releaseImport());
    assert.equal((await page.evaluate(()=>window.pendingPlay)).canceled,true);
    const after=await page.evaluate(()=>window.playerAPI.getState());
    assert.equal(after.currentKey,atExpiry.currentKey);
    assert.equal(after.status,status==='playing'?'paused':status);
    assert.equal((await page.evaluate(()=>window.nativeCalls)).filter(c=>c.method==='audio-activate').length,0);
  });
});
