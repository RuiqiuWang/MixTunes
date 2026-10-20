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
