'use strict';
const {_electron}=require('playwright-core');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=path.resolve(__dirname,'../dist/native-qa-profile');fs.mkdirSync(profile,{recursive:true});
 const track={key:'netease:1',platform:'netease',sourceId:'1',title:'Native IPC test',url:'https://music.163.com/song?id=1',coverUrl:'http://p1.music.126.net/test.jpg'};
 fs.writeFileSync(path.join(profile,'library.json'),JSON.stringify({tracks:[track],queue:[track.key]}));
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),'--test-mode','--data-dir='+profile]});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.playerAPI&&document.querySelector('[data-testid="track-row"]'));
  const state=await page.evaluate(()=>playerAPI.getState());assert.equal(state.tracks[0].coverUrl,'https://p1.music.126.net/test.jpg');
  await page.locator('#volume').evaluate(el=>{el.value=.42;el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(async()=>(await playerAPI.getState()).volume===.42);
  await page.locator('#volume').dispatchEvent('change');
  await page.waitForFunction(async()=>(await playerAPI.getState()).volume===.42);
  await page.waitForTimeout(100);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'library.json'),'utf8')).volume,.42);
  const removed=await page.evaluate(key=>playerAPI.command('remove-many',{keys:[key]}),track.key);assert.notEqual(removed?.ok,false);
  assert.equal((await page.evaluate(()=>playerAPI.getState())).queue.length,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'library.json'),'utf8')).tracks.length,0);
  console.log('PASS actual Electron IPC + engine + disk persistence: cover migration, input volume before release, final save, batch removal.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
