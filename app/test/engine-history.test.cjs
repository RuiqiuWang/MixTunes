'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerEngine } = require('../src/engine.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const track = (platform, sourceId, title, durationMs = 12000, extra = {}) => ({
  key: `${platform}:${sourceId}`,
  platform,
  sourceId,
  title,
  artist: '测试歌手',
  durationMs,
  url: platform === 'qq' ? `https://y.qq.com/n/ryqq/songDetail/${sourceId}`
    : platform === 'bilibili' ? `https://www.bilibili.com/video/${sourceId}`
      : `https://music.163.com/song?id=${sourceId}`,
  ...(Object.keys(extra).length ? { extra } : {}),
});

function make(t, { history = [], persistHistory, duration = 12000 } = {}) {
  let clock = 0;
  const saved = [];
  const audio = {
    async load(track, generation, resolved, slot) { return { key: track.key, generation, slot, token: String(generation) }; },
    activate() {}, stopAll() {}, pause() {}, seek() {}, volume() {}, unload() {}, destroy() {},
  };
  const web = { async load() {}, async pause() {}, async play() {}, async setVolume() {}, destroy() {} };
  const tracks = [
    track('netease', '1', '第一首', duration),
    track('netease', '2', '第二首', duration),
    track('bilibili', 'BV17x411w7KC', '失败歌曲', duration, { cid: 12345, bvid: 'BV17x411w7KC' }),
  ];
  const engine = new PlayerEngine({
    library: { tracks, queue: tracks.map(item => item.key) },
    resolveTrack: async () => ({ url: 'https://m.music.126.net/test.mp3' }),
    contextFor: () => ({}),
    audio,
    web,
    history,
    now: () => clock,
    persistHistory: persistHistory || (entries => { saved.push(entries); }),
  });
  t.after(() => engine.close());
  return {
    engine,
    saved,
    advance(ms) { clock += ms; },
    async start(key) {
      await engine.playKey(key);
      const generation = engine.generation;
      engine.onEvent({ type: 'playing', key, generation });
      return generation;
    },
    progress(key, generation, positionMs, durationMs = duration) {
      engine.onEvent({ type: 'progress', key, generation, positionMs, durationMs });
    },
  };
}

test('double-speed progress is listening rather than a false seek jump',async t=>{
  const{engine,start,advance,progress}=make(t);await engine.setRate(2);
  const generation=await start('netease:1');advance(1000);progress('netease:1',generation,2000);
  advance(500);progress('netease:1',generation,3000);assert.equal(engine.historyList().length,1);
  await engine.pause();const key=engine.queue.currentKey,token=engine.generation;await engine.setRate(.75);
  assert.equal(engine.state.status,'paused');assert.equal(engine.queue.currentKey,key);assert.equal(engine.generation,token);
});

test('history records only after three seconds of effective playback', async t => {
  const { engine, saved, advance, start, progress } = make(t);
  await engine.playKey('netease:1');
  assert.equal(engine.historyList().length, 0, 'loading/clicking alone never records');
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  assert.equal(engine.historyList().length, 0);
  advance(1000); progress('netease:1', generation, 3000);
  assert.equal(engine.historyList().length, 1);
  assert.equal(engine.historyList()[0].key, 'netease:1');
  assert.equal(engine.snapshot().historyCount, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entries.length, 1);
  advance(1000); progress('netease:1', generation, 4000);
  assert.equal(engine.historyList().length, 1, 'the same playback is recorded once');
});

test('a forward seek does not fake three seconds of listening', async t => {
  const { engine, advance, start, progress } = make(t, { duration: 120000 });
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 60000);
  assert.equal(engine.historyList().length, 0, 'the 59-second jump is ignored');
  advance(1000); progress('netease:1', generation, 61000);
  assert.equal(engine.historyList().length, 0, 'only two real seconds were heard');
  advance(1000); progress('netease:1', generation, 62000);
  assert.equal(engine.historyList().length, 1);
});

test('short songs use half their duration as the threshold', async t => {
  const { engine, advance, start, progress } = make(t, { duration: 4000 });
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000, 4000);
  assert.equal(engine.historyList().length, 0);
  advance(1000); progress('netease:1', generation, 2000, 4000);
  assert.equal(engine.historyList().length, 1);
});

test('small explicit seeks and their acknowledgements never count as listening', async t => {
  const { engine, advance, start, progress } = make(t, { duration: 120000 });
  const key = 'netease:1', generation = await start(key);
  for (let i = 1; i <= 6; i++) {
    await engine.seek(i * 600);
    engine.onEvent({ type: 'seeked', key, generation, positionMs: i * 600 });
    advance(10); progress(key, generation, i * 600 + 10);
  }
  assert.equal(engine.historyList().length, 0);
  assert.equal(engine.historyClock.playedMs, 60);
  advance(2940); progress(key, generation, 6550);
  assert.equal(engine.historyList().length, 1, 'real listening after seeks still reaches the threshold');
});

test('progress acknowledging a pending seek only resets the history baseline', async t => {
  const { engine, advance, start, progress } = make(t);
  const key = 'netease:1', generation = await start(key);
  advance(1000); progress(key, generation, 1000);
  await engine.seek(1600);
  advance(10); progress(key, generation, 1600);
  assert.equal(engine.historyClock.playedMs, 1000);
  advance(2000); progress(key, generation, 3600);
  assert.equal(engine.historyList().length, 1);
});

test('pause and resume do not duplicate an entry and retain accumulated time', async t => {
  const { engine, advance, start, progress } = make(t);
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  engine.onEvent({ type: 'paused', key: 'netease:1', generation });
  engine.onEvent({ type: 'playing', key: 'netease:1', generation });
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  assert.equal(engine.historyList().length, 1);
  engine.onEvent({ type: 'paused', key: 'netease:1', generation });
  engine.onEvent({ type: 'playing', key: 'netease:1', generation });
  advance(1000); progress('netease:1', generation, 4000);
  assert.equal(engine.historyList().length, 1);
});

test('playback failure before the threshold never enters history', async t => {
  const { engine, advance, start, progress } = make(t);
  const generation = await start('bilibili:BV17x411w7KC');
  advance(1000); progress('bilibili:BV17x411w7KC', generation, 1000);
  engine.onEvent({ type: 'error', key: 'bilibili:BV17x411w7KC', generation, message: '播放失败' });
  await tick();
  assert.equal(engine.historyList().length, 0);
  assert.equal(engine.snapshot().status, 'error');
});

test('a new playback of the same song merges the consecutive entry', async t => {
  const { engine, advance, start, progress } = make(t);
  let generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  const firstId = engine.historyList()[0].id;
  await engine.playKey('netease:1');
  generation = engine.generation;
  engine.onEvent({ type: 'playing', key: 'netease:1', generation });
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  const list = engine.historyList();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, firstId);
});

test('search preview playback is included in history', async t => {
  const { engine, advance } = make(t);
  await engine.playTemporary(track('netease', '99', '试听歌曲'));
  const generation = engine.generation;
  engine.onEvent({ type: 'playing', key: 'netease:99', generation });
  advance(1000); engine.onEvent({ type: 'progress', key: 'netease:99', generation, positionMs: 1000, durationMs: 12000 });
  advance(1000); engine.onEvent({ type: 'progress', key: 'netease:99', generation, positionMs: 2000, durationMs: 12000 });
  advance(1000); engine.onEvent({ type: 'progress', key: 'netease:99', generation, positionMs: 3000, durationMs: 12000 });
  assert.equal(engine.historyList().length, 1);
  assert.equal(engine.historyList()[0].key, 'netease:99');
});

test('history replay works after the song was deleted from every playlist', async t => {
  const { engine, advance, start, progress } = make(t);
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  const id = engine.historyList()[0].id;
  await engine.remove('netease:1');
  assert.equal(engine.snapshot().playlists.some(playlist => playlist.queue.includes('netease:1')), false);
  const result = await engine.historyPlay(id);
  assert.equal(result.temporary, true);
  assert.equal(engine.current().key, 'netease:1');
});

test('history remove and clear are versioned and persisted', async t => {
  const { engine, persistHistory, saved } = make(t);
  const a = engine.history.record(track('netease', '1', '第一首'), { playedAt: 1000 });
  engine.historyChanged();
  assert.equal(engine.snapshot().historyCount, 1);
  const before = engine.snapshot().historyVersion;
  engine.historyRemove(a.id);
  assert.equal(engine.snapshot().historyCount, 0);
  assert.ok(engine.snapshot().historyVersion > before);
  assert.throws(() => engine.historyRemove('missing'), /历史记录不存在/);
  engine.historyClear();
  assert.equal(saved.length >= 2, true);
});

test('persistence failure never interrupts playback or history recording', async t => {
  const { engine, advance, start, progress } = make(t, {
    persistHistory: () => { throw new Error('disk full'); },
  });
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  assert.equal(engine.historyList().length, 1);
  assert.equal(engine.snapshot().status, 'playing');
  assert.equal(engine.snapshot().historyCount, 1);
});

test('state broadcasts history version/count only, never the entry list', async t => {
  const { engine, advance, start, progress } = make(t);
  const generation = await start('netease:1');
  advance(1000); progress('netease:1', generation, 1000);
  advance(1000); progress('netease:1', generation, 2000);
  advance(1000); progress('netease:1', generation, 3000);
  const state = engine.snapshot();
  assert.equal('history' in state, false);
  assert.equal(Array.isArray(state.historyEntries), false);
  assert.equal(state.historyCount, 1);
  assert.equal(typeof state.historyVersion, 'number');
});
