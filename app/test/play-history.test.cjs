'use strict';

const {videoTarget}=require('../src/video-player.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ENTRIES, PlayHistory, canonicalTrack, historyThreshold,
  normaliseEntry, normaliseHistory,
} = require('../src/play-history.cjs');
const { normaliseLibrary } = require('../src/store.cjs');

test('Bilibili history retains its part after the original playlist is gone',()=>{
  const history=new PlayHistory();
  history.record({platform:'bilibili',sourceId:'BV17x411w7KC',url:'https://www.bilibili.com/video/BV17x411w7KC?p=2',title:'Part two',extra:{bvid:'BV17x411w7KC',cid:222,page:2}});
  const stored=JSON.parse(JSON.stringify(history.serialize()));
  const replay=canonicalTrack(stored.entries[0]);
  assert.equal(videoTarget(replay).page,2);assert.equal(new URL(replay.url).searchParams.get('p'),'2');assert.equal(String(replay.extra.cid),'222');
});
test('history infers a missing Bilibili part field from the canonical page URL',()=>{
  const history=new PlayHistory();
  history.record({platform:'bilibili',sourceId:'BV17x411w7KC',url:'https://www.bilibili.com/video/BV17x411w7KC?p=3',title:'Third',extra:{bvid:'BV17x411w7KC',cid:333}});
  assert.equal(videoTarget(canonicalTrack(history.list()[0])).page,3);
});
test('history displays the user-renamed title',()=>{
  const history=new PlayHistory();history.record({platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'Original',displayTitle:'My name'});
  assert.equal(history.list()[0].title,'My name');
});

const netease = {
  key: 'netease:33894312', platform: 'netease', sourceId: '33894312',
  title: '夜曲', artist: '周杰伦', durationMs: 226000, coverUrl: 'https://p1.music.126.net/a.jpg',
  url: 'https://music.163.com/song?id=33894312',
  extra: { fee: 1, qqRawSong: { secret: 'must-not-persist' }, mediaMid: '001abc' },
};
const bilibili = {
  key: 'bilibili:BV17x411w7KC:12345', platform: 'bilibili', sourceId: 'BV17x411w7KC',
  title: '视频里的歌', artist: 'UP 主', durationMs: 180000,
  url: 'https://www.bilibili.com/video/BV17x411w7KC', extra: { bvid: 'BV17x411w7KC', cid: 12345, b23: 'x' },
};
const qq = {
  key: 'qq:0016IKty1sTxqi', platform: 'qq', sourceId: '0016IKty1sTxqi',
  title: '晴天', artist: '周杰伦', durationMs: 269000,
  url: 'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi', extra: { mediaMid: '0016IKty1sTxqi' },
};

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

test('history threshold is effective time: 3s normally, 50% for short tracks', () => {
  assert.equal(historyThreshold(0), 3000);
  assert.equal(historyThreshold(undefined), 3000);
  assert.equal(historyThreshold(60000), 3000);
  assert.equal(historyThreshold(4000), 2000);
  assert.equal(historyThreshold(2000), 1000);
  assert.equal(historyThreshold(500), 250);
});

test('history entries keep stable identifiers only, never media URLs or raw provider data', () => {
  const history = new PlayHistory({ newId: ids() });
  const entry = history.record(netease, { playedAt: 1000 });
  assert.equal(entry.platform, 'netease');
  assert.equal(entry.key, 'netease:33894312');
  assert.equal(entry.playedAt, 1000);
  assert.equal('url' in entry, false);
  assert.deepEqual(entry.extra, { mediaMid: '001abc' });
  assert.equal(JSON.stringify(entry).includes('secret'), false);
  const replay = canonicalTrack(entry);
  assert.equal(replay.url, 'https://music.163.com/song?id=33894312');
  assert.equal(replay.extra.mediaMid, '001abc');
});

test('Bilibili history keeps the CID needed to resolve a fresh audio URL', () => {
  const history = new PlayHistory({ newId: ids() });
  const entry = history.record(bilibili, { playedAt: 2000 });
  assert.deepEqual(entry.extra, { cid: '12345', bvid: 'BV17x411w7KC' });
  const replay = canonicalTrack(entry);
  assert.equal(replay.extra.cid, '12345');
  assert.equal(replay.key, 'bilibili:BV17x411w7KC:12345');
});

test('invalid platform ids cannot enter history and canonical URLs are rebuilt', () => {
  assert.equal(normaliseEntry({ platform: 'qq', sourceId: '', playedAt: 1 }), null);
  assert.equal(normaliseEntry({ platform: 'netease', sourceId: 'abc', playedAt: 1 }), null);
  assert.equal(normaliseEntry({ platform: 'bilibili', sourceId: 'not-a-bvid', playedAt: 1 }), null);
  assert.equal(normaliseEntry({ platform: 'spotify', sourceId: 'x', playedAt: 1 }), null);
  assert.equal(normaliseEntry({ platform: 'qq', sourceId: '0016', playedAt: 0 }), null);
  assert.equal(canonicalTrack({ platform: 'qq', sourceId: '0016' }).url, 'https://y.qq.com/n/ryqq/songDetail/0016');
});

test('consecutive replay merges the timestamp; replay after another song is a new row', () => {
  const history = new PlayHistory({ newId: ids(), now: () => 9999 });
  const first = history.record(netease, { playedAt: 1000 });
  const again = history.record(netease, { playedAt: 2000 });
  assert.equal(history.count, 1);
  assert.equal(again.id, first.id);
  assert.equal(again.playedAt, 2000);
  history.record(bilibili, { playedAt: 3000 });
  assert.equal(history.count, 2);
  history.record(netease, { playedAt: 4000 });
  assert.equal(history.count, 3);
  assert.equal(history.list()[0].key, netease.key);
  assert.notEqual(history.list()[0].id, first.id);
});

test('history is capped at 500 and drops the oldest entries', () => {
  const history = new PlayHistory({ newId: ids() });
  for (let i = 0; i < 505; i++) history.record({ ...qq, key: `qq:${i}`, sourceId: String(i) }, { playedAt: i + 1 });
  assert.equal(history.count, MAX_ENTRIES);
  assert.equal(history.list()[0].key, 'qq:504');
  assert.equal(history.list().at(-1).key, 'qq:5');
});

test('query, remove and clear operate on copies and update counts', () => {
  const history = new PlayHistory({ newId: ids() });
  const a = history.record(netease, { playedAt: 1000 });
  history.record(bilibili, { playedAt: 2000 });
  assert.equal(history.count, 2);
  const copy = history.get(a.id);
  copy.title = 'changed outside';
  assert.notEqual(history.get(a.id).title, 'changed outside');
  assert.equal(history.remove('missing'), false);
  assert.equal(history.remove(a.id), true);
  assert.equal(history.count, 1);
  assert.equal(history.clear(), 1);
  assert.equal(history.count, 0);
  assert.deepEqual(history.list(), []);
});

test('loading history normalises, sorts, deduplicates ids and enforces the cap', () => {
  const loaded = normaliseHistory([
    { platform: 'qq', sourceId: '1', playedAt: 10, id: 'a' },
    { platform: 'qq', sourceId: '2', playedAt: 30, id: 'b' },
    { platform: 'qq', sourceId: '3', playedAt: 20, id: 'c' },
    { platform: 'qq', sourceId: '4', playedAt: 40, id: 'b' },
    { platform: 'netease', sourceId: 'bad', playedAt: 50, id: 'd' },
    { platform: 'qq', sourceId: '5', playedAt: 0, id: 'e' },
  ], { max: 2, newId: ids() });
  assert.deepEqual(loaded.map(entry => entry.id), ['b', 'c']);
  assert.deepEqual(loaded.map(entry => entry.key), ['qq:2', 'qq:3']);
});

test('serialization contains only the history envelope', () => {
  const history = new PlayHistory({ newId: ids() });
  history.record(netease, { playedAt: 1000 });
  const data = history.serialize();
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.entries.length, 1);
  assert.equal('url' in data.entries[0], false);
  assert.equal(JSON.stringify(data).includes('qqRawSong'), false);
  assert.equal(JSON.stringify(data).includes('session'), false);
});

test('library normalisation and backups never carry history data', () => {
  const library = normaliseLibrary({
    tracks: [netease], queue: [netease.key],
    history: [{ ...netease, playedAt: 1 }], historyVersion: 7, historyCount: 1,
  });
  assert.equal('history' in library, false);
  assert.equal('historyVersion' in library, false);
  assert.equal('historyCount' in library, false);
  assert.equal(JSON.stringify(library).includes('playedAt'), false);
});
