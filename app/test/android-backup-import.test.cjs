'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PlayerEngine}=require('../src/engine.cjs');
const runtime=fs.readFileSync(path.join(__dirname,'../../android/runtime/app-runtime.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../../android/web/ui.js'),'utf8');
const importSource=runtime.slice(runtime.indexOf('  async function importFile()'),runtime.indexOf('  async function importShareLink('));
const runSource=ui.match(/    async function run\(action, node, message\)[^\n]+/)[0];
const track={key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'测试歌曲',artist:'测试作者'};
const backup={schemaVersion:2,tracks:[track],playlists:[{id:'restored',name:'备份歌单',queue:[track.key],mode:'sequential'}]};
function harness(t,result){
  const noop=()=>{};
  const engine=new PlayerEngine({library:{},resolveTrack:noop,contextFor:()=>({}),audio:{stopAll:noop,destroy:noop},web:{pause:noop,destroy:noop}});
  t.after(()=>engine.close());
  const notices=[],node={disabled:false};
  const context=vm.createContext({Buffer,engine,native:async method=>{assert.equal(method,'import');return result;},importLinks:async()=>{throw new Error('没有可导入的链接');},toast:(message,error)=>notices.push({message,error:!!error}),document:{documentElement:{contains:()=>true}}});
  vm.runInContext(importSource+'\n'+runSource,context);
  return{engine,notices,node,context,importFile:()=>vm.runInContext('importFile()',context),run:action=>context.run(action,node,'导入完成')};
}
test('Android backup import reports restored playlists and their location without changing browsing or playback',async t=>{
  const h=harness(t,{text:JSON.stringify(backup)}),before=h.engine.snapshot();
  assert.equal(await h.run(h.importFile),true);
  const after=h.engine.snapshot();
  assert.equal(after.activePlaylistId,before.activePlaylistId);
  assert.equal(after.playbackPlaylistId,before.playbackPlaylistId);
  assert.equal(after.currentKey,before.currentKey);assert.equal(after.status,before.status);
  assert.deepEqual(after.queue,before.queue);
  assert.ok(after.playlists.some(p=>p.name==='备份歌单'&&p.queue.includes(track.key)));
  assert.match(h.notices[0].message,/恢复 1 个歌单/);
  assert.match(h.notices[0].message,/新增 1 首/);
  assert.match(h.notices[0].message,/歌单列表/);
  assert.equal(h.node.disabled,false);
});
test('Android backup import displays an explicit result when no tracks are added',async t=>{
  const h=harness(t,{text:JSON.stringify({tracks:[],queue:[]})});
  await h.run(h.importFile);
  assert.match(h.notices[0].message,/新增 0 首/);
});
test('canceling Android file selection is quiet and leaves the library unchanged',async t=>{
  const h=harness(t,{canceled:true}),before=h.engine.snapshot();
  assert.equal(await h.run(h.importFile),false);
  assert.deepEqual(h.notices,[]);assert.deepEqual(h.engine.snapshot(),before);assert.equal(h.node.disabled,false);
});
for(const text of ['{broken','{"tracks":"invalid"}'])test('invalid Android backup leaves existing data intact: '+text,async t=>{
  const h=harness(t,{text});h.engine.importBackup(backup);const before=h.engine.snapshot();
  assert.equal(await h.run(h.importFile),false);
  assert.equal(h.notices[0].error,true);assert.deepEqual(h.engine.snapshot(),before);assert.equal(h.node.disabled,false);
});
