'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi, baseState, flush } = require('./ui-harness.cjs');
const { suggestedScrim, MIN_SCRIM } = require('../ui/background-math.js');

const PICTURE = 'data:image/jpeg;base64,AAAA';

async function mount(options) {
  const ui = createUi(baseState(), options);
  await flush();
  await flush();
  return ui;
}

test('a saved picture turns on the background layer with a readable scrim', async () => {
  const ui = await mount({ background: { file: 'background.jpg', dim: 0.5, blur: 8, luminance: 0.9, image: PICTURE } });
  const root = ui.document.documentElement;
  assert.equal(root.classList.contains('has-background'), true);
  assert.match(root.style.getPropertyValue('--bg-image'), /^url\("data:image\/jpeg/);
  assert.equal(root.style.getPropertyValue('--bg-blur'), '8px');
  const dim = Number(root.style.getPropertyValue('--bg-dim'));
  // A bright photo on the light theme needs only the floor, but never less.
  assert.ok(dim >= suggestedScrim(0.9, 'light') - 1e-9, String(dim));
  assert.ok(dim >= MIN_SCRIM, String(dim));
});

test('the slider cannot push the scrim below what the photo needs', async () => {
  // Very dark photo + light theme means a strong scrim is required.
  const ui = await mount({ background: { file: 'background.png', dim: MIN_SCRIM, blur: 0, luminance: 0.02, image: PICTURE } });
  const root = ui.document.documentElement;
  const needed = suggestedScrim(0.02, 'light');
  assert.equal(Number(root.style.getPropertyValue('--bg-dim')), needed);
  assert.ok(needed > MIN_SCRIM);
});

test('a photo taller than the floor keeps the larger user value', async () => {
  const ui = await mount({ background: { file: 'background.png', dim: 0.9, blur: 0, luminance: 0.5, image: PICTURE } });
  assert.equal(Number(ui.document.documentElement.style.getPropertyValue('--bg-dim')), 0.9);
});

test('clearing the picture restores the plain theme', async () => {
  const ui = await mount({ background: { file: 'background.jpg', dim: 0.6, blur: 4, luminance: 0.4, image: PICTURE } });
  const root = ui.document.documentElement;
  assert.equal(root.classList.contains('has-background'), true);

  ui.pushBackground({ file: null, dim: 0.72, blur: 0, luminance: 0.5, image: null });
  await flush();
  assert.equal(root.classList.contains('has-background'), false);
  assert.equal(root.style.getPropertyValue('--bg-image'), '');
});

test('the background dialog reflects the saved picture', async () => {
  const ui = await mount({ background: { file: 'background.jpg', dim: 0.5, blur: 6, luminance: 0.9, image: PICTURE } });
  ui.byId('open-background-settings').click();
  await flush();
  assert.equal(ui.byId('background-dialog').open, true);
  assert.equal(ui.byId('background-preview').classList.contains('has-image'), true);
  assert.equal(ui.byId('background-dim').disabled, false);
  assert.equal(ui.byId('clear-background').disabled, false);
  assert.equal(ui.byId('background-blur').value, '6');
});
