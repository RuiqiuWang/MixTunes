'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SearchService,searchQuery,searchUrl}=require('../src/search-service.cjs');
const {parseInput}=require('../src/providers.cjs');const {safeTrack}=require('../src/store.cjs');const {PlayerEngine}=require('../src/engine.cjs');
const item=(platform='netease',id='33894312')=>({id,platform,title:'搜索高亮标题',artist:'搜索作者',url:platform==='qq'?'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi':platform==='bilibili'?'https://www.bilibili.com/video/BV17x411w7KC':`https://music.163.com/song?id=${id}`,durationMs:60000});
function make(overrides={}){
  const engine=overrides.engine||{snapshot:()=>({playlists:[{id:'playlist'}]}),addTracksDetailed:()=>({added:1,existingKey:0,duplicateMetadata:0})};
  return new SearchService({searchPlatform:async p=>({items:[item(p)],total:40,hasMore:true}),contextFor:p=>({platform:p}),importResource:async r=>({tracks:[{...item(r.platform),key:r.platform+':'+r.id,sourceId:r.id,title:'原站真实标题',artist:'原站真实作者'}]}),parseInput,safeTrack,engine,...overrides});
}
test('online query validation and fixed first-party fallback URLs encode arbitrary search text',()=>{
  assert.equal(searchQuery('  洛天依  '),'洛天依');for(const query of ['',null,'x'.repeat(101),'a\u0000b'])assert.throws(()=>searchQuery(query));
  for(const platform of ['qq','netease','bilibili']){const u=new URL(searchUrl(platform,'a&next=https://example.com/<script>'));assert.equal(u.protocol,'https:');assert.ok(['y.qq.com','music.163.com','search.bilibili.com'].includes(u.hostname));assert.equal(u.username,'');}
  assert.throws(()=>searchUrl('file','music'));
});
test('all platforms start concurrently and one failure does not erase successful results',async()=>{
  const starts=[],resolvers={};const s=make({searchPlatform:(p,q,c,o)=>{starts.push(p);assert.equal(c.platform,p);assert.equal(o.pageSize,20);return new Promise((resolve,reject)=>resolvers[p]={resolve,reject});}});
  const pending=s.search({query:'钢琴'});await new Promise(r=>setImmediate(r));assert.deepEqual(starts,['qq','netease','bilibili']);
  resolvers.qq.resolve({items:[item('qq')],total:1});resolvers.netease.resolve({items:[],total:0});resolvers.bilibili.reject(new Error('请稍后重试'));
  const r=await pending;assert.equal(r.ok,true);assert.equal(r.results[0].items.length,1);assert.equal(r.results[1].ok,true);assert.equal(r.results[2].ok,false);assert.equal(r.results[2].error,'请稍后重试');s.close();
});
test('hard timeout also terminates a transport that never settles',async()=>{
  let signal;const s=make({timeoutMs:10,searchPlatform:(p,q,c,o)=>{signal=o.signal;return new Promise(()=>{});}});const r=await s.search({query:'音楽',platform:'bilibili'});assert.equal(r.results[0].ok,false);assert.match(r.results[0].error,/超时/);assert.equal(signal.aborted,true);s.close();
});
test('untrusted and cross-platform links never enter the result cache',async()=>{
  const valid=item();const s=make({searchPlatform:async()=>({items:[valid,{...valid,id:'bad',url:'https://example.com/song?id=1'},{...valid,id:'wrong',url:item('qq').url},{...valid,id:'playlist',url:'https://music.163.com/playlist?id=123'},valid],total:5,hasMore:true})});
  const r=await s.search({query:'music',platform:'netease'});assert.equal(r.results[0].items.length,1);await assert.rejects(s.add({requestId:r.requestId,platform:'netease',id:'bad',playlistId:'playlist'}),/过期/);s.close();
});
test('older page tokens stay valid and canonical metadata is re-imported on add',async()=>{
  const imported=[];const s=make({searchPlatform:async(p,q,c,o)=>({items:[item(p,String(o.page))],total:99,hasMore:true}),importResource:async r=>{imported.push(r.id);return{tracks:[{...item('netease',r.id),sourceId:r.id,title:'原站标题',artist:'原站作者'}]};}});
  const one=await s.search({query:'词',platform:'netease',page:1}),two=await s.search({query:'词',platform:'netease',page:2});assert.notEqual(one.requestId,two.requestId);
  assert.equal((await s.add({requestId:one.requestId,platform:'netease',id:'1',playlistId:'playlist'})).added,1);assert.deepEqual(imported,['1']);s.close();
});
test('forged, expired and deleted-playlist adds are rejected before import',async()=>{
  let clock=0,imports=0;const s=make({now:()=>clock,importResource:async()=>{imports++;throw new Error('must not import');}});
  const r=await s.search({query:'词',platform:'netease'});const payload={requestId:r.requestId,platform:'netease',id:'33894312',playlistId:'playlist'};
  await assert.rejects(s.add({...payload,id:'999'}),/过期/);await assert.rejects(s.add({...payload,playlistId:'deleted'}),/不存在/);clock=20*60*1000+1;await assert.rejects(s.add(payload),/过期/);assert.equal(imports,0);s.close();
});
test('pagination is bounded before network access and last page cannot claim more results',async()=>{
  let calls=0;const s=make({searchPlatform:async p=>{calls++;return{items:[item(p)],hasMore:true};}});
  for(const page of [0,11,1.5,'1'])await assert.rejects(s.search({query:'x',page}),/页码/);assert.equal(calls,0);
  const r=await s.search({query:'x',platform:'netease',page:10});assert.equal(r.results[0].hasMore,false);s.close();
});
test('result batches are bounded and eviction requires a new search',async()=>{
  const s=make();let first;for(let i=0;i<31;i++){const r=await s.search({query:'q'+i,platform:'netease'});first||=r;}assert.equal(s.batches.size,30);await assert.rejects(s.add({requestId:first.requestId,platform:'netease',id:'33894312',playlistId:'playlist'}),/过期/);s.close();
});
test('search add uses captured playlist, prepends once and respects canonical same-title artist dedup without playback',async()=>{
  let plays=0;const engine=new PlayerEngine({library:{tracks:[],playlists:[{id:'a',name:'A',queue:[],mode:'sequential'},{id:'b',name:'B',queue:[],mode:'sequential'}],activePlaylistId:'b'},resolveTrack:()=>{plays++;},contextFor:()=>({}),audio:{stopAll(){},destroy(){}},web:{pause(){},destroy(){}}});
  const s=make({engine,searchPlatform:async p=>({items:[item(p)],total:1}),importResource:async r=>({tracks:[{...item(r.platform),sourceId:r.id,title:'同一录音',artist:'同一作者'}]})});
  try{const q=await s.search({query:'标题'});for(const [index,p]of ['netease','qq'].entries()){const found=q.results.find(r=>r.platform===p).items[0];const r=await s.add({requestId:q.requestId,platform:p,id:found.id,playlistId:'a'});assert.equal(r.added,index===0?1:0);if(index===1)assert.equal(r.duplicateMetadata,1);}
    const state=engine.snapshot();assert.equal(state.activePlaylistId,'b');assert.deepEqual(state.queue,[]);assert.equal(state.playlists.find(p=>p.id==='a').queue.length,1);assert.equal(state.tracks[0].title,'同一录音');assert.equal(plays,0);assert.notEqual(state.status,'playing');
  }finally{s.close();engine.close();}
});
test('exiting during metadata import prevents a late library write',async()=>{
  let finish,writes=0;const s=make({engine:{snapshot:()=>({playlists:[{id:'playlist'}]}),addTracksDetailed:()=>{writes++;}},importResource:()=>new Promise(r=>finish=r)});
  const r=await s.search({query:'词',platform:'netease'});const pending=s.add({requestId:r.requestId,platform:'netease',id:'33894312',playlistId:'playlist'});await new Promise(r=>setImmediate(r));s.close();finish({tracks:[{...item(),sourceId:'33894312'}]});await assert.rejects(pending,/退出/);assert.equal(writes,0);
});

test('search play re-imports canonical original-source metadata and never adds a favorite or substitutes a same-name source',async()=>{
  const favorite={key:'qq:0016IKty1sTxqi',platform:'qq',sourceId:'0016IKty1sTxqi',title:'Same song',artist:'Same artist',url:'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi'};
  const requests=[];const engine=new PlayerEngine({library:{tracks:[favorite],queue:[favorite.key]},resolveTrack:async track=>{requests.push(track);return{url:'https://m8.music.126.net/test.mp3'};},contextFor:()=>({}),audio:{async load(track,generation,resolved,slot){return{key:track.key,generation,slot};},activate(){},stopAll(){},unload(){},destroy(){}},web:{async pause(){},destroy(){}}});
  const s=make({engine,importResource:async resource=>({tracks:[{...item('netease',resource.id),sourceId:resource.id,title:'Same song',artist:'Same artist'}]})});
  try{
    const before=structuredClone(engine.snapshot());const q=await s.search({query:'Same song',platform:'netease'});
    const result=await s.play({requestId:q.requestId,platform:'netease',id:'33894312',url:favorite.url,title:'renderer forged title',playlistId:'does-not-matter'});
    assert.equal(result.ok,true);assert.equal(result.platform,'netease');assert.equal(requests.length,1);assert.equal(requests[0].platform,'netease');assert.equal(requests[0].title,'Same song');
    const state=engine.snapshot();assert.equal(state.currentTrack.sourceId,'33894312');assert.equal(state.playbackPlaylistId,null);assert.deepEqual(state.tracks,before.tracks);assert.deepEqual(state.playlists,before.playlists);assert.deepEqual(state.queue,before.queue);
  }finally{s.close();engine.close();}
});

test('forged and expired search play tokens are rejected before canonical import',async()=>{
  let clock=0,imports=0,plays=0;const s=make({now:()=>clock,importResource:async()=>{imports++;throw new Error('must not import');},engine:{playTemporary:async()=>plays++}});
  const q=await s.search({query:'x',platform:'netease'}),payload={requestId:q.requestId,platform:'netease',id:'33894312'};
  await assert.rejects(s.play({...payload,id:'999'}),/过期/);await assert.rejects(s.play({...payload,platform:'qq'}),/过期/);clock=20*60*1000+1;await assert.rejects(s.play(payload),/过期/);
  assert.equal(imports,0);assert.equal(plays,0);s.close();
});

test('canonical search play refuses a different source or multiple ambiguous tracks',async()=>{
  let plays=0;const s=make({engine:{playTemporary:async()=>plays++},importResource:async()=>({tracks:[{...item('netease','999'),sourceId:'999'}]})});
  const q=await s.search({query:'x',platform:'netease'});await assert.rejects(s.play({requestId:q.requestId,platform:'netease',id:'33894312'}),/无法读取/);assert.equal(plays,0);s.close();
});

test('closing during search-play metadata lookup prevents a late playback',async()=>{
  let finish,plays=0;const s=make({engine:{playTemporary:async()=>plays++},importResource:()=>new Promise(resolve=>finish=resolve)});
  const q=await s.search({query:'x',platform:'netease'});const pending=s.play({requestId:q.requestId,platform:'netease',id:'33894312'});await new Promise(resolve=>setImmediate(resolve));s.close();finish({tracks:[{...item(),sourceId:'33894312'}]});
  assert.equal((await pending).canceled,true);assert.equal(plays,0);
});

test('the latest search result play wins when an older metadata lookup completes later',async()=>{
  let finish;const plays=[];const s=make({engine:{playTemporary:async track=>plays.push(track.sourceId)},searchPlatform:async()=>({items:[item('netease','1'),item('netease','2')]}),importResource:resource=>resource.id==='1'?new Promise(resolve=>finish=()=>resolve({tracks:[{...item('netease','1'),sourceId:'1'}]})):Promise.resolve({tracks:[{...item('netease','2'),sourceId:'2'}]})});
  const q=await s.search({query:'x',platform:'netease'});const first=s.play({requestId:q.requestId,platform:'netease',id:'1'});await new Promise(resolve=>setImmediate(resolve));await s.play({requestId:q.requestId,platform:'netease',id:'2'});finish();assert.equal((await first).canceled,true);assert.deepEqual(plays,['2']);s.close();
});

test('an external pause or next cancels search playback still awaiting canonical import without adding favorites',async()=>{
  let finish,plays=0,adds=0;const s=make({engine:{playTemporary:async()=>plays++,addTracksDetailed:()=>adds++},importResource:()=>new Promise(resolve=>finish=resolve)});
  const q=await s.search({query:'x',platform:'netease'});const pending=s.play({requestId:q.requestId,platform:'netease',id:'33894312'});await new Promise(resolve=>setImmediate(resolve));s.cancelPlayback();finish({tracks:[{...item(),sourceId:'33894312'}]});
  assert.deepEqual(await pending,{ok:true,canceled:true,message:'已取消此次搜索结果播放'});assert.equal(plays,0);assert.equal(adds,0);s.close();
});
test('search add reports explicit added, exists and duplicate outcomes with the canonical key',async()=>{
  const outcomes=[{added:1,existingKey:0,duplicateMetadata:0},{added:0,existingKey:1,duplicateMetadata:0},{added:0,existingKey:0,duplicateMetadata:1}];
  let calls=0;
  const s=make({engine:{snapshot:()=>({playlists:[{id:'playlist',queue:[]}]}),addTracksDetailed:()=>outcomes[calls++]}});
  const q=await s.search({query:'状态',platform:'netease'});
  const payload={requestId:q.requestId,platform:'netease',id:'33894312',playlistId:'playlist'};
  const added=await s.add(payload);assert.equal(added.status,'added');assert.equal(added.key,'netease:33894312');assert.match(added.message,/已加入/);
  const exists=await s.add(payload);assert.equal(exists.status,'exists');assert.match(exists.message,/已在歌单中/);
  const duplicate=await s.add(payload);assert.equal(duplicate.status,'duplicate');assert.match(duplicate.message,/同名同作者/);
  s.close();
});

test('search add refuses to report success when neither a counter nor the playlist confirms the write',async()=>{
  let writes=0;
  const s=make({engine:{snapshot:()=>({playlists:[{id:'playlist',queue:[]}]}),addTracksDetailed:()=>{writes++;return{added:0,existingKey:0,duplicateMetadata:0};}}});
  const q=await s.search({query:'状态',platform:'netease'});
  await assert.rejects(s.add({requestId:q.requestId,platform:'netease',id:'33894312',playlistId:'playlist'}),/未生效/);
  assert.equal(writes,1);
  s.close();
});

test('search add keeps canonical import failures as failures',async()=>{
  const s=make({importResource:async()=>{throw new Error('原站暂时无法读取');}});
  const q=await s.search({query:'状态',platform:'netease'});
  await assert.rejects(s.add({requestId:q.requestId,platform:'netease',id:'33894312',playlistId:'playlist'}),/原站暂时无法读取/);
  s.close();
});

test('search additions preserve playing and paused playback identity, progress and backend commands',async t=>{
  const calls=[];
  const audio={
    async load(track,generation){calls.push('load');return{key:track.key,generation,token:String(generation)};},
    activate(){calls.push('activate');},stopAll(){calls.push('stop');},pause(){calls.push('pause');},
    seek(){calls.push('seek');},volume(){},unload(){},destroy(){}
  };
  const baseline={key:'netease:9',platform:'netease',sourceId:'9',url:'https://music.163.com/song?id=9',title:'Playing baseline',artist:'Baseline artist'};
  const engine=new PlayerEngine({library:{schemaVersion:2,tracks:[baseline],playlists:[
    {id:'a',name:'A',queue:[baseline.key],currentKey:baseline.key},{id:'b',name:'B',queue:[]}],
    activePlaylistId:'a',queue:[baseline.key],currentKey:baseline.key},audio,web:{destroy(){}},
    resolveTrack:async()=>({url:'https://m.music.126.net/fixture.mp3'}),contextFor:()=>({})});
  const service=make({engine});t.after(()=>{service.close();engine.close();});
  await engine.playKey(baseline.key);
  engine.onEvent({type:'playing',key:baseline.key,generation:engine.generation});
  engine.onEvent({type:'progress',key:baseline.key,generation:engine.generation,positionMs:7123,durationMs:180000});
  const batch=await service.search({query:'addition',platform:'netease'});
  for(const [status,playlistId] of [['playing','b'],['paused','a']]){
    if(status==='paused')await engine.pause();
    const before=engine.snapshot(),commands=[...calls];assert.equal(before.status,status);
    const result=await service.add({requestId:batch.requestId,platform:'netease',id:'33894312',playlistId});
    assert.equal(result.status,'added');assert.equal(result.added,1);
    const after=engine.snapshot();
    for(const field of ['currentKey','status','positionMs','playbackQueue','playbackPlaylistId','mode'])assert.deepEqual(after[field],before[field],field);
    assert.equal(after.positionMs,7123);assert.deepEqual(calls,commands);
  }
});
