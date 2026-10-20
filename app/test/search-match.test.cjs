'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { platformId, trackIdentity, itemIdentity, isSameSong, playlistsContaining } = require('../ui/search-match.js');

const track = (platform, key, sourceId, patch = {}) => ({ platform, key, sourceId, url: patch.url || '', ...patch });
const item = (platform, id, patch = {}) => ({ platform, id, ...patch });

test('platform identifiers are validated and normalised without guessing', () => {
  assert.equal(platformId('netease', '33894312'), '33894312');
  assert.equal(platformId('netease', 'abc'), '');
  assert.equal(platformId('qq', '0016IKty1sTxqi'), '0016IKty1sTxqi');
  assert.equal(platformId('qq', 'has space'), '');
  assert.equal(platformId('bilibili', 'BV17x411w7KC'), 'BV17x411w7KC');
  assert.equal(platformId('bilibili', 'av170001'), 'av170001');
  assert.equal(platformId('bilibili', '17x411w7KC'), '');
  assert.equal(platformId('unknown', '1'), '');
});

test('netease uses the numeric id from sourceId or key', () => {
  const local = track('netease', 'netease:33894312', '33894312');
  assert.equal(isSameSong(local, item('netease', '33894312')), true);
  assert.equal(isSameSong(track('netease', 'netease:1', '1'), item('netease', '2')), false);
  assert.equal(isSameSong(track('netease', 'netease:1', '1'), item('qq', '1')), false);
});

test('qq uses the song mid from sourceId or the key suffix', () => {
  const local = track('qq', 'qq:0016IKty1sTxqi', '0016IKty1sTxqi');
  assert.equal(isSameSong(local, item('qq', '0016IKty1sTxqi')), true);
  assert.equal(isSameSong(local, item('qq', '0039MnYb0qxYhV')), false);
  assert.equal(isSameSong(local, item('netease', '0016IKty1sTxqi')), false);
});

test('bilibili matches BV ids but never guesses an av id for a BV track', () => {
  const local = track('bilibili', 'bilibili:BV17x411w7KC:12345', 'BV17x411w7KC', { url: 'https://www.bilibili.com/video/BV17x411w7KC?p=1' });
  assert.equal(isSameSong(local, item('bilibili', 'BV17x411w7KC')), true);
  assert.equal(isSameSong(local, item('bilibili', 'av170001')), false);
  assert.equal(isSameSong(local, item('bilibili', 'BV1xx411c7mD')), false);
});

test('same title and artist from another source is never considered the same song', () => {
  const local = track('netease', 'netease:1', '1', { title: '同一首歌', artist: '同一作者' });
  assert.equal(isSameSong(local, item('qq', '0016IKty1sTxqi', { title: '同一首歌', artist: '同一作者' })), false);
  assert.equal(isSameSong(local, item('netease', '2', { title: '同一首歌', artist: '同一作者' })), false);
});

test('a canonical URL remains a safe fallback when the ids are formatted differently', () => {
  const local = track('netease', 'netease:1', '1', { url: 'https://music.163.com/song?id=1' });
  assert.equal(isSameSong(local, item('netease', '999', { url: 'https://music.163.com/song?id=1' })), true);
  assert.equal(isSameSong(local, item('netease', '999', { url: 'http://music.163.com/song?id=1' })), false);
});

test('playlistsContaining reports every playlist that really holds the song', () => {
  const tracks = [track('netease', 'netease:1', '1'), track('qq', 'qq:0016IKty1sTxqi', '0016IKty1sTxqi')];
  const playlists = [
    { id: 'a', queue: ['netease:1'] },
    { id: 'b', queue: ['qq:0016IKty1sTxqi', 'netease:1'] },
    { id: 'c', queue: [] }
  ];
  assert.deepEqual(playlistsContaining(playlists, tracks, item('netease', '1')), ['a', 'b']);
  assert.deepEqual(playlistsContaining(playlists, tracks, item('qq', '0016IKty1sTxqi')), ['b']);
  assert.deepEqual(playlistsContaining(playlists, tracks, item('netease', '2')), []);
});

test('dangling queue keys and duplicate playlist ids are ignored', () => {
  const tracks = [track('netease', 'netease:1', '1')];
  const playlists = [{ id: 'a', queue: ['missing', 'netease:1'] }, { id: 'a', queue: ['netease:1'] }, null];
  assert.deepEqual(playlistsContaining(playlists, tracks, item('netease', '1')), ['a']);
});

test('identity sets expose the ids used for matching', () => {
  assert.deepEqual([...trackIdentity(track('bilibili', 'bilibili:BV17x411w7KC:9', 'BV17x411w7KC')).ids], ['BV17x411w7KC']);
  assert.deepEqual([...itemIdentity(item('qq', '0016IKty1sTxqi')).ids], ['0016IKty1sTxqi']);
});

test('Bilibili search membership distinguishes P1 from P2 and unknown parts', () => {
  const id = 'BV17x411w7KC', url = 'https://www.bilibili.com/video/' + id;
  const p1 = track('bilibili', `bilibili:${id}:101`, id, { url, extra: { page: 1 } });
  const p2 = track('bilibili', `bilibili:${id}:102`, id, { url: url + '?p=2', extra: { page: 2 } });
  const result = item('bilibili', id, { url });
  assert.equal(isSameSong(p2, result), false);
  assert.equal(isSameSong(p1, result), true);
  assert.equal(isSameSong(p2, item('bilibili', id, { url: url + '?p=2' })), true);
  assert.deepEqual(playlistsContaining([{ id: 'second', queue: [p2.key] }, { id: 'both', queue: [p1.key, p2.key] }], [p1, p2], result), ['both']);
  assert.equal(isSameSong({ ...p2, url: '' }, result), false);
  assert.equal(isSameSong({ ...p1, url: '', extra: {} }, result), false);
  assert.equal(isSameSong({ ...p1, extra: { page: 2 } }, result), false);
  assert.equal(isSameSong({ ...p1, url: url + '?p=bad', extra: {} }, result), false);
  assert.equal(isSameSong({ ...p1, url: url + '?p=1' }, result), true);
});
