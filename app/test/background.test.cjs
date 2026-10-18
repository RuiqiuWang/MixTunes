'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MIN_SCRIM, MAX_SCRIM, MAX_BLUR, normaliseBackground, suggestedScrim } = require('../ui/background-math.js');
const { BackgroundStore } = require('../src/background.cjs');

test('the scrim keeps a bright photo readable on both themes', () => {
  const light = suggestedScrim(0.95, 'light');
  const dark = suggestedScrim(0.95, 'dark');
  // White-ish photo: the light theme needs little scrim, the dark theme a lot.
  assert.ok(light < 0.6, String(light));
  assert.ok(dark > 0.85, String(dark));
});

test('a dark photo needs more scrim on the light theme', () => {
  assert.ok(suggestedScrim(0.05, 'light') > suggestedScrim(0.5, 'light'));
  assert.ok(suggestedScrim(0.05, 'light') > 0.85);
});

test('the scrim never leaves the readability window', () => {
  for (const luminance of [0, 0.25, 0.5, 0.75, 1]) {
    for (const theme of ['light', 'dark']) {
      const value = suggestedScrim(luminance, theme);
      assert.ok(value >= MIN_SCRIM, `${theme} ${luminance} -> ${value}`);
      assert.ok(value <= MAX_SCRIM, `${theme} ${luminance} -> ${value}`);
    }
  }
});

test('a mid-grey photo gives the same answer for both themes', () => {
  assert.equal(suggestedScrim(0.5, 'light'), suggestedScrim(0.5, 'dark'));
});

test('dim cannot be dragged below the readability floor', () => {
  assert.equal(normaliseBackground({ dim: 0 }).dim, MIN_SCRIM);
  assert.equal(normaliseBackground({ dim: 5 }).dim, MAX_SCRIM);
  assert.equal(normaliseBackground({ dim: 'nonsense' }).dim, 0.72);
  assert.equal(normaliseBackground({ blur: 999 }).blur, MAX_BLUR);
  assert.equal(normaliseBackground({ blur: -4 }).blur, 0);
});

test('only plain image file names are accepted', () => {
  assert.equal(normaliseBackground({ file: 'background.png' }).file, 'background.png');
  assert.equal(normaliseBackground({ file: '../../secret.png' }).file, null);
  assert.equal(normaliseBackground({ file: 'notes.txt' }).file, null);
  assert.equal(normaliseBackground({ file: null }).file, null);
  assert.equal(normaliseBackground(undefined).file, null);
});

test('the store round-trips settings and copies the chosen picture', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-bg-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'holiday.jpeg');
  fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const store = new BackgroundStore(directory);
  const file = store.adopt(source);
  assert.equal(file, 'background.jpg');
  store.save({ file, dim: 0.66, blur: 12, luminance: 0.3 });

  const reloaded = new BackgroundStore(directory);
  assert.equal(reloaded.settings.file, 'background.jpg');
  assert.equal(reloaded.settings.dim, 0.66);
  assert.equal(reloaded.settings.blur, 12);
  assert.ok(fs.existsSync(reloaded.imagePath()));

  reloaded.clear();
  assert.equal(reloaded.settings.file, null);
  assert.equal(fs.existsSync(path.join(directory, 'background.jpg')), false);
});

test('the store rejects unsupported pictures', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-bg-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new BackgroundStore(directory);
  const text = path.join(directory, 'notes.txt');
  fs.writeFileSync(text, 'not an image');
  assert.throws(() => store.adopt(text), /JPG/);
});
