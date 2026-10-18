'use strict';
const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=path.resolve(__dirname,'../dist/batch-copy-qa-profile');fs.mkdirSync(profile,{recursive:true});
 const tracks=[1,2,3].map(id=>({key:'netease:'+id,platform:'netease',sourceId:String(id),title:id<3?'批量测试 '+id:'未选中',artist:'Artist '+id,url:'https://music.163.com/song?id='+id}));
 fs.writeFileSync(path.join(profile,'library.json'),JSON.stringify({schemaVersion:2,tracks,activePlaylistId:'source',playlists:[{id:'source',name:'来源歌单',queue:tracks.map(t=>t.key),mode:'sequential'}]}));
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),'--test-mode','--data-dir='+profile],timeout:30000});
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('[data-testid="track-row"]');
  await page.locator('#batch-select').click();assert.equal(await page.locator('#copy-selected').isDisabled(),true);
  await page.locator('#search-input').fill('批量测试');await page.locator('#select-visible').check();
  assert.match(await page.locator('#selected-count').textContent(),/2/);
  await page.locator('#copy-selected').click();assert.equal(await page.locator('#batch-copy-submit').isDisabled(),true);
  assert.match(await page.locator('#batch-copy-error').textContent(),/创建另一个歌单/);await page.locator('#batch-copy-cancel').click();
  const target=await page.evaluate(async()=>{const r=await playerAPI.command('playlist-create',{name:'目标歌单'});await playerAPI.command('playlist-select',{id:'source'});return r.id;});
  await page.locator('#search-input').fill('批量测试');await page.locator('#batch-select').click();await page.locator('#select-visible').check();
  // Seed one duplicate through the real IPC, then copy a mixed selection through the UI.
  await page.evaluate(target=>playerAPI.command('copy-many',{sourceId:'source',targetId:target,keys:['netease:1']}),target);
  await page.locator('#copy-selected').click();assert.equal(await page.locator('#batch-copy-target option').count(),1);
  assert.equal(await page.locator('#batch-copy-target').inputValue(),target);
  await page.locator('#batch-copy-cancel').click();assert.match(await page.locator('#selected-count').textContent(),/2/);
  const before=await page.evaluate(()=>playerAPI.getState());
  await page.locator('#copy-selected').click();assert.equal(await page.locator('#batch-copy-dialog').isVisible(),true);
  await page.locator('#batch-copy-submit').click();await page.waitForFunction(()=>!document.querySelector('#batch-copy-dialog').open);
  assert.match(await page.locator('#selected-count').textContent(),/0/);assert.match(await page.locator('#notice-text').textContent(),/已添加 1 首，已有 1 首/);
  let state=await page.evaluate(()=>playerAPI.getState());
  assert.deepEqual(state.playlists.find(p=>p.id===target).queue,['netease:2','netease:1']);assert.deepEqual(state.playlists.find(p=>p.id==='source').queue,tracks.map(t=>t.key));
  for(const key of ['currentKey','status','generation','positionMs'])assert.deepEqual(state[key],before[key]);
  await page.locator('#select-visible').check();await page.locator('#copy-selected').click();await page.locator('#batch-copy-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#batch-copy-dialog').open);assert.match(await page.locator('#notice-text').textContent(),/已添加 0 首，已有 2 首/);
  const saved=JSON.parse(fs.readFileSync(path.join(profile,'library.json'),'utf8'));assert.deepEqual(saved.playlists.find(p=>p.id===target).queue,['netease:2','netease:1']);
  // A target removed while the dialog is open must fail without losing selection.
  await page.locator('#select-visible').check();await page.locator('#copy-selected').click();
  await page.evaluate(target=>playerAPI.command('playlist-delete',{id:target}),target);await page.locator('#batch-copy-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#batch-copy-error').hidden);assert.equal(await page.locator('#batch-copy-dialog').isVisible(),true);
  await page.locator('#batch-copy-cancel').click();assert.match(await page.locator('#selected-count').textContent(),/2/);
  assert.deepEqual(errors,[]);console.log('PASS real Windows UI + Electron IPC + engine + disk: empty/no-target states, filtered selection, cancel keeps selection, selected-only copy, deduplication, source/playback unchanged, persistence, stale-target error keeps selection.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
