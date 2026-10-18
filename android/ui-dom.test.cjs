'use strict';
// Run with: node android/test-ui-dom.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileUi, baseState, flush } = require('./test-ui-dom.cjs');

async function mount(overrides) {
  const ui = createMobileUi(baseState(overrides));
  await flush();
  // The UI connects on "mixtunes-ready"; jsdom evaluates the script immediately.
  ui.window.dispatchEvent(new ui.window.Event('mixtunes-ready'));
  await flush();
  await flush();
  return ui;
}

const sameJson = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

test('every playlist in the picker can be started on its own', async () => {
  const ui = await mount({ currentKey: 'qq:1', status: 'playing' });
  ui.byId('choose-playlist').click();
  await flush();

  const plays = [...ui.document.querySelectorAll('.playlist-play')];
  assert.equal(plays.length, 3, 'one play button per playlist');
  // The playlist that owns the queue is marked, and an empty one cannot start.
  assert.equal(plays[0].classList.contains('playing'), true);
  assert.equal(plays[1].classList.contains('playing'), false);
  assert.equal(plays[2].disabled, true);

  ui.commands.length = 0;
  plays[1].click();
  await flush();
  // 深夜 (p2) starts playing while 通勤 (p1) stays the playlist on screen.
  sameJson(ui.commands.find((entry) => entry.name === 'playlist-play')?.payload, { id: 'p2' });
});

test('locate jumps to the playing row and clears a filter that hides it', async () => {
  const ui = await mount({ currentKey: 'netease:1', status: 'playing' });
  assert.equal(ui.byId('locate-current').hidden, false);

  // Filter to something that hides the playing song.
  const input = ui.byId('library-filter');
  input.value = '稻香';
  input.dispatchEvent(new ui.window.Event('input'));
  await flush();
  assert.deepEqual([...ui.document.querySelectorAll('.song-row')].map((row) => row.dataset.key), ['qq:1']);

  ui.byId('locate-current').click();
  await flush();
  const rows = [...ui.document.querySelectorAll('.song-row')];
  assert.deepEqual(rows.map((row) => row.dataset.key), ['qq:1', 'netease:1']);
  assert.equal(ui.byId('library-filter').value, '');
  const playing = rows.find((row) => row.dataset.key === 'netease:1');
  assert.equal(playing.classList.contains('located'), true);
});

test('locate explains when the playing song belongs to another playlist', async () => {
  const ui = await mount({ currentKey: 'bilibili:1', status: 'playing' });
  ui.byId('locate-current').click();
  await flush();
  const notice = ui.byId('notice-text').textContent;
  assert.ok(notice.includes('深夜'), notice);
  assert.ok(notice.includes('不在'), notice);
});

test('the locate control stays hidden until something is playing', async () => {
  const ui = await mount({ currentKey: null, status: 'idle' });
  assert.equal(ui.byId('locate-current').hidden, true);
  ui.push({ currentKey: 'qq:1', status: 'playing' });
  await flush();
  assert.equal(ui.byId('locate-current').hidden, false);
});
