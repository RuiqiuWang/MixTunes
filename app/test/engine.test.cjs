'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {PlayerEngine}=require('../src/engine.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function make(t,resolver=async()=>({url:'https://m.music.126.net/test.mp3'})){
  const loads=[],plays=[];
  const audio={async load(track,generation,resolved,slot){const entry={key:track.key,generation,slot,token:String(generation)};loads.push(entry);return entry;},activate(entry){plays.push(entry);},stopAll(){},pause(){},seek(){},volume(){},unload(){},destroy(){}};
  const web={async load(){},async pause(){},async play(){},async setVolume(){},destroy(){}};
  const tracks=['a','b','c'].map(sourceId=>({key:sourceId,platform:'netease',sourceId,url:'https://music.163.com/song?id=1',title:sourceId}));
  const engine=new PlayerEngine({library:{tracks,queue:['a','b','c']},resolveTrack:resolver,contextFor:()=>({}),audio,web});
  t.after(()=>engine.close());return{engine,loads,plays,web};
}
test('unsupported web fallback preserves resolver errors without opening a login page',async t=>{
  const {engine,web}=make(t,async()=>{throw new Error('平台请求失败（HTTP 403）');});
  web.supported=false;let webLoads=0;web.load=async()=>{webLoads++;};
  await engine.playKey('a');
  assert.equal(webLoads,0);assert.equal(engine.snapshot().status,'error');
  assert.equal(engine.snapshot().error,'平台请求失败（HTTP 403）');
});

test('unsupported web fallback preserves native media errors and redacts resource addresses',async t=>{
  const {engine,web}=make(t);web.supported=false;let webLoads=0;web.load=async()=>{webLoads++;};
  await engine.playKey('a');
  engine.onEvent({type:'error',backend:'audio',key:'a',generation:engine.generation,message:'解码失败 https://music.126.net/private?token=test'});
  await tick();
  assert.equal(webLoads,0);assert.equal(engine.snapshot().status,'error');
  assert.equal(engine.snapshot().error,'解码失败 [来源地址]');
});

test('supported desktop web fallback remains available for resolver failures',async t=>{
  const {engine,web}=make(t,async()=>{throw new Error('音频来源不可用');});
  let webLoads=0;web.load=async()=>{webLoads++;};
  await engine.playKey('a');
  assert.equal(webLoads,1);assert.equal(engine.snapshot().backend,'web');
  assert.equal(engine.snapshot().error,null);
});

test('a late resolve after rapid song selection cannot start the old song',async t=>{
  let finishA;
  const {engine,plays}=make(t,track=>track.key==='a'?new Promise(resolve=>finishA=resolve):Promise.resolve({url:'https://m.music.126.net/b.mp3'}));
  const a=engine.playKey('a');await tick();await engine.playKey('b');
  finishA({url:'https://m.music.126.net/a.mp3'});await a;
  assert.equal(engine.snapshot().currentKey,'b');assert.deepEqual(plays.map(p=>p.key),['b']);
});
test('duplicate natural-ended notifications advance the queue exactly once',async t=>{
  const {engine,plays}=make(t);await engine.playKey('a');const generation=engine.generation;
  engine.onEvent({type:'ended',key:'a',generation});engine.onEvent({type:'ended',key:'a',generation});await tick();
  assert.equal(engine.snapshot().currentKey,'b');assert.deepEqual(plays.map(p=>p.key),['a','b']);
});
test('pause during resolve cancels autoplay, even when the network finishes later',async t=>{
  let finish;const {engine,plays}=make(t,()=>new Promise(resolve=>finish=resolve));
  const pending=engine.playKey('a');await tick();await engine.pause();
  finish({url:'https://m.music.126.net/a.mp3'});await pending;
  assert.equal(engine.snapshot().status,'paused');assert.equal(plays.length,0);
});
test('standby player events cannot replace current status; next reuses prepared load',async t=>{
  const {engine,loads,plays}=make(t);await engine.playKey('a');
  engine.onEvent({type:'playing',key:'a',generation:engine.generation});await tick();
  assert.equal(engine.prepared.key,'b');const prepared=engine.prepared;
  engine.onEvent({type:'ended',key:'b',generation:prepared.generation});
  assert.equal(engine.snapshot().currentKey,'a');
  const before=loads.length;await engine.next({natural:true});
  assert.equal(loads.length,before);assert.equal(plays.at(-1).token,prepared.entry.token);
});
test('web fallback cannot start after a newer audio selection during volume await',async t=>{
  const {engine,plays,web}=make(t,track=>track.key==='a'?Promise.reject(new Error('use official web')):Promise.resolve({url:'https://m.music.126.net/b.mp3'}));
  let finishVolume;const webStarts=[];
  web.setVolume=()=>new Promise(resolve=>finishVolume=resolve);
  web.play=async()=>webStarts.push('a');
  const a=engine.playKey('a');await tick();await engine.playKey('b');finishVolume();await a;
  assert.deepEqual(plays.map(p=>p.key),['b']);assert.deepEqual(webStarts,[]);
});
test('paused intent rejects a delayed playing event instead of resuming itself',async t=>{
  const {engine}=make(t);await engine.playKey('a');const generation=engine.generation;
  await engine.pause();engine.onEvent({type:'playing',key:'a',generation});
  assert.equal(engine.snapshot().status,'paused');
});

function importedTrack(platform,sourceId,title,artist){
  return {key:`${platform}:${sourceId}`,platform,sourceId,title,artist,
    url:platform==='qq'?`https://y.qq.com/n/ryqq/songDetail/${sourceId}`:`https://music.163.com/song?id=${sourceId}`};
}
test('new imports preserve existing source and order when title and artist match across platforms',t=>{
  const {engine}=make(t);
  const original=importedTrack('qq','1','  ＳＯＮＧ\u3000Name ',' Artist\tName ');
  assert.equal(engine.addTracks([original]),1);
  const before=engine.snapshot();
  const duplicate=importedTrack('netease','2','song name','artist name');
  assert.deepEqual(engine.addTracksDetailed([duplicate]),{added:0,existingKey:0,duplicateMetadata:1});
  const after=engine.snapshot();
  assert.deepEqual(after.queue,before.queue);
  assert.deepEqual(after.tracks,before.tracks);
  assert.strictEqual(after.tracks.at(-1),original);
  assert.ok(!after.queue.includes(duplicate.key));
  // A rejected key is not registered as a source duplicate on a later import.
  assert.deepEqual(engine.addTracksDetailed([duplicate]),{added:0,existingKey:0,duplicateMetadata:1});
});
test('same-batch metadata and source duplicates are skipped without creating orphan queue entries',t=>{
  const {engine}=make(t);
  const first=importedTrack('qq','1','Song','Singer');
  const duplicate=importedTrack('netease','2','song','singer');
  const differentArtist=importedTrack('netease','3','Song','Other singer');
  const differentVersion=importedTrack('netease','4','Song (Live)','Singer');
  assert.deepEqual(engine.addTracksDetailed([first,duplicate,first,differentArtist,differentVersion]),
    {added:3,existingKey:1,duplicateMetadata:1});
  assert.deepEqual(engine.snapshot().queue,[first.key,differentArtist.key,differentVersion.key,'a','b','c']);
  assert.deepEqual(engine.snapshot().tracks.slice(3),[first,differentArtist,differentVersion]);
});
test('blank metadata does not suppress unrelated songs and same-source keys still deduplicate',t=>{
  const {engine}=make(t);
  const blankArtist=importedTrack('qq','1','Song','');
  const anotherBlankArtist=importedTrack('netease','2','Song',' \t ');
  const blankTitle=importedTrack('qq','3','','Singer');
  const anotherBlankTitle=importedTrack('netease','4','\n','Singer');
  const sameSourceChangedMetadata={...blankArtist,title:'Different metadata',artist:'Singer'};
  assert.deepEqual(engine.addTracksDetailed([blankArtist,anotherBlankArtist,blankTitle,anotherBlankTitle,sameSourceChangedMetadata]),
    {added:4,existingKey:1,duplicateMetadata:0});
  assert.strictEqual(engine.snapshot().tracks[3],blankArtist);
});
test('starting an existing library retains previously saved title and artist duplicates',t=>{
  const saved=[importedTrack('qq','1','Song','Singer'),importedTrack('netease','2','song','singer')];
  const audio={stopAll(){},unload(){},destroy(){}};const web={destroy(){}};
  const engine=new PlayerEngine({library:{tracks:saved,queue:saved.map(track=>track.key)},audio,web});
  t.after(()=>engine.close());
  assert.deepEqual(engine.snapshot().queue,saved.map(track=>track.key));
  assert.equal(engine.snapshot().tracks.length,2);
  assert.deepEqual(engine.addTracksDetailed([importedTrack('netease','3','Song','Singer')]),
    {added:0,existingKey:0,duplicateMetadata:1});
  assert.deepEqual(engine.snapshot().queue,saved.map(track=>track.key));
});
test('playlist imports prepend each batch, share catalog tracks, and deduplicate only inside their target',async t=>{
  const {engine,plays}=make(t);
  const originalId=engine.snapshot().activePlaylistId;
  const qq=importedTrack('qq','1','Song','Singer');
  const ne=importedTrack('netease','2','Other song','Other singer');
  engine.addTracks([qq]);engine.addTracks([ne]);
  assert.deepEqual(engine.snapshot().queue,[ne.key,qq.key,'a','b','c']);
  const second=await engine.createPlaylist('Second');
  assert.deepEqual(engine.snapshot().queue,[]);assert.equal(plays.length,0);
  assert.deepEqual(engine.addTracksDetailed([qq,ne]),{added:2,existingKey:0,duplicateMetadata:0});
  assert.deepEqual(engine.snapshot().queue,[qq.key,ne.key]);
  assert.equal(engine.snapshot().tracks.length,5,'shared source keys appear once in the global catalog');
  assert.deepEqual(engine.addTracksDetailed([importedTrack('netease','9','song','singer')]),{added:0,existingKey:0,duplicateMetadata:1});
  assert.equal(engine.addTracksDetailed([qq],originalId).existingKey,1);
  await engine.selectPlaylist(originalId);assert.deepEqual(engine.snapshot().queue,[ne.key,qq.key,'a','b','c']);
  assert.deepEqual(engine.snapshot().playlists.find(p=>p.id===second).queue,[qq.key,ne.key]);
});
test('adding to an inactive playlist or importing duplicates does not disturb live playback or prepared audio',async t=>{
  const {engine,plays}=make(t);
  const first=engine.snapshot().activePlaylistId;const second=await engine.createPlaylist('Other');await engine.selectPlaylist(first);
  await engine.playKey('a');engine.onEvent({type:'playing',key:'a',generation:engine.generation});await tick();
  const prepared=engine.prepared;assert.ok(prepared);
  const before=engine.snapshot();const active=engine.active;
  assert.deepEqual(engine.addTracksDetailed([engine.current()]),{added:0,existingKey:1,duplicateMetadata:0});
  engine.addTracksDetailed([engine.current()],second);
  const after=engine.snapshot();assert.equal(after.generation,before.generation);assert.equal(after.status,'playing');
  assert.strictEqual(engine.active,active);assert.strictEqual(engine.prepared,prepared);
  assert.deepEqual(after.queue,before.queue);assert.equal(plays.length,1);
  assert.deepEqual(after.playlists.find(p=>p.id===second).queue,['a']);
});
test('switching the browser during a resolve preserves the original playback source and mode',async t=>{
  let finishA;
  const {engine,plays}=make(t,track=>track.key==='a'?new Promise(resolve=>finishA=resolve):Promise.resolve({url:'https://m.music.126.net/b.mp3'}));
  const first=engine.snapshot().activePlaylistId;
  engine.setMode('repeat-all');
  const second=await engine.createPlaylist('Second');engine.addTracks([importedTrack('qq','7','Song','Singer')]);engine.setMode('repeat-one');
  await engine.playKey('qq:7');await engine.pause();
  await engine.selectPlaylist(first);
  const pending=engine.playKey('a');await tick();const oldGeneration=engine.generation;
  await engine.selectPlaylist(second);
  finishA({url:'https://m.music.126.net/a.mp3'});await pending;
  engine.onEvent({type:'playing',key:'a',generation:oldGeneration});
  const state=engine.snapshot();assert.equal(state.currentKey,'a');assert.equal(state.status,'playing');assert.equal(state.mode,'repeat-all');
  assert.equal(state.browseMode,'repeat-one');assert.equal(state.playbackPlaylistId,first);assert.equal(state.activePlaylistId,second);assert.deepEqual(state.queue,['qq:7']);
  assert.deepEqual(plays.map(p=>p.key),['qq:7','a']);
  await engine.selectPlaylist(first);assert.equal(engine.snapshot().currentKey,'a');assert.equal(engine.snapshot().status,'playing');
});
test('browsing another playlist during a standby load preserves the preload for the original playback queue',async t=>{
  const {engine}=make(t);const first=engine.snapshot().activePlaylistId;
  const second=await engine.createPlaylist('Second');engine.addTracks([importedTrack('qq','7','Second','Singer')]);await engine.selectPlaylist(first);
  await engine.playKey('a');
  const originalLoad=engine.audio.load;let finishLoad;const unloaded=[];
  engine.audio.load=(track,generation,resolved,slot)=>track.key==='b'?new Promise(resolve=>finishLoad=()=>resolve({key:track.key,generation,slot})):originalLoad(track,generation,resolved,slot);
  engine.audio.unload=entry=>unloaded.push(entry.key);
  const pending=engine.prepareNext();await tick();assert.equal(typeof finishLoad,'function');
  await engine.selectPlaylist(second);finishLoad();await pending;
  assert.equal(engine.prepared.key,'b');assert.deepEqual(unloaded,[]);assert.equal(engine.snapshot().currentKey,'a');assert.deepEqual(engine.snapshot().queue,['qq:7']);
  await engine.next({natural:true});assert.equal(engine.snapshot().currentKey,'b');assert.equal(engine.snapshot().playbackPlaylistId,first);
});
test('remove, clear, reorder and mode changes affect only the current playlist and preserve shared catalog references',async t=>{
  const {engine}=make(t);const first=engine.snapshot().activePlaylistId;
  const shared=engine.snapshot().tracks.find(track=>track.key==='a');
  const second=await engine.createPlaylist('Second');engine.addTracks([shared,importedTrack('qq','7','Second','Singer')]);
  engine.reorder(['qq:7','a']);engine.setMode('shuffle');await engine.remove('a');
  assert.ok(engine.snapshot().tracks.some(track=>track.key==='a'));
  await engine.clear();assert.deepEqual(engine.snapshot().queue,[]);
  assert.ok(!engine.snapshot().tracks.some(track=>track.key==='qq:7'));
  await engine.selectPlaylist(first);assert.deepEqual(engine.snapshot().queue,['a','b','c']);assert.equal(engine.snapshot().mode,'sequential');
  assert.equal(engine.snapshot().playlists.find(p=>p.id===second).mode,'shuffle');
  assert.deepEqual(engine.snapshot().tracks.map(track=>track.key),['a','b','c']);
});
test('rename and delete preserve other playlists, select a survivor, and forbid deleting the last playlist',async t=>{
  const {engine}=make(t);const first=engine.snapshot().activePlaylistId;
  const second=await engine.createPlaylist('Second');engine.addTracks([engine.snapshot().tracks[0]]);engine.renamePlaylist(second,'Renamed');
  assert.equal(engine.snapshot().playlists.find(p=>p.id===second).name,'Renamed');
  await engine.deletePlaylist(first);assert.equal(engine.snapshot().activePlaylistId,second);assert.deepEqual(engine.snapshot().queue,['a']);
  assert.deepEqual(engine.snapshot().tracks.map(track=>track.key),['a']);
  const third=await engine.createPlaylist('Third');await engine.deletePlaylist(third);
  assert.equal(engine.snapshot().activePlaylistId,second);assert.deepEqual(engine.snapshot().queue,['a']);
  await assert.rejects(engine.deletePlaylist(second),/至少需要保留一个/);
  assert.throws(()=>engine.renamePlaylist(second,'   '),/请输入歌单名称/);
});
test('multi-playlist backup creates independent new playlists with unique names and no playback interruption',async t=>{
  const {engine}=make(t);const originalId=engine.snapshot().activePlaylistId;
  await engine.playKey('a');engine.onEvent({type:'playing',key:'a',generation:engine.generation});await tick();
  const before=engine.snapshot();const prepared=engine.prepared;
  const sourceTracks=[importedTrack('qq','1','Song','Singer'),importedTrack('netease','2','song','singer'),importedTrack('qq','3','Other','Singer')];
  const backup={schemaVersion:2,tracks:sourceTracks,activePlaylistId:'two',playlists:[
    {id:'one',name:'我的歌单',queue:[sourceTracks[0].key,sourceTracks[1].key],mode:'shuffle',currentKey:sourceTracks[1].key},
    {id:'two',name:'我的歌单',queue:[sourceTracks[2].key,sourceTracks[0].key],mode:'repeat-all',currentKey:sourceTracks[2].key}]};
  assert.deepEqual(engine.importBackup(backup),{added:3,existingKey:0,duplicateMetadata:1,playlistsCreated:2});
  const after=engine.snapshot();assert.equal(after.activePlaylistId,originalId);assert.deepEqual(after.queue,before.queue);
  assert.equal(after.status,'playing');assert.equal(after.generation,before.generation);assert.strictEqual(engine.prepared,prepared);
  const imported=after.playlists.slice(1);assert.deepEqual(imported.map(p=>p.name),['我的歌单（导入）','我的歌单（导入 2）']);
  assert.deepEqual(imported[0].queue,[sourceTracks[0].key]);assert.equal(imported[0].currentKey,sourceTracks[0].key);assert.equal(imported[0].mode,'shuffle');
  assert.deepEqual(imported[1].queue,[sourceTracks[2].key,sourceTracks[0].key]);assert.equal(imported[1].mode,'repeat-all');
  assert.equal(after.tracks.length,5);
});
test('legacy backup prepends its saved batch order with cross-platform duplicate accounting',t=>{
  const {engine}=make(t);const first=importedTrack('qq','1','Song','Singer');const last=importedTrack('netease','2','Other','Singer');
  const duplicate=importedTrack('netease','3','song','singer');
  assert.deepEqual(engine.importBackup({schemaVersion:1,tracks:[first,last,duplicate],queue:[last.key,first.key,duplicate.key]}),
    {added:2,existingKey:0,duplicateMetadata:1,playlistsCreated:0});
  assert.deepEqual(engine.snapshot().queue,[last.key,first.key,'a','b','c']);assert.equal(engine.snapshot().playlists.length,1);
});
test('saved library aliases remain schema compatible while runtime mode follows the actual playback source',async t=>{
  const {engine}=make(t);let saved;engine.persist=state=>{saved=structuredClone(state);};
  const first=engine.snapshot().activePlaylistId;engine.setMode('repeat-all');await engine.playKey('b');await engine.pause();
  const second=await engine.createPlaylist('Second');engine.addTracks([engine.snapshot().tracks.find(track=>track.key==='c')]);engine.setMode('shuffle');
  const restarted=new PlayerEngine({library:saved,audio:{destroy(){},unload(){}},web:{destroy(){}}});t.after(()=>restarted.close());
  const after=restarted.snapshot();assert.equal(after.activePlaylistId,second);assert.deepEqual(after.queue,['c']);assert.equal(after.mode,'sequential');
  assert.deepEqual(after.playlists.find(p=>p.id===first),{id:first,name:'我的歌单',queue:['a','b','c'],mode:'shuffle',currentKey:'b'});
  await engine.selectPlaylist(first);assert.deepEqual(saved.queue,['a','b','c']);assert.equal(saved.mode,'shuffle');assert.equal(saved.currentKey,'b');
});
test('clearing a browsed playlist never calls pause and preserves independently captured playback',async t=>{
  const {engine,web}=make(t);const first=engine.snapshot().activePlaylistId;
  const second=await engine.createPlaylist('Second');engine.addTracks([engine.snapshot().tracks.find(track=>track.key==='b')]);await engine.selectPlaylist(first);
  await engine.playKey('a');let pauses=0;web.pause=async()=>{pauses++;};
  const pending=engine.clear();await engine.selectPlaylist(second);await pending;
  assert.equal(engine.snapshot().activePlaylistId,second);assert.deepEqual(engine.snapshot().queue,['b']);
  assert.deepEqual(engine.snapshot().playlists.find(p=>p.id===first).queue,[]);assert.deepEqual(engine.snapshot().tracks.map(track=>track.key),['b']);
  assert.equal(pauses,0);assert.equal(engine.current().key,'a');assert.deepEqual(engine.snapshot().playbackQueue,['a','b','c']);
});

test('quality preferences are independent, persisted, and do not relabel already playing audio',async t=>{
  const {engine,plays}=make(t,async()=>({url:'https://m.music.126.net/test.mp3',requestedQuality:'auto',actualQuality:'high',quality:'MP3 320 kbps',codec:'mp3',bitrate:320000}));
  let saved;engine.persist=value=>{saved=structuredClone(value);};
  await engine.playKey('a');engine.onEvent({type:'playing',key:'a',generation:engine.generation});
  const before=engine.snapshot();engine.setQuality('netease','lossless');engine.setQuality('qq','standard');
  const after=engine.snapshot();assert.equal(after.status,'playing');assert.equal(after.generation,before.generation);assert.equal(plays.length,1);
  assert.deepEqual(after.qualitySettings,{qq:'standard',netease:'lossless',bilibili:'auto'});
  assert.equal(after.playbackQuality.actual,'high');assert.equal(after.playbackQuality.label,'MP3 320 kbps');
  assert.deepEqual(saved.qualitySettings,after.qualitySettings);
  assert.throws(()=>engine.setQuality('bilibili','lossless'),/不支持/);
});

test('paused playback resumes the existing audio only when its requested quality is unchanged',async t=>{
  let engine;const requests=[];
  const fixture=make(t,async()=>{const requested=engine.state.qualitySettings.netease;requests.push(requested);return {url:'https://m.music.126.net/test.mp3',requestedQuality:requested,actualQuality:requested,quality:requested};});engine=fixture.engine;
  engine.setQuality('netease','standard');await engine.playKey('a');await engine.pause();
  await engine.playKey('a');assert.deepEqual(requests,['standard']);await engine.pause();
  engine.setQuality('netease','high');await engine.playKey('a');
  assert.deepEqual(requests,['standard','high']);assert.equal(engine.snapshot().playbackQuality.requested,'high');
});

test('a setting changed during resolution cannot relabel the old audio and reloads it on the next play',async t=>{
  let finish;let calls=0;const {engine}=make(t,()=>++calls===1?new Promise(resolve=>finish=resolve):Promise.resolve({url:'https://m.music.126.net/new.mp3',requestedQuality:'high',actualQuality:'high',quality:'MP3 320 kbps'}));
  engine.setQuality('netease','standard');const loading=engine.playKey('a');await tick();engine.setQuality('netease','high');
  finish({url:'https://m.music.126.net/old.mp3',requestedQuality:'standard',actualQuality:'standard',quality:'MP3 128 kbps'});await loading;
  assert.equal(engine.snapshot().playbackQuality.requested,'standard');assert.equal(engine.snapshot().qualitySettings.netease,'high');
  await engine.pause();await engine.playKey('a');assert.equal(calls,2);assert.equal(engine.snapshot().playbackQuality.actual,'high');
});

test('video panel expansion changes presentation without seeking, playing or persisting runtime layout',async t=>{
  const {engine,plays}=make(t);let saves=0;engine.persist=()=>saves++;
  await engine.playKey('a');await engine.pause();const before=engine.snapshot();saves=0;
  await engine.setVideoPanel({open:true,expanded:false});await engine.setVideoPanel({open:true,expanded:true});
  const expanded=engine.snapshot();assert.deepEqual(expanded.videoPanel,{open:true,expanded:true});assert.equal(expanded.currentKey,before.currentKey);assert.equal(expanded.positionMs,before.positionMs);assert.equal(expanded.generation,before.generation);assert.equal(plays.length,1);assert.equal(saves,0);
  await engine.setVideoPanel({open:false,expanded:true});assert.deepEqual(engine.snapshot().videoPanel,{open:false,expanded:false});
  await assert.rejects(engine.setVideoPanel({open:'yes'}),/侧栏参数/);
});

test('video account diagnostics expose only safe status and preview fields for the current generation',t=>{
  const {engine}=make(t);engine.queue.select('a');engine.active={backend:'video'};engine.generation=7;
  engine.onEvent({type:'ready',backend:'video',generation:7,key:'a',auth:{isLogin:true,status:'verified',credential:'not-for-state'},preview:{isPreview:false,source:'official',mediaUrl:'not-for-state'}});
  assert.deepEqual(engine.snapshot().videoAuth,{isLogin:true,status:'verified'});assert.deepEqual(engine.snapshot().videoPreview,{isPreview:false,source:'official'});
  engine.onEvent({type:'ready',backend:'video',generation:6,key:'a',auth:{isLogin:false,status:'signed-out'}});assert.equal(engine.snapshot().videoAuth.isLogin,true);
});

test('browsing never stops live audio and natural next follows the captured source rather than the visible playlist',async t=>{
  const {engine,plays}=make(t);const source=engine.snapshot().activePlaylistId;
  const other=await engine.createPlaylist('Other');engine.addTracks([importedTrack('qq','7','Other','Singer')]);await engine.selectPlaylist(source);await engine.playKey('a');
  engine.onEvent({type:'playing',key:'a',generation:engine.generation});await tick();
  let stops=0;engine.audio.stopAll=()=>stops++;const generation=engine.generation;
  await engine.selectPlaylist(other);assert.equal(stops,0);assert.equal(engine.generation,generation);assert.equal(engine.snapshot().currentTrack.key,'a');
  engine.onEvent({type:'ended',key:'a',generation});await tick();
  assert.equal(engine.snapshot().currentKey,'b');assert.equal(engine.snapshot().activePlaylistId,other);assert.equal(engine.snapshot().playbackPlaylistId,source);assert.deepEqual(plays.map(p=>p.key),['a','b']);
});

test('explicit playlist play changes source while no-key transport resumes the old source despite another browse selection',async t=>{
  const {engine,plays}=make(t);const first=engine.snapshot().activePlaylistId;
  const second=await engine.createPlaylist('Other');engine.addTracks([importedTrack('qq','7','Other','Singer')]);await engine.selectPlaylist(first);await engine.playKey('a');await engine.pause();
  await engine.selectPlaylist(second);await engine.playKey();assert.equal(engine.snapshot().currentKey,'a');assert.equal(engine.snapshot().playbackPlaylistId,first);
  await engine.selectPlaylist(first);await engine.playKey('qq:7',{playlistId:second});assert.equal(engine.snapshot().activePlaylistId,first);assert.equal(engine.snapshot().playbackPlaylistId,second);assert.equal(plays.at(-1).key,'qq:7');
});

test('removing or deleting the playing playlist preserves its current and future playback tracks after catalog pruning',async t=>{
  const {engine,plays}=make(t);const first=engine.snapshot().activePlaylistId;
  await engine.playKey('a');const other=await engine.createPlaylist('Other');engine.addTracks([importedTrack('qq','7','Other','Singer')]);await engine.selectPlaylist(first);
  let stops=0;engine.audio.stopAll=()=>stops++;await engine.remove('a');await engine.deletePlaylist(first);
  assert.equal(stops,0);assert.equal(engine.current().key,'a');assert.equal(engine.snapshot().tracks.some(track=>track.key==='a'),false);
  assert.deepEqual(engine.snapshot().playbackQueue,['a','b','c']);
  engine.onEvent({type:'ended',key:'a',generation:engine.generation});await tick();assert.equal(engine.current().key,'b');assert.equal(plays.at(-1).key,'b');assert.equal(engine.snapshot().activePlaylistId,other);
});

test('temporary playback keeps its original platform and metadata without modifying any saved playlist or catalog',async t=>{
  const {engine}=make(t);const qq=importedTrack('qq','7','Same title','Same artist');engine.addTracks([qq]);const before=engine.snapshot();
  const ne=importedTrack('netease','999','Same title','Same artist');await engine.playTemporary(ne);
  const after=engine.snapshot();assert.equal(after.currentTrack.platform,'netease');assert.equal(after.currentKey,ne.key);assert.equal(after.playbackPlaylistId,null);assert.deepEqual(after.playbackQueue,[ne.key]);
  assert.deepEqual(after.playlists,before.playlists);assert.deepEqual(after.tracks,before.tracks);assert.deepEqual(after.queue,before.queue);
  assert.ok(!require('../src/store.cjs').normaliseLibrary(after).tracks.some(track=>track.key===ne.key));
});

test('seek while resolving is applied to the loaded entry without a generation change or a second load',async t=>{
  let finish;const {engine,loads}=make(t,()=>new Promise(resolve=>finish=resolve));const seeks=[];engine.audio.seek=(entry,position)=>seeks.push([entry.key,position]);
  const loading=engine.playKey('a');await tick();const generation=engine.generation;await engine.seek(17000);finish({url:'https://m.music.126.net/a.mp3'});await loading;
  assert.equal(engine.generation,generation);assert.equal(engine.wantsPlayback,true);assert.equal(loads.length,1);assert.deepEqual(seeks,[['a',17000]]);assert.equal(engine.snapshot().positionMs,17000);
});

test('seek during a pending audio load wins over the originally captured start',async t=>{
  const {engine}=make(t);let finish;const seeks=[],plays=[];engine.audio.load=(track,generation,resolved,slot)=>new Promise(resolve=>finish=()=>resolve({key:track.key,generation,slot}));engine.audio.seek=(entry,position)=>seeks.push(position);engine.audio.activate=()=>plays.push(true);
  const loading=engine.playKey('a');await tick();await engine.seek(18000);finish();await loading;
  assert.deepEqual(seeks,[18000]);assert.equal(plays.length,1);assert.equal(engine.snapshot().positionMs,18000);
});

test('seek while playing fences stale progress and end events and preserves intent through a transient pause',async t=>{
  const {engine,loads,plays}=make(t);await engine.playKey('a');const generation=engine.generation;engine.onEvent({type:'playing',key:'a',generation});await tick();
  const beforeLoads=loads.length,beforePlays=plays.length;let stops=0;engine.audio.stopAll=()=>stops++;
  await engine.seek(19000);engine.onEvent({type:'paused',key:'a',generation});engine.onEvent({type:'progress',key:'a',generation,positionMs:1000});engine.onEvent({type:'ended',key:'a',generation,positionMs:120000});
  assert.equal(engine.snapshot().currentKey,'a');assert.equal(engine.snapshot().positionMs,19000);assert.equal(engine.wantsPlayback,true);assert.notEqual(engine.snapshot().status,'paused');
  engine.onEvent({type:'seeked',key:'a',generation,positionMs:19000});engine.onEvent({type:'playing',key:'a',generation,positionMs:19000});
  assert.equal(engine.snapshot().status,'playing');assert.equal(engine.generation,generation);assert.equal(stops,0);assert.equal(loads.length,beforeLoads);assert.equal(plays.length,beforePlays);
});

test('late browser seek completions cannot overwrite the most recent seek position',async t=>{
  const {engine,web}=make(t,async()=>{throw new Error('official web');});await engine.playKey('a');engine.onEvent({type:'playing',backend:'web',key:'a',generation:engine.generation});
  let finish;web.seek=position=>position===12000?new Promise(resolve=>finish=resolve):Promise.resolve();
  const first=engine.seek(12000);await engine.seek(23000);finish();await first;assert.equal(engine.snapshot().positionMs,23000);assert.equal(engine.wantsPlayback,true);
});

test('a stale preload load disposes before a foreground selection can reuse its slot',async t=>{
  const {engine}=make(t);const operations=[];let finish;
  engine.audio.load=async(track,generation,resolved,slot)=>{operations.push('load:'+track.key);if(track.key==='b')await new Promise(resolve=>finish=resolve);return {key:track.key,generation,slot};};engine.audio.unload=entry=>operations.push('unload:'+entry.key);
  await engine.playKey('a');const standby=engine.prepareNext();await tick();const foreground=engine.playKey('c');await tick();assert.deepEqual(operations,['load:a','load:b']);finish();await Promise.all([standby,foreground]);
  assert.deepEqual(operations,['load:a','load:b','unload:b','load:c']);assert.equal(engine.current().key,'c');assert.equal(engine.active.entry.key,'c');
});
test('batch removal persists once, affects only its target and preserves captured playback',async t=>{
  const {engine}=make(t); await engine.playKey('b');
  const original=engine.state.activePlaylistId;
  const other=await engine.createPlaylist('Other');
  engine.addTracksToPlaylist([{key:'a',platform:'netease',sourceId:'a',url:'https://music.163.com/song?id=1',title:'a'}],other);
  let saves=0; engine.persist=()=>saves++;
  await engine.removeMany(['a','b','a','unknown'],original);
  assert.equal(saves,1);
  assert.deepEqual(engine.playlist(original).queue,['c']);
  assert.deepEqual(engine.playlist(other).queue,['a']);
  assert.equal(engine.current().key,'b');
  assert.deepEqual(engine.queue.keys,['a','b','c']);
  await assert.rejects(engine.removeMany('a'),/请选择/);
});

test('live volume changes reach audio without saving until release',async t=>{
 const {engine}=make(t); const values=[]; let saves=0;
 engine.audio.volume=(volume,muted)=>values.push({volume,muted});engine.persist=()=>saves++;
 await engine.setVolume(.2,false,false);await engine.setVolume(.35,false,false);
 assert.deepEqual(values.map(v=>v.volume),[.2,.35]);assert.equal(saves,0);
 await engine.setVolume(.35,false,true);assert.equal(saves,1);assert.equal(engine.snapshot().volume,.35);
});

test('copying a playlist preserves source and playback while deduplicating the target atomically',async t=>{
 const {engine}=make(t);await engine.playKey('b');const source=engine.state.activePlaylistId;
 const target=await engine.createPlaylist('Target');engine.addTracksToPlaylist([engine.track('b')],target);
 let saved=0;engine.persist=()=>saved++;
 const result=engine.copyPlaylist(source,target);
 assert.equal(result.added,2);assert.equal(result.existingKey,1);assert.equal(saved,1);
 assert.deepEqual(engine.playlist(source).queue,['a','b','c']);assert.deepEqual(engine.playlist(target).queue,['a','c','b']);
 assert.equal(engine.current().key,'b');assert.deepEqual(engine.queue.keys,['a','b','c']);
 assert.throws(()=>engine.copyPlaylist(source,source),/不同/);assert.throws(()=>engine.copyPlaylist(source,'missing'),/不存在/);
});
