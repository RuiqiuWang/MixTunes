'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerEngine } = require('../src/engine.cjs');

function make(t) {
  const tracks = [
    { key: 'a', platform: 'netease', sourceId: 'a', url: 'https://music.163.com/song?id=1', title: 'A' },
    { key: 'b', platform: 'netease', sourceId: 'b', url: 'https://music.163.com/song?id=2', title: 'B' },
    { key: 'c', platform: 'netease', sourceId: 'c', url: 'https://music.163.com/song?id=3', title: 'C' },
  ];
  const audio = {
    async load(track, generation, resolved, slot) { return { key: track.key, generation, slot, token: String(generation) }; },
    activate() {}, stopAll() {}, pause() {}, seek() {}, volume() {}, unload() {}, destroy() {},
  };
  const web = { async load() {}, async pause() {}, async play() {}, async setVolume() {}, destroy() {} };
  const library = {
    schemaVersion: 2,
    tracks,
    playlists: [
      { id: 'p1', name: '通勤', queue: ['a', 'b'], mode: 'sequential', currentKey: null },
      { id: 'p2', name: '深夜', queue: ['c'], mode: 'sequential', currentKey: null },
      { id: 'p3', name: '空歌单', queue: [], mode: 'sequential', currentKey: null },
    ],
    activePlaylistId: 'p1',
  };
  const engine = new PlayerEngine({ library, resolveTrack: async () => ({ url: 'https://m.music.126.net/x.mp3' }), contextFor: () => ({}), audio, web });
  t.after(() => engine.close());
  const find = (id) => engine.state.playlists.find((playlist) => playlist.id === id);
  return { engine, find };
}

test('dragging a song onto another playlist moves it there', (t) => {
  const { engine, find } = make(t);
  const result = engine.moveTrackToPlaylist('a', 'p2');
  assert.deepEqual(find('p1').queue, ['b']);
  assert.deepEqual(find('p2').queue, ['a', 'c'], 'the moved song joins the front of the drop target');
  assert.equal(result.copied, false);
  assert.equal(result.playlistName, '深夜');
  assert.equal(result.trackTitle, 'A');
  assert.ok(engine.state.tracks.some((track) => track.key === 'a'), 'the track object survives the move');
});

test('the target playlist is left untouched when it already owns the song', (t) => {
  const { engine, find } = make(t);
  assert.throws(() => engine.moveTrackToPlaylist('a', 'p1'), /已经有这首歌/);
  assert.deepEqual(find('p1').queue, ['a', 'b']);
});

test('Ctrl-drag copies instead of moving', (t) => {
  const { engine, find } = make(t);
  const result = engine.moveTrackToPlaylist('a', 'p2', { copy: true });
  assert.equal(result.copied, true);
  assert.deepEqual(find('p1').queue, ['a', 'b'], 'the source keeps its copy');
  assert.deepEqual(find('p2').queue, ['a', 'c']);
});

test('copying into a playlist that already has the song reports it', (t) => {
  const { engine, find } = make(t);
  assert.throws(() => engine.moveTrackToPlaylist('c', 'p2', { copy: true }), /已经有这首歌/);
  assert.deepEqual(find('p2').queue, ['c']);
});

test('a song can be moved into an empty playlist', (t) => {
  const { engine, find } = make(t);
  engine.moveTrackToPlaylist('b', 'p3');
  assert.deepEqual(find('p3').queue, ['b']);
});

test('unknown songs and playlists are rejected', (t) => {
  const { engine } = make(t);
  assert.throws(() => engine.moveTrackToPlaylist('missing', 'p2'), /歌曲不存在/);
  assert.throws(() => engine.moveTrackToPlaylist('a', 'nope'), /歌单不存在/);
});

test('moving a song does not stop what is playing', async (t) => {
  const { engine, find } = make(t);
  await engine.playKey('a', { playlistId: 'p1' });
  const playing = engine.current().key;
  engine.moveTrackToPlaylist('a', 'p2');
  assert.equal(engine.current().key, playing);
  assert.notEqual(engine.state.status, 'idle', 'playback must survive the move');
  assert.ok(find('p2').queue.includes('a'));
});

test('a song present in several playlists leaves all of them', (t) => {
  const { engine, find } = make(t);
  engine.addTracksToPlaylist([{ key: 'a', platform: 'netease', sourceId: 'a', url: 'https://music.163.com/song?id=1', title: 'A' }], 'p3', false);
  assert.ok(find('p3').queue.includes('a'));
  engine.moveTrackToPlaylist('a', 'p2');
  assert.deepEqual(find('p1').queue, ['b']);
  assert.deepEqual(find('p3').queue, []);
  assert.ok(find('p2').queue.includes('a'));
});
