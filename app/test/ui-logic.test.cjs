'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../ui/ui-logic.js');

const bilibili = { key: 'bilibili:1', platform: 'bilibili', title: '演唱会现场' };
const qq = { key: 'qq:2', platform: 'qq', title: '晴天' };
const netease = { key: 'netease:3', platform: 'netease', title: '海阔天空' };

test('video panel is offered for Bilibili tracks', () => {
  assert.deepEqual(logic.videoPanelAvailability(bilibili), { available: true, reason: '打开视频侧栏' });
});

test('video panel is refused for other platforms and explains why', () => {
  const qqResult = logic.videoPanelAvailability(qq);
  assert.equal(qqResult.available, false);
  assert.match(qqResult.reason, /晴天/);
  assert.match(qqResult.reason, /QQ 音乐/);

  const neteaseResult = logic.videoPanelAvailability(netease);
  assert.equal(neteaseResult.available, false);
  assert.match(neteaseResult.reason, /网易云/);
});

test('video panel is refused when nothing is playing', () => {
  const result = logic.videoPanelAvailability(null);
  assert.equal(result.available, false);
  assert.match(result.reason, /B 站/);
});

test('an open panel closes when playback moves to a track without video', () => {
  assert.equal(logic.shouldCloseVideoPanel(bilibili.key, netease), true);
  assert.equal(logic.shouldCloseVideoPanel(bilibili.key, qq), true);
});

test('the panel stays open while on video content and on the first render', () => {
  const other = { key: 'bilibili:9', platform: 'bilibili', title: '另一个视频' };
  assert.equal(logic.shouldCloseVideoPanel(bilibili.key, other), false);
  assert.equal(logic.shouldCloseVideoPanel(bilibili.key, bilibili), false);
  assert.equal(logic.shouldCloseVideoPanel('', qq), false);
});

test('filter and query matching mirrors the rendered list', () => {
  assert.equal(logic.matchesTrackQuery(qq, 'all', ''), true);
  assert.equal(logic.matchesTrackQuery(qq, 'netease', ''), false);
  assert.equal(logic.matchesTrackQuery(qq, 'qq', '晴'), true);
  assert.equal(logic.matchesTrackQuery(qq, 'qq', '周杰伦'), false);
  assert.equal(logic.matchesTrackQuery({ key: 'x', platform: 'qq', title: 'Blue', artist: 'Jazz' }, 'all', 'jazz'), true);
  assert.equal(logic.matchesTrackQuery(null, 'all', ''), false);
});

test('locate tells scroll, clear-the-filter and missing apart', () => {
  assert.equal(logic.locateOutcome({ inPlaylist: true, hiddenByFilter: false }), 'scroll');
  assert.equal(logic.locateOutcome({ inPlaylist: true, hiddenByFilter: true }), 'clear');
  assert.equal(logic.locateOutcome({ inPlaylist: false, hiddenByFilter: false }), 'missing');
  assert.equal(logic.locateOutcome({ inPlaylist: false, hiddenByFilter: true }), 'missing');
});

test('the per-playlist play button starts at the stored song, else the first', () => {
  assert.equal(logic.playlistPlayTarget({ queue: ['a', 'b'], currentKey: 'b' }), 'b');
  assert.equal(logic.playlistPlayTarget({ queue: ['a', 'b'], currentKey: null }), 'a');
  // A stored key that is no longer part of the playlist must not be used.
  assert.equal(logic.playlistPlayTarget({ queue: ['a', 'b'], currentKey: 'z' }), 'a');
  assert.equal(logic.playlistPlayTarget({ queue: [] }), null);
  assert.equal(logic.playlistPlayTarget(null), null);
});
