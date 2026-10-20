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

test('speed slider sends the chosen rate without a play command',async()=>{
  const ui=await mount({currentKey:'qq:1',status:'paused'});ui.commands.length=0;
  const slider=ui.byId('play-rate');slider.value='1';slider.dispatchEvent(new ui.window.Event('input',{bubbles:true}));
  slider.dispatchEvent(new ui.window.Event('change',{bubbles:true}));await flush();
  const change=ui.commands.find(item=>item.name==='rate');assert.equal(change.payload.rate,2);
  assert.equal(ui.commands.some(item=>item.name==='play'),false);
});
