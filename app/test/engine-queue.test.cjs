'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerEngine } = require('../src/engine.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const track = (id, durationMs = 30000) => ({
  key: `netease:${id}`, platform: 'netease', sourceId: String(id), title: `歌曲 ${id}`,
  artist: '歌手', durationMs, url: `https://music.163.com/song?id=${id}`,
});

function make(t, mode = 'sequential') {
  const audio = {
    async load(track, generation, resolved, slot) { return { key: track.key, generation, slot, token: String(generation) }; },
    activate() {}, stopAll() {}, pause() {}, seek() {}, volume() {}, unload() {}, destroy() {},
  };
  const web = { async load() {}, async pause() {}, async play() {}, async setVolume() {}, destroy() {} };
  const tracks = [track(1), track(2), track(3), track(4)];
  const keys = tracks.map(item => item.key);
  const engine = new PlayerEngine({
    library: { tracks, playlists: [{ id: 'p', name: '测试歌单', queue: keys, mode, currentKey: null }], activePlaylistId: 'p' },
    resolveTrack: async () => ({ url: 'https://m.music.126.net/test.mp3' }),
    contextFor: () => ({}),
    audio, web,
  });
  t.after(() => engine.close());
  return engine;
}
async function play(engine, key) {
  await engine.playKey(key);
  const generation = engine.generation;
  engine.onEvent({ type: 'playing', key, generation });
  await tick();
  return generation;
}
const keysOf = preview => preview.upcoming.map(item => item.key);

test('queue preview follows sequential order and exposes current song metadata', async t => {
  const engine = make(t);
  await play(engine, 'netease:1');
  const preview = engine.queuePreview();
  assert.equal(preview.mode, 'sequential');
  assert.equal(preview.currentKey, 'netease:1');
  assert.equal(preview.current.title, '歌曲 1');
  assert.deepEqual(keysOf(preview), ['netease:2', 'netease:3', 'netease:4']);
  assert.equal(preview.canReorder, true);
  assert.deepEqual(keysOf(engine.queuePreview(2)), ['netease:2', 'netease:3']);
});

test('sequential queueMove changes the real next song and never the playlist', async t => {
  const engine = make(t);
  await play(engine, 'netease:1');
  const before = engine.snapshot().playlists[0].queue.slice();
  const preview = engine.queueMove(2, 0);
  assert.deepEqual(keysOf(preview), ['netease:4', 'netease:2', 'netease:3']);
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:4');
  assert.deepEqual(engine.snapshot().playlists[0].queue, before);
  assert.deepEqual(keysOf(engine.queuePreview()), ['netease:2', 'netease:3']);
});

test('queueMove cancels the stale preload and prepares the new next song', async t => {
  const engine = make(t);
  await play(engine, 'netease:1');
  assert.equal(engine.prepared?.key, 'netease:2');
  const preview = engine.queueMove(2, 0);
  assert.equal(engine.prepared, null, 'the old preload was discarded immediately');
  assert.deepEqual(keysOf(preview), ['netease:4', 'netease:2', 'netease:3']);
  await tick();
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:4');
});

test('shuffle drag rewrites the live bag and next() matches the preview', async t => {
  const engine = make(t, 'shuffle');
  await play(engine, 'netease:1');
  const preview = engine.queuePreview();
  assert.equal(preview.mode, 'shuffle');
  const moved = preview.upcoming.at(-1).key;
  const after = engine.queueMove(preview.upcoming.length - 1, 0);
  assert.equal(after.upcoming[0].key, moved);
  assert.equal(engine.queue.bag[0], moved);
  assert.deepEqual(keysOf(engine.queuePreview()), keysOf(after));
  await engine.next();
  assert.equal(engine.snapshot().currentKey, moved);
  assert.deepEqual(engine.snapshot().playlists[0].queue, ['netease:1', 'netease:2', 'netease:3', 'netease:4']);
});

test('shuffle play-next pins the song once and keeps preview/actual aligned', async t => {
  const engine = make(t, 'shuffle');
  await play(engine, 'netease:1');
  const preview = engine.queuePreview();
  const target = preview.upcoming[2].key;
  const after = engine.queuePlayNext(target);
  assert.equal(after.upcoming[0].key, target);
  assert.equal(engine.queue.bag.filter(key => key === target).length, 1);
  await engine.next();
  assert.equal(engine.snapshot().currentKey, target);
});

test('repeat-all drag can move a wrapped song and keeps history/wrap working', async t => {
  const engine = make(t, 'repeat-all');
  await play(engine, 'netease:1');
  assert.deepEqual(keysOf(engine.queuePreview()), ['netease:2', 'netease:3', 'netease:4']);
  const before = engine.snapshot().playlists[0].queue.slice();
  const preview = engine.queueMove(2, 0);
  assert.deepEqual(keysOf(preview), ['netease:4', 'netease:2', 'netease:3']);
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:4');
  assert.equal(await engine.previous(), undefined);
  assert.equal(engine.snapshot().currentKey, 'netease:1');
  assert.deepEqual(engine.snapshot().playlists[0].queue, before);
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:4');
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:2');
});

test('sequential play-next moves a song directly after the current one', async t => {
  const engine = make(t);
  await play(engine, 'netease:1');
  const preview = engine.queuePlayNext('netease:3');
  assert.deepEqual(keysOf(preview), ['netease:3', 'netease:2', 'netease:4']);
  await engine.next();
  assert.equal(engine.snapshot().currentKey, 'netease:3');
});

test('repeat-one reports a loop instead of a fake upcoming queue', async t => {
  const engine = make(t, 'repeat-one');
  await play(engine, 'netease:1');
  const preview = engine.queuePreview();
  assert.equal(preview.repeatOne, true);
  assert.equal(preview.canReorder, false);
  assert.deepEqual(preview.upcoming, []);
  assert.throws(() => engine.queueMove(0, 1), /单曲循环/);
  assert.throws(() => engine.queuePlayNext('netease:2'), /单曲循环/);
});

test('invalid queue edits are rejected without mutating playlist or queue', async t => {
  const engine = make(t);
  await play(engine, 'netease:1');
  const before = engine.snapshot().playbackQueue.slice();
  assert.throws(() => engine.queueMove(-1, 0), /待播位置/);
  assert.throws(() => engine.queuePlayNext('missing'), /不在播放列表/);
  assert.deepEqual(engine.snapshot().playbackQueue, before);
  assert.deepEqual(engine.snapshot().playlists[0].queue, ['netease:1', 'netease:2', 'netease:3', 'netease:4']);
});
