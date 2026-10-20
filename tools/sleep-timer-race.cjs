'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron}=require('../app/node_modules/playwright-core');
async function wait(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out');}
test('expiry cancels delayed search playback while playing, paused and idle',async t=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-sleep-race-'));
 const track={key:'netease:700000001',platform:'netease',sourceId:'700000001',url:'https://music.163.com/song?id=700000001',title:'Review PCM 1',artist:'Synthetic'};
 fs.writeFileSync(path.join(profile,'library.json'),JSON.stringify({tracks:[track],queue:[track.key],muted:true,volume:0}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('../app/node_modules/electron'),args:[path.join(__dirname,'sleep-timer-race-fixture.cjs'),'--test-mode','--data-dir='+profile],env});
 t.after(async()=>{await app.close();fs.rmSync(profile,{recursive:true,force:true});});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='已就绪');
 const state=()=>page.evaluate(()=>window.playerAPI.getState());
 for(const status of ['playing','paused','idle']){
  await page.evaluate(key=>window.playerAPI.command('play',{key}),track.key);
  await wait(async()=>{const s=await state();return s.status==='playing'&&s.positionMs>150;});
  if(status!=='playing'){
   await page.evaluate(()=>window.playerAPI.command('pause'));
   await app.evaluate(({app},s)=>app.__mixSleepTest.forceStatus(s),status);
  }
  await page.evaluate(async()=>{
   const q=await window.playerAPI.search({platform:'netease',query:'synthetic'});
   window.pendingSearchPlay=window.playerAPI.playSearchResult({requestId:q.requestId,platform:'netease',id:'700000002'});
  });
  assert.equal(await app.evaluate(()=>typeof global.__releaseImport),'function');
  await app.evaluate(({app})=>app.__mixSleepTest.startSeconds(.2));
  await wait(async()=>await app.evaluate(({app})=>!app.__mixSleepTest.state().active));
  await wait(async()=>(await state()).status===(status==='playing'?'paused':status));
  const before=await state();
  await app.evaluate(()=>global.__releaseImport());
  assert.equal((await page.evaluate(()=>window.pendingSearchPlay)).canceled,true);
  const after=await state();
  for(const key of ['currentKey','status','positionMs','queue','playbackQueue'])assert.deepEqual(after[key],before[key]);
 }
 // Fresh user intent after expiry remains playable.
 await page.evaluate(key=>window.playerAPI.command('play',{key}),track.key);
 await wait(async()=>(await state()).status==='playing');
});
