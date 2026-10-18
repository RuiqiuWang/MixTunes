'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerEngine } = require('../src/engine.cjs');

const tracks = [
  { key: 'a', platform: 'netease', sourceId: 'a', url: 'https://music.163.com/song?id=1', title: 'A' },
  { key: 'b', platform: 'netease', sourceId: 'b', url: 'https://music.163.com/song?id=2', title: 'B' },
  { key: 'c', platform: 'netease', sourceId: 'c', url: 'https://music.163.com/song?id=3', title: 'C' },
];

function make(t) {
  const plays = [];
  const loads = [];
  const audio = {
    async load(track, generation, resolved, slot) {
      loads.push(track.key);
      return { key: track.key, generation, slot, token: String(generation) };
    },
    activate(entry) { plays.push(entry); },
    stopAll() {}, pause() {}, seek() {}, volume() {}, unload() {}, destroy() {},
  };
  const web = { async load() {}, async pause() {}, async play() {}, async setVolume() {}, destroy() {} };
  const library = {
    schemaVersion: 2,
    tracks,
    playlists: [
      { id: 'p1', name: '通勤', queue: ['a', 'b'], mode: 'sequential', currentKey: null },
      { id: 'p2', name: '深夜', queue: ['c'], mode: 'sequential', currentKey: null },
      { id: 'empty', name: '空歌单', queue: [], mode: 'sequential', currentKey: null },
    ],
    activePlaylistId: 'p1',
  };
  const engine = new PlayerEngine({
    library,
    resolveTrack: async () => ({ url: 'https://m.music.126.net/x.mp3' }),
    contextFor: () => ({}),
    audio,
    web,
  });
  t.after(() => engine.close());
  return { engine, plays, loads };
}

test('a playlist plays on its own without changing the playlist being browsed', async (t) => {
  const { engine, plays } = make(t);
  await engine.playKey('a', { playlistId: 'p1' });

  await engine.playPlaylist('p2');
  const state = engine.snapshot();

  // Playback moved to the second playlist, but the list on screen still shows p1.
  assert.equal(state.playbackPlaylistId, 'p2');
  assert.equal(state.activePlaylistId, 'p1');
  assert.equal(state.currentKey, 'c');
  assert.deepEqual(state.playbackQueue, ['c']);
  assert.deepEqual(state.queue, ['a', 'b']);
  assert.deepEqual(plays.map((entry) => entry.key), ['a', 'c']);
});

test('a playlist starts from its stored position, otherwise from its first song', async (t) => {
  const { engine } = make(t);
  engine.state.playlists[0].currentKey = 'b';
  await engine.playPlaylist('p1');
  assert.equal(engine.snapshot().currentKey, 'b');

  engine.state.playlists[1].currentKey = 'a'; // not part of p2, must be ignored
  await engine.playPlaylist('p2');
  assert.equal(engine.snapshot().currentKey, 'c');
});

test('an empty playlist and an unknown playlist are refused', async (t) => {
  const { engine } = make(t);
  await assert.rejects(() => engine.playPlaylist('empty'), /还没有歌曲/);
  await assert.rejects(() => engine.playPlaylist('nope'), /歌单不存在/);
});

test('replaying the playlist that is already playing resumes instead of reloading', async (t) => {
  const { engine, loads } = make(t);
  await engine.playPlaylist('p1');
  engine.onEvent({ type: 'playing', key: 'a', generation: engine.generation });
  await engine.pause();
  const before = loads.length;
  await engine.playPlaylist('p1');
  assert.equal(engine.snapshot().currentKey, 'a');
  assert.equal(loads.length, before, 'a paused resume must not reload the source');
});
