'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');const {chromium}=require('../app/node_modules/playwright-core');
const tracks=['BV17x411w7KC','BV1xx411c7mD'].map(id=>({key:'bilibili:'+id,sourceId:id,platform:'bilibili',url:'https://www.bilibili.com/video/'+id+'/',title:id,durationMs:120000}));
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.MIXTUNES_BROWSER?{executablePath:process.env.MIXTUNES_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.addInitScript(tracks=>{
   window.testCalls=[];
   window.MixTunesBridge={crypto:()=>JSON.stringify({ok:true,value:crypto.randomUUID()}),postMessage(text){
    const p=JSON.parse(text);window.testCalls.push(p);let value=true,error=null;
    if(p.method==='storage-load')value={json:JSON.stringify({tracks,queue:tracks.map(t=>t.key)})};
    else if(p.method==='cookies')value=[];
    else if(p.method==='fetch')error='测试不访问网络';
    queueMicrotask(()=>window.__mixNativeReply({id:p.id,ok:!error,value,error}));
   }};
  },tracks);
  await page.goto(pathToFileURL(path.join(__dirname,'web/index.html')).href);await page.waitForFunction(()=>!!window.playerAPI);
  await page.evaluate(async key=>{await window.playerAPI.command('video-panel',{open:true});await window.playerAPI.command('play',{key});},tracks[0].key);
  let state=await page.evaluate(()=>window.playerAPI.getState());const generation=state.generation;
  await page.evaluate(({key,generation})=>{window.__mixNativeEvent({type:'video',event:{type:'playing',key,generation}});window.__mixNativeEvent({type:'video',event:{type:'progress',key,generation,positionMs:34000,durationMs:120000}});window.testCalls=[];window.__mixNativeEvent({type:'video-panel-hidden'});},{key:tracks[0].key,generation});
  await page.waitForFunction(()=>window.testCalls.some(p=>p.method==='video-layout'&&p.payload.visible===false));
  state=await page.evaluate(()=>window.playerAPI.getState());assert.equal(state.status,'playing');assert.equal(state.backend,'video');assert.equal(state.videoPanel.open,false);assert.equal(state.generation,generation);
  assert.equal(await page.evaluate(()=>window.testCalls.some(p=>['video-pause','video-close','video-load'].includes(p.method))),false);
  await page.evaluate(({key,generation})=>window.__mixNativeEvent({type:'video',event:{type:'progress',key,generation,positionMs:39000,durationMs:120000}}),{key:tracks[0].key,generation});
  await page.evaluate(()=>window.playerAPI.command('video-open'));
  state=await page.evaluate(()=>window.playerAPI.getState());assert.equal(state.positionMs,39000);assert.equal(state.videoPanel.open,true);assert.equal(state.generation,generation);
  assert.equal(await page.evaluate(()=>window.testCalls.some(p=>['cookies','video-load','video-play','video-seek'].includes(p.method))),false);
  await page.evaluate(async()=>{await window.playerAPI.command('pause');await window.playerAPI.command('video-panel',{open:false});await window.playerAPI.command('video-open');});
  assert.equal((await page.evaluate(()=>window.playerAPI.getState())).status,'paused');
  await page.evaluate(async()=>{await window.playerAPI.command('video-panel',{open:false});await window.playerAPI.command('next');});
  const load=await page.evaluate(()=>window.testCalls.filter(p=>p.method==='video-load').at(-1));assert.equal(load.payload.key,tracks[1].key);assert.equal(load.payload.visible,false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['native hide event keeps playing','hidden progress accepted','reopen avoids account check and reload','paused reopen stays paused','next video starts hidden'],nativeBridgeMocked:true,physicalDeviceUsed:false}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
