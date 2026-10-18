'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi, baseState, flush } = require('./ui-harness.cjs');

async function mount(overrides) {
  const ui = createUi(baseState(overrides));
  await flush();
  return ui;
}

const sameJson = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

test('a non-Bilibili song disables the video side panel', async () => {
  const ui = await mount({ currentKey: 'netease:1', status: 'playing' });
  const toggle = ui.byId('toggle-video-panel');
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.getAttribute('aria-disabled'), 'true');
  assert.ok(toggle.title.includes('\u6ca1\u6709\u89c6\u9891'), toggle.title);
  assert.equal(ui.byId('video-panel').hidden, true);
});

test('a Bilibili song enables the video side panel', async () => {
  const ui = await mount({ currentKey: 'bilibili:1', status: 'playing' });
  const toggle = ui.byId('toggle-video-panel');
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute('aria-disabled'), 'false');
  assert.equal(toggle.title, '\u6253\u5f00\u89c6\u9891\u4fa7\u680f');
});

test('an open video panel closes when playback moves to a song without video', async () => {
  const ui = await mount({ currentKey: 'bilibili:1', status: 'playing', videoPanel: { open: true, expanded: false } });
  ui.commands.length = 0;
  ui.push({ currentKey: 'netease:1', status: 'playing', videoPanel: { open: true, expanded: false } });
  await flush();
  sameJson(ui.commands.find((entry) => entry.name === 'video-panel')?.payload, { open: false, expanded: false });
});

test('locate jumps to the playing row when the filter already shows it', async () => {
  const ui = await mount({ currentKey: 'netease:1', status: 'playing' });
  const row = [...ui.document.querySelectorAll('#track-list tr')].find((item) => item.dataset.key === 'netease:1');
  assert.ok(row, 'the playing row is rendered');
  assert.equal(row.dataset.scrolled, undefined);

  ui.byId('locate-current').click();
  await flush();
  assert.equal(row.dataset.scrolled, 'yes');
  assert.equal(row.classList.contains('located'), true);
});

test('locate clears a platform filter that hides the playing song', async () => {
  const ui = await mount({ currentKey: 'netease:1', status: 'playing' });
  // Filter the list to QQ music, which hides the NetEase song that is playing.
  ui.document.querySelector('[data-filter="qq"]').click();
  await flush();
  // Only the QQ song remains visible, so the playing NetEase song is hidden.
  assert.deepEqual([...ui.document.querySelectorAll('#track-list tr')].map((row) => row.dataset.key), ['qq:1']);

  ui.byId('locate-current').click();
  await flush();
  const rows = [...ui.document.querySelectorAll('#track-list tr')];
  assert.deepEqual(rows.map((row) => row.dataset.key), ['qq:1', 'netease:1']);
  assert.equal(ui.document.querySelector('[data-filter="all"]').classList.contains('active'), true);
  const playing = rows.find((row) => row.dataset.key === 'netease:1');
  assert.equal(playing.classList.contains('located'), true);
});

test('locate explains when the playing song belongs to another playlist', async () => {
  const ui = await mount({ currentKey: 'bilibili:1', status: 'playing' });
  ui.byId('locate-current').click();
  await flush();
  const notice = ui.byId('notice-text').textContent;
  // 正在播放的歌曲在“深夜”里，不在“通勤”。
  assert.ok(notice.includes('\u6df1\u591c'), notice);
  assert.ok(notice.includes('\u4e0d\u5728'), notice);
});

test('every playlist can be started from its own play button', async () => {
  const ui = await mount({ currentKey: 'qq:1', status: 'playing' });
  const plays = [...ui.document.querySelectorAll('[data-testid="playlist-play"]')];
  assert.equal(plays.length, 2);
  // The playlist that owns the queue is marked, the other one is not.
  assert.equal(plays[0].classList.contains('playing'), true);
  assert.equal(plays[1].classList.contains('playing'), false);

  ui.commands.length = 0;
  plays[1].click();
  await flush();
  sameJson(ui.commands.find((entry) => entry.name === 'playlist-play')?.payload, { id: 'p2' });
});

test('the playlist menu offers playing the selected playlist', async () => {
  const ui = await mount({});
  const item = ui.document.querySelector('[data-playlist-id="p2"] .playlist-item');
  item.dispatchEvent(new ui.window.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
  await flush();
  const menu = ui.byId('play-playlist');
  assert.equal(ui.byId('playlist-context-menu').hidden, false);
  assert.equal(menu.disabled, false);

  ui.commands.length = 0;
  menu.click();
  await flush();
  sameJson(ui.commands.find((entry) => entry.name === 'playlist-play')?.payload, { id: 'p2' });
});
