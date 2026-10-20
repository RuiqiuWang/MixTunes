'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { target } = require('../ui/locate-playing.js');
const state = () => ({ currentKey: 'a', playbackPlaylistId: 'source', generation: 3,
  tracks: [{ key: 'a' }], playlists: [{ id: 'source', queue: ['a'] }] });

test('locate uses playback origin even when browsing a different playlist', () => {
  const snapshot = { ...state(), activePlaylistId: 'other', queue: [] };
  const before = structuredClone(snapshot);
  assert.deepEqual(target(snapshot), { key: 'a', playlistId: 'source', generation: 3 });
  assert.deepEqual(snapshot, before);
});

test('locate explains empty playback, preview, deleted origin and removed track', () => {
  for (const [patch, message] of [
    [{ currentKey: null }, '暂无'],
    [{ playbackPlaylistId: null }, '搜索试听'],
    [{ playlists: [] }, '已删除'],
    [{ playlists: [{ id: 'source', queue: [] }] }, '已移出'],
    [{ tracks: [] }, '已移出']
  ]) assert.ok(target({ ...state(), ...patch }).message.includes(message));
});

test('a song in multiple playlists still targets only the captured playback source', () => {
  const snapshot=state();snapshot.activePlaylistId='other';snapshot.playlists.push({id:'other',queue:['a']});
  assert.equal(target(snapshot).playlistId,'source');
  snapshot.playlists=snapshot.playlists.filter(p=>p.id!=='source');
  assert.match(target(snapshot).message,/已删除/,'never substitutes another playlist containing the song');
});

for (const status of ['playing','paused']) {
  test(`real engine browsing for locate preserves ${status}, progress and playback without backend calls`, async t=>{
    const {PlayerEngine}=require('../src/engine.cjs');
    const calls=[],backend=new Proxy({}, {get:(_,name)=>(...args)=>{calls.push({name,args});}});
    const track={key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1'};
    const engine=new PlayerEngine({library:{schemaVersion:2,tracks:[track],playlists:[{id:'source',queue:[track.key],currentKey:track.key},{id:'other',queue:[track.key]}],activePlaylistId:'source'},audio:backend,web:backend,resolveTrack:async()=>{},contextFor:()=>({})});
    t.after(()=>engine.close());engine.state.status=status;engine.state.positionMs=42123;
    await engine.selectPlaylist('other');
    const before=engine.snapshot(),request=target(before);calls.length=0;
    await engine.selectPlaylist(request.playlistId);
    const after=engine.snapshot();
    for(const key of ['currentKey','status','positionMs','generation','playbackQueue','playbackPlaylistId','playlists','tracks','mode'])assert.deepEqual(after[key],before[key],key);
    assert.deepEqual(calls,[]);
  });
}
