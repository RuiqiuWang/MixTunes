'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validatePlayRange,normalisePlayRange,effectivePlayRange}=require('../src/play-range.cjs');
const {LibraryStore,normaliseLibrary}=require('../src/store.cjs');
const {PlayerEngine}=require('../src/engine.cjs');
const fs=require('node:fs');const path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const song=(id,platform='netease')=>({key:platform+':'+id,sourceId:id,platform,url:platform==='bilibili'?'https://www.bilibili.com/video/BV17x411w7KC':`https://music.163.com/song?id=${id}`,title:'Song '+id,artist:'Artist',durationMs:120000});
function make(t,tracks=[song('1'),song('2')]){
  const calls={loads:[],plays:[],seeks:[],ranges:[],videoLoads:[],videoSeeks:[],videoPlays:[],videoPauses:0,videoLayouts:[],videoCloses:0};
  const audio={async load(track,generation,resolved,slot){calls.loads.push({key:track.key,range:structuredClone(track.playRange)});return {key:track.key,generation,slot};},activate(entry){calls.plays.push(entry);},seek(entry,position){calls.seeks.push({key:entry.key,position});},setRange(entry,range){calls.ranges.push({key:entry.key,range});},stopAll(){},unload(){},volume(){},destroy(){}};
  const web={async load(){},async play(){},async pause(){},async seek(){},async setVolume(){},async setRange(){},destroy(){}};
  const video={async load(track,generation,range){calls.videoLoads.push({key:track.key,generation,range});},async play(generation){calls.videoPlays.push(generation);},async pause(){calls.videoPauses++;},async seek(position){calls.videoSeeks.push(position);},async setVolume(){},async setRange(){},setLayout(layout){calls.videoLayouts.push(layout);},close(){calls.videoCloses++;},destroy(){}};
  const engine=new PlayerEngine({library:{tracks,queue:tracks.map(t=>t.key)},resolveTrack:async()=>({url:'https://m8.music.126.net/original.mp3'}),contextFor:()=>({}),audio,web,video});
  t.after(()=>engine.close());return{engine,calls,video,web};
}

test('natural single repeat and manual replay consume an earlier seek instead of repeating from it',async t=>{
  const track={...song('1'),playRange:{startMs:3000,endMs:90000}};
  const {engine}=make(t,[track]);await engine.playKey(track.key);engine.queue.setMode('repeat-one');
  await engine.seek(40000);engine.onEvent({type:'seeked',backend:'audio',key:track.key,generation:engine.generation,positionMs:40000,durationMs:120000});
  await engine.next({natural:true});assert.equal(engine.state.positionMs,3000);
  await engine.seek(50000);await engine.playKey(track.key,{resume:false});assert.equal(engine.state.positionMs,3000);
});
test('a paused loading request preserves a newly selected seek when explicitly resumed',async t=>{
  const {engine}=make(t,[song('1')]);engine.capturePlaylist(engine.state.activePlaylistId);engine.queue.select('netease:1');engine.state.status='paused';
  await engine.seek(40000);await engine.playKey();assert.equal(engine.state.positionMs,40000);
});
test('a resolution completing after a failed generation never loads or activates audio',async t=>{
  const {engine,calls}=make(t,[song('1')]);let done;engine.resolveTrack=()=>new Promise(resolve=>{done=resolve;});
  const loading=engine.playKey('netease:1');await tick();await engine.fail(new Error('timeout'),engine.generation);done({url:'https://m8.music.126.net/late.mp3'});await loading;
  assert.equal(engine.state.status,'error');assert.equal(calls.loads.length,0);assert.equal(calls.plays.length,0);
});

test('range validates unknown duration, one-second minimum, bounds and full reset for tiny tracks',()=>{
  assert.deepEqual(validatePlayRange({startMs:25000,endMs:null}),{startMs:25000,endMs:null});
  assert.deepEqual(validatePlayRange({startMs:0,endMs:null},500),{startMs:0,endMs:null});
  for(const value of [{startMs:-1,endMs:null},{startMs:1000,endMs:1500},{startMs:3000,endMs:5000},{startMs:5000,endMs:null}])assert.throws(()=>validatePlayRange(value,4000));
  assert.deepEqual(normalisePlayRange({startMs:'bad',endMs:-1},4000),{startMs:0,endMs:null});
  assert.deepEqual(effectivePlayRange({playRange:{startMs:1000,endMs:10000}},8000),{startMs:1000,endMs:8000});
});

test('aliases and ranges survive atomic save/restart and invalid backup values reset safely',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-ranges-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);const track={...song('1'),displayTitle:'My label',playRange:{startMs:12000,endMs:90000}};
  store.save({tracks:[track],queue:[track.key]});const restored=store.load().tracks[0];
  assert.equal(restored.title,'Song 1');assert.equal(restored.displayTitle,'My label');assert.deepEqual(restored.playRange,track.playRange);
  const invalid=normaliseLibrary({tracks:[{...track,displayTitle:' ',playRange:{startMs:200000,endMs:null}}]}).tracks[0];
  assert.equal(invalid.displayTitle,undefined);assert.deepEqual(invalid.playRange,{startMs:0,endMs:null});
});

test('renaming is a global alias and original metadata still suppresses cross-platform duplicates',async t=>{
  const{engine}=make(t);engine.renameTrack('netease:1','Alias');
  const track=engine.snapshot().tracks[0];assert.equal(track.title,'Song 1');assert.equal(track.displayTitle,'Alias');
  assert.deepEqual(engine.addTracksDetailed([{...song('new'),platform:'qq',key:'qq:new',title:'Song 1'}]),{added:0,existingKey:0,duplicateMetadata:1});
  const first=engine.state.activePlaylistId;const second=await engine.createPlaylist('Other');engine.addTracks([track]);
  assert.equal(engine.snapshot().tracks.find(t=>t.key===track.key).displayTitle,'Alias');
  await engine.selectPlaylist(first);engine.renameTrack(track.key,track.title);assert.equal(track.displayTitle,undefined);
  for(const name of ['', ' ', 'a'.repeat(501)])assert.throws(()=>engine.renameTrack(track.key,name));
  assert.notEqual(first,second);
});

test('range start, clamped seeks and dynamic out-of-range adjustment apply to audio',async t=>{
  const {engine,calls}=make(t);await engine.setPlayRange('netease:1',{startMs:10000,endMs:20000});
  await engine.playKey('netease:1');assert.equal(engine.snapshot().positionMs,10000);assert.deepEqual(calls.loads[0].range,{startMs:10000,endMs:20000});
  await engine.seek(0);await engine.seek(99000);assert.deepEqual(calls.seeks.map(c=>c.position),[10000,20000]);
  await engine.setPlayRange('netease:1',{startMs:30000,endMs:50000});assert.equal(calls.seeks.at(-1).position,30000);
  assert.deepEqual(calls.ranges.at(-1).range,{startMs:30000,endMs:50000});
});

for(const mode of ['sequential','shuffle','repeat-one'])test(`${mode} treats clip boundary as one natural end and restarts at the next configured start`,async t=>{
  const {engine,calls}=make(t);await engine.setPlayRange('netease:1',{startMs:10000,endMs:20000});await engine.setPlayRange('netease:2',{startMs:30000,endMs:40000});engine.setMode(mode);
  await engine.playKey('netease:1');const generation=engine.generation;
  engine.onEvent({type:'progress',key:'netease:1',generation,positionMs:20000,durationMs:120000});
  engine.onEvent({type:'ended',key:'netease:1',generation});await tick();
  const expected=mode==='repeat-one'?'netease:1':'netease:2';assert.equal(engine.snapshot().currentKey,expected);
  assert.equal(engine.snapshot().positionMs,mode==='repeat-one'?10000:30000);assert.equal(calls.plays.length,2);
});

test('runtime shorter than an unknown-duration start restores full playback safely',async t=>{
  const {engine,calls}=make(t,[{...song('1'),durationMs:undefined,playRange:{startMs:80000,endMs:null}}]);await engine.playKey('netease:1');
  engine.onEvent({type:'metadata',key:'netease:1',generation:engine.generation,positionMs:0,durationMs:20000});
  assert.deepEqual(engine.current().playRange,{startMs:0,endMs:null});assert.equal(engine.snapshot().positionMs,0);assert.equal(calls.ranges.at(-1).range.startMs,0);
});

test('video switches from current audio position, closes paused, then resumes audio at that position',async t=>{
  const {engine,calls}=make(t,[song('BV17x411w7KC','bilibili')]);await engine.setPlayRange(engine.queue.keys[0],{startMs:10000,endMs:80000});await engine.playKey(engine.queue.keys[0]);
  await engine.seek(35000);await engine.openVideo();assert.equal(engine.snapshot().backend,'video');assert.equal(engine.snapshot().videoOpen,true);assert.equal(calls.videoSeeks.at(-1),35000);
  const generation=engine.generation;engine.onEvent({type:'progress',backend:'video',key:engine.queue.currentKey,generation,positionMs:42000,durationMs:120000});
  engine.onEvent({type:'closed',backend:'video',key:engine.queue.currentKey,generation});await tick();assert.equal(engine.snapshot().status,'paused');assert.equal(engine.snapshot().videoOpen,false);
  await engine.playKey();assert.equal(engine.snapshot().backend,'audio');assert.equal(calls.seeks.at(-1).position,42000);
});

test('video natural end keeps Bilibili video mode and returns non-Bilibili next to audio',async t=>{
  const tracks=[song('BV17x411w7KC','bilibili'),{...song('BV1xx411w7KC','bilibili'),url:'https://www.bilibili.com/video/BV1xx411w7KC'},song('3')];
  const {engine}=make(t,tracks);await engine.openVideo(tracks[0].key);let generation=engine.generation;
  engine.onEvent({type:'ended',backend:'video',key:tracks[0].key,generation});await tick();assert.equal(engine.snapshot().backend,'video');
  generation=engine.generation;engine.onEvent({type:'ended',backend:'video',key:tracks[1].key,generation});await tick();assert.equal(engine.snapshot().backend,'audio');assert.equal(engine.snapshot().videoOpen,false);
});

test('native video close finishes cleanup even when its destroyed page rejects pause, then resumes audio',async t=>{
  const{engine,video,calls}=make(t,[song('BV17x411w7KC','bilibili')]);const key=engine.queue.keys[0];await engine.openVideo(key);
  const generation=engine.generation;engine.onEvent({type:'progress',backend:'video',key,generation,positionMs:35000,durationMs:120000});
  video.pause=async()=>{throw new Error('视频播放请求已失效');};video.close=()=>{};
  let saved;engine.persist=value=>saved=structuredClone(value);
  engine.onEvent({type:'closed',backend:'video',key,generation});await tick();
  assert.equal(engine.snapshot().status,'paused');assert.equal(engine.snapshot().backend,null);assert.equal(engine.snapshot().videoOpen,false);assert.equal(engine.active,null);assert.equal(saved.currentKey,key);
  await engine.playKey();assert.equal(engine.snapshot().backend,'audio');assert.equal(calls.seeks.at(-1).position,35000);
});

test('video gesture request keeps the current track recoverable until a page tap starts playback',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {engine}=make(t,[song('BV17x411w7KC','bilibili')]);const key=engine.queue.keys[0];await engine.openVideo(key);
  const generation=engine.generation,notices=[];engine.on('notice',message=>notices.push(message));
  engine.onEvent({type:'gesture-required',backend:'video',key,generation});
  assert.equal(engine.snapshot().status,'buffering');assert.equal(engine.snapshot().error,null);
  assert.equal(engine.snapshot().currentKey,key);assert.equal(engine.wantsPlayback,true);
  t.mock.timers.tick(46000);
  assert.equal(engine.snapshot().status,'buffering');assert.equal(notices.length,1);
  engine.onEvent({type:'playing',backend:'video',key,generation});
  assert.equal(engine.snapshot().status,'playing');
  await engine.pause();engine.onEvent({type:'gesture-required',backend:'video',key,generation});
  assert.equal(engine.snapshot().status,'paused');assert.equal(notices.length,1);
});

for(const backend of ['web','video'])test(`${backend} range edited during load is saved and applied before first play`,async t=>{
  const track=backend==='video'?song('BV17x411w7KC','bilibili'):song('1');
  const {engine,web,video}=make(t,[track]);await engine.setPlayRange(track.key,{startMs:10000,endMs:20000});
  const adapter=backend==='video'?video:web;let finishLoad,ready=false,saved;const actions=[];
  engine.persist=state=>saved=structuredClone(state);if(backend==='web')engine.resolveTrack=async()=>{throw new Error('official fallback');};
  adapter.load=()=>new Promise(resolve=>finishLoad=()=>{ready=true;resolve();});
  adapter.setRange=async range=>{if(!ready)throw new Error('adapter not ready');actions.push(['range',structuredClone(range)]);};
  adapter.seek=async position=>actions.push(['seek',position]);adapter.play=async()=>actions.push(['play']);
  const pending=backend==='video'?engine.openVideo(track.key):engine.playKey(track.key);await tick();
  await engine.setPlayRange(track.key,{startMs:30000,endMs:60000});
  assert.deepEqual(saved.tracks[0].playRange,{startMs:30000,endMs:60000});assert.deepEqual(actions,[]);
  finishLoad();await pending;
  assert.deepEqual(actions,[['range',{startMs:30000,endMs:60000}],['seek',30000],['play']]);
  assert.equal(engine.snapshot().positionMs,30000);
});

test('range changed during pending audio load replaces pending old start before activation',async t=>{
  const{engine}=make(t,[song('1')]);await engine.setPlayRange('netease:1',{startMs:10000,endMs:20000});
  let finishLoad;const actions=[];
  engine.audio.load=(track,generation,resolved,slot)=>new Promise(resolve=>finishLoad=()=>resolve({key:track.key,generation,slot}));
  engine.audio.setRange=(entry,range)=>actions.push(['range',structuredClone(range)]);engine.audio.seek=(entry,position)=>actions.push(['seek',position]);engine.audio.activate=()=>actions.push(['play']);
  const pending=engine.playKey('netease:1');await tick();await engine.setPlayRange('netease:1',{startMs:30000,endMs:60000});finishLoad();await pending;
  assert.deepEqual(actions,[['range',{startMs:30000,endMs:60000}],['seek',30000],['play']]);assert.equal(engine.snapshot().positionMs,30000);
});

test('range changes during browser seek are re-applied before autoplay, and stale ready is ignored',async t=>{
  const{engine,video}=make(t,[song('BV17x411w7KC','bilibili')]);const key=engine.queue.keys[0];await engine.setPlayRange(key,{startMs:10000,endMs:20000});
  let finishSeek;const positions=[];let plays=0;video.seek=position=>{positions.push(position);return positions.length===1?new Promise(resolve=>finishSeek=resolve):Promise.resolve();};video.play=async()=>plays++;
  const pending=engine.openVideo(key);await tick();await engine.setPlayRange(key,{startMs:30000,endMs:60000});finishSeek();await pending;
  assert.equal(positions.at(-1),30000);assert.equal(plays,1);const before=engine.snapshot();
  engine.onEvent({type:'ready',backend:'video',key,generation:before.generation-1,durationMs:2000,positionMs:0});assert.equal(engine.snapshot().durationMs,before.durationMs);
});

for(const backend of ['web','video'])test(`${backend} seek during load waits for readiness and wins over the original start`,async t=>{
  const track=backend==='video'?song('BV17x411w7KC','bilibili'):song('1');const {engine,web,video}=make(t,[track]);const adapter=backend==='video'?video:web;
  let finish;const actions=[];if(backend==='web')engine.resolveTrack=async()=>{throw new Error('official fallback');};
  adapter.load=()=>new Promise(resolve=>finish=resolve);adapter.seek=async position=>actions.push(['seek',position]);adapter.play=async()=>actions.push(['play']);
  const loading=backend==='video'?engine.openVideo(track.key):engine.playKey(track.key);await tick();const generation=engine.generation;
  await engine.seek(32000);assert.deepEqual(actions,[]);assert.equal(engine.generation,generation);finish();await loading;
  assert.deepEqual(actions,[['seek',32000],['play']]);assert.equal(engine.snapshot().positionMs,32000);assert.equal(engine.wantsPlayback,true);
});

test('temporary Bilibili playback can open video outside the catalog and an explicit row can choose another playlist source',async t=>{
  const saved=song('1');const {engine}=make(t,[saved]);const source=engine.snapshot().activePlaylistId;const temporary=song('BV17x411w7KC','bilibili');
  await engine.playTemporary(temporary);await engine.openVideo();assert.equal(engine.snapshot().backend,'video');assert.equal(engine.snapshot().playbackPlaylistId,null);assert.equal(engine.snapshot().tracks.length,1);
  const other=await engine.createPlaylist('Other');engine.addTracks([temporary]);await engine.selectPlaylist(source);await engine.openVideo(temporary.key,{playlistId:other});
  assert.equal(engine.snapshot().activePlaylistId,source);assert.equal(engine.snapshot().playbackPlaylistId,other);assert.equal(engine.snapshot().currentTrack.key,temporary.key);
});

test('collapsing a playing video keeps its backend and progress; reopening does not reload or seek',async t=>{
 const {engine,calls}=make(t,[song('BV17x411w7KC','bilibili')]);const key=engine.queue.keys[0];await engine.openVideo(key);
 const generation=engine.generation;engine.onEvent({type:'playing',backend:'video',key,generation});
 engine.onEvent({type:'progress',backend:'video',key,generation,positionMs:35000,durationMs:120000});
 const pauses=calls.videoPauses,seeks=calls.videoSeeks.length;
 await engine.setVideoPanel({open:false});
 assert.equal(engine.state.status,'playing');assert.equal(engine.wantsPlayback,true);assert.equal(engine.state.backend,'video');assert.equal(engine.state.videoPanel.open,false);assert.equal(engine.generation,generation);
 assert.equal(calls.videoPauses,pauses);assert.equal(calls.videoCloses,0);assert.equal(calls.videoLayouts.at(-1).visible,false);
 engine.onEvent({type:'progress',backend:'video',key,generation,positionMs:42000,durationMs:120000});
 await engine.openVideo(key);
 assert.equal(engine.state.positionMs,42000);assert.equal(engine.state.status,'playing');assert.equal(engine.state.videoPanel.open,true);
 assert.equal(calls.videoLoads.length,1);assert.equal(calls.videoPlays.length,1);assert.equal(calls.videoSeeks.length,seeks);assert.equal(calls.videoLayouts.at(-1).visible,true);
 await engine.pause();const plays=calls.videoPlays.length;await engine.setVideoPanel({open:false});await engine.openVideo(key);
 assert.equal(engine.state.status,'paused');assert.equal(engine.wantsPlayback,false);assert.equal(calls.videoPlays.length,plays);
});

test('a collapse during video load survives load completion and preserves playback intent',async t=>{
 const {engine,video,calls}=make(t,[song('BV17x411w7KC','bilibili')]);let finish;
 video.load=()=>new Promise(resolve=>finish=resolve);
 const loading=engine.openVideo(engine.queue.keys[0]);await tick();await engine.setVideoPanel({open:false});finish();await loading;
 assert.equal(engine.state.videoPanel.open,false);assert.equal(engine.state.backend,'video');assert.equal(engine.wantsPlayback,true);
 assert.equal(calls.videoLayouts.at(-1).visible,false);assert.equal(calls.videoPlays.length,1);assert.equal(calls.videoCloses,0);
});

test('hidden video queue advances without reopening the panel and disposes video when switching to audio',async t=>{
 const tracks=[song('BV17x411w7KC','bilibili'),song('BV1xx411w7KC','bilibili'),song('3')];
 const {engine,calls}=make(t,tracks);await engine.openVideo(tracks[0].key);await engine.setVideoPanel({open:false});
 engine.onEvent({type:'ended',backend:'video',key:tracks[0].key,generation:engine.generation});await tick();
 assert.equal(engine.state.currentKey,tracks[1].key);assert.equal(engine.state.backend,'video');assert.equal(engine.state.videoPanel.open,false);assert.equal(calls.videoLayouts.at(-1).visible,false);
 engine.onEvent({type:'ended',backend:'video',key:tracks[1].key,generation:engine.generation});await tick();
 assert.equal(engine.state.currentKey,tracks[2].key);assert.equal(engine.state.backend,'audio');assert.equal(engine.state.videoPanel.open,false);assert.equal(calls.videoCloses,1);
});

test('an open media panel uses video for Bilibili after a music track',async t=>{
  const tracks=[song('1'),song('BV17x411w7KC','bilibili')];
  const {engine,calls}=make(t,tracks);
  await engine.setVideoPanel({open:true});
  await engine.playKey(tracks[0].key);
  assert.equal(engine.state.videoOpen,false);
  await engine.playKey(tracks[1].key);
  assert.equal(engine.state.videoOpen,true);
  assert.equal(calls.videoLoads.length,1);
  await engine.playKey(tracks[0].key);
  assert.equal(engine.state.videoOpen,false);
  assert.equal(engine.state.videoPanel.open,true);
});
