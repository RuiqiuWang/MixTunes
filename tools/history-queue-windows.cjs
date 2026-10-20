'use strict';
// Focused Windows main-process contract: queue/history IPC commands without
// network playback, using an isolated userData directory.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('../app/node_modules/playwright-core');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'mix-windows-queue-'));
const tracks=[1,2,3].map(id=>({platform:'netease',sourceId:String(id),key:`netease:${id}`,url:`https://music.163.com/song?id=${id}`,title:`歌曲 ${id}`,artist:'歌手',durationMs:180000}));
fs.writeFileSync(path.join(work,'library.json'),JSON.stringify({schemaVersion:2,tracks,playlists:[{id:'p',name:'歌单',queue:tracks.map(track=>track.key),mode:'sequential',currentKey:null}],activePlaylistId:'p'}));
const history=[1,2].map((id,index)=>({id:`history-${id}`,key:`netease:${id}`,platform:'netease',sourceId:String(id),title:`歌曲 ${id}`,artist:'歌手',durationMs:180000,playedAt:1000+index}));
fs.writeFileSync(path.join(work,'history.json'),JSON.stringify({schemaVersion:1,entries:history}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let app;try{
  app=await _electron.launch({executablePath:require('../app/node_modules/electron'),args:[path.join(__dirname,'../app/src/main.cjs'),'--test-mode',`--data-dir=${work}`],timeout:60000});
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.playerAPI);await delay(300);
  const state=()=>page.evaluate(()=>window.playerAPI.getState());
  const command=(name,payload={})=>page.evaluate(({name,payload})=>window.playerAPI.command(name,payload),{name,payload});
  let s=await state();
  assert.equal(s.historyCount,2,'Windows loads history.json at startup');
  const list=await command('history-list');
  assert.equal(list.entries.length,2);assert.deepEqual(list.entries.map(entry=>entry.id),['history-2','history-1']);assert.equal('url' in list.entries[0],false);
  const queue=await command('queue-preview',{limit:10});
  assert.equal(queue.ok,true);assert.deepEqual(queue.upcoming.map(item=>item.key),['netease:1','netease:2','netease:3']);
  const moved=await command('queue-move',{fromIndex:0,toIndex:2,limit:10});
  assert.deepEqual(moved.upcoming.map(item=>item.key),['netease:2','netease:3','netease:1']);
  assert.deepEqual((await state()).playlists[0].queue,['netease:1','netease:2','netease:3']);
  const pinned=await command('queue-play-next',{key:'netease:3',limit:10});
  assert.equal(pinned.upcoming[0].key,'netease:3');
  assert.deepEqual((await state()).playlists[0].queue,['netease:1','netease:2','netease:3']);
  const removed=await command('history-remove',{id:'history-2'});assert.equal(removed.ok,true);
  await delay(200);
  let saved=JSON.parse(fs.readFileSync(path.join(work,'history.json'),'utf8'));
  assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].id,'history-1');
  const cleared=await command('history-clear');assert.equal(cleared.cleared,1);
  await delay(200);
  saved=JSON.parse(fs.readFileSync(path.join(work,'history.json'),'utf8'));
  assert.deepEqual(saved.entries,[]);
  assert.equal((await state()).historyCount,0);
  console.log('PASS windows history IPC/persistence and queue IPC without changing playlists');
}catch(error){console.error(error);process.exitCode=1;}finally{if(app)await app.close().catch(()=>{});fs.rmSync(work,{recursive:true,force:true});}})();
