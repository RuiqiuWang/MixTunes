'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium,_electron}=require('../app/node_modules/playwright-core');
const {installSearchFixture,installNativeFixture}=require('./search-add-fixture.cjs');
const root=path.resolve(__dirname,'..');
const track={key:'netease:700000001',platform:'netease',sourceId:'700000001',url:'https://music.163.com/song?id=700000001',title:'Review PCM 1',artist:'Synthetic',durationMs:180000};
function library(){return{schemaVersion:2,tracks:[track],playlists:[{id:'source',name:'Actual source',queue:[track.key],currentKey:track.key,mode:'sequential'},{id:'other',name:'Other membership',queue:[track.key],mode:'shuffle'}],activePlaylistId:'source',queue:[track.key],currentKey:track.key,muted:true,volume:0};}
const state=page=>page.evaluate(()=>window.playerAPI.getState());
function preserved(before,after,{advancing=false}={}){
  for(const key of ['currentKey','generation','playbackPlaylistId','playbackQueue','tracks','playlists','mode'])assert.deepEqual(after[key],before[key],key);
  if(advancing){assert.ok(['playing','buffering'].includes(before.status));assert.ok(['playing','buffering'].includes(after.status));}
  else assert.equal(after.status,before.status);
  if(advancing)assert.ok(after.positionMs>=before.positionMs&&after.positionMs-before.positionMs<2500,`progress ${before.positionMs} -> ${after.positionMs}`);
  else assert.equal(after.positionMs,before.positionMs);
}
async function select(page,id){await page.evaluate(id=>window.playerAPI.command('playlist-select',{id}),id);}
async function locate(page,mobile){await page.locator('#locate-playing').click();await page.locator(mobile?'.song-row.located':'tr.located').waitFor();}
async function markedInBoth(page,mobile){
  if(mobile){await page.locator('[data-screen="search"]').click();await page.locator('#search-query').fill('controlled');await page.locator('#search-submit').click();}
  else{await page.locator('#open-online-search').click();await page.locator('#online-search-query').fill('controlled');await page.locator('#online-search-submit').click();}
  await page.waitForFunction(mobile=>{
    const b=document.querySelector(mobile?'.search-result[data-platform="netease"] .result-add':'.online-result[data-platform="netease"] [data-testid="online-result-add"]');
    return b?.dataset.added==='2';
  },mobile);
  if(!mobile)await page.locator('#close-online-search').click();
}
async function launch(t,synthetic){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-locate-'));fs.writeFileSync(path.join(data,'library.json'),JSON.stringify(library()));
  const exe=synthetic?require('../app/node_modules/electron'):process.env.MIXTUNES_LOCATE_EXECUTABLE;
  assert.ok(exe&&fs.existsSync(exe),'Set MIXTUNES_LOCATE_EXECUTABLE to this branch packaged EXE');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:exe,args:[...(synthetic?[path.join(__dirname,'sleep-timer-race-fixture.cjs')]:[]),'--test-mode','--data-dir='+data],env});
  t.after(()=>app.close().catch(()=>{}));
  const page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='已就绪');
  return{app,page};
}
test('packaged Windows locate uses real IPC/engine/store and coexists with P03 multiple-playlist marks',{timeout:60000,skip:process.platform!=='win32'},async t=>{
  const {app,page}=await launch(t,false);
  await app.evaluate(({app},installer)=>{
    const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
    eval('('+installer+')')(req('./src/search-service.cjs').SearchService);
    globalThis.__p03Fixture.ids.netease='700000001';
  },installSearchFixture.toString());
  await select(page,'other');await markedInBoth(page,false);
  await page.locator('#search-input').fill('hidden by filter');await page.locator('[data-filter="qq"]').click();
  const before=await state(page);await locate(page,false);const after=await state(page);
  preserved(before,after);assert.equal(after.activePlaylistId,'source');
  assert.equal(await page.locator('#search-input').inputValue(),'');
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'),'true');
  await markedInBoth(page,false);assert.equal((await app.evaluate(()=>globalThis.__p03Fixture.adds)),0);
  assert.equal((await state(page)).status,'paused');
});
test('real Electron with synthetic PCM keeps playing through cross-playlist locate and stays paused after pause',{timeout:60000,skip:process.platform!=='win32'},async t=>{
  const {app,page}=await launch(t,true);
  await page.evaluate(key=>window.playerAPI.command('play',{key,playlistId:'source'}),track.key);
  await page.waitForFunction(async()=>{const s=await window.playerAPI.getState();return s.status==='playing'&&s.positionMs>150;});
  await select(page,'other');
  await app.evaluate(()=>{
    globalThis.__p05BackendCalls=[];
    for(const name of ['pause','seek','activate','load','stopAll']){
      const original=globalThis.__reviewAudio[name];
      if(typeof original==='function')globalThis.__reviewAudio[name]=function(...args){globalThis.__p05BackendCalls.push(name);return original.apply(this,args);};
    }
  });
  const before=await state(page);await locate(page,false);preserved(before,await state(page),{advancing:true});
  assert.deepEqual(await app.evaluate(()=>globalThis.__p05BackendCalls),[]);
  await page.waitForFunction(async()=>(await window.playerAPI.getState()).status==='playing');
  await page.evaluate(()=>window.playerAPI.command('pause'));await select(page,'other');
  await app.evaluate(()=>{globalThis.__p05BackendCalls=[];});
  const paused=await state(page);await locate(page,false);preserved(paused,await state(page));
  assert.deepEqual(await app.evaluate(()=>globalThis.__p05BackendCalls),[]);
  assert.equal((await state(page)).status,'paused');
});
test('generated Android runtime locates from search without native playback calls and retains P03 marks',{timeout:60000},async t=>{
  const browser=await chromium.launch({channel:process.env.MIXTUNES_TEST_BROWSER||'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:760},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());if(u.origin!=='http://mixtunes.test')return route.abort();
    const f=u.pathname.slice(1)||'index.html';if(!['index.html','styles.css','ui.js','runtime.js'].includes(f))return route.abort();
    return route.fulfill({body:fs.readFileSync(path.join(root,'android/web',f)),contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/javascript'});
  });
  const native=fs.readFileSync(path.join(root,'android/native/src/local/mixtunes/mobile/NativeBridge.java'),'utf8');
  await page.addInitScript(installNativeFixture,{library:library(),methods:[...native.matchAll(/case "([^"]+)"/g)].map(m=>m[1])});
  await page.goto('http://mixtunes.test/');await page.waitForFunction(()=>window.mobileUI&&window.playerAPI);
  await page.evaluate(installer=>{
    eval('('+installer+')')(window.__mixRequire('./search-service.cjs').SearchService);globalThis.__p03Fixture.ids.netease='700000001';
    const p=window.__mixRequire('./engine.cjs').PlayerEngine.prototype,original=p.selectPlaylist;
    p.selectPlaylist=function(...args){window.__p05Engine=this;return original.apply(this,args);};
  },installSearchFixture.toString());
  for(const status of ['paused','playing']){
    await select(page,'other');await page.evaluate(status=>{__p05Engine.state.status=status;__p05Engine.state.positionMs=42123;__p05Engine.publish();},status);
    await markedInBoth(page,true);const before=await state(page);
    await page.evaluate(()=>{window.__nativeCalls=[];});await locate(page,true);const after=await state(page);
    preserved(before,after);assert.equal(after.activePlaylistId,'source');
    const calls=await page.evaluate(()=>window.__nativeCalls);assert.ok(calls.every(m=>['storage-save','theme'].includes(m)),JSON.stringify(calls));
    assert.equal(await page.locator('#screen-library').isVisible(),true);await markedInBoth(page,true);
  }
});
