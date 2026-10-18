'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppearanceStore, normaliseDim, IMAGE_NAME } = require('../src/appearance.cjs');

function profile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-appearance-'));
}

test('background scrim is clamped to a readable range', () => {
  assert.equal(normaliseDim(undefined), 0.35);
  assert.equal(normaliseDim('nope'), 0.35);
  assert.equal(normaliseDim(-1), 0);
  assert.equal(normaliseDim(2), 0.8);
  assert.equal(normaliseDim('0.45'), 0.45);
  assert.equal(normaliseDim(Number.NaN, 0.2), 0.2);
  assert.equal(normaliseDim(0.5, 9), 0.5);
});

test('a missing profile reports no background and the default scrim', () => {
  const store = new AppearanceStore(profile());
  assert.deepEqual(store.snapshot(), { image: null, dim: 0.35 });
  assert.equal(store.hasImage(), false);
});

test('saved background survives a round trip as a JPEG data URL', () => {
  const directory = profile();
  const store = new AppearanceStore(directory);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  store.writeImage(jpeg);
  store.save({ image: IMAGE_NAME, name: 'holiday.jpg', dim: 0.5 });
  const snapshot = new AppearanceStore(directory).snapshot();
  assert.equal(snapshot.image.name, 'holiday.jpg');
  assert.equal(snapshot.image.url, 'data:image/jpeg;base64,' + jpeg.toString('base64'));
  assert.equal(snapshot.dim, 0.5);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'appearance.json'), 'utf8')), { image: IMAGE_NAME, name: 'holiday.jpg', dim: 0.5 });
});

test('a picture without matching settings is ignored', () => {
  const directory = profile();
  const store = new AppearanceStore(directory);
  store.writeImage(Buffer.from([0xff, 0xd8, 1]));
  store.save({ image: null, name: '', dim: 0.3 });
  assert.deepEqual(store.snapshot(), { image: null, dim: 0.3 });
});

test('clearing removes the stored picture but keeps the scrim choice', () => {
  const directory = profile();
  const store = new AppearanceStore(directory);
  store.writeImage(Buffer.from([0xff, 0xd8, 2]));
  store.save({ image: IMAGE_NAME, name: 'x.png', dim: 0.6 });
  store.clearImage();
  store.save({ image: null, name: '', dim: store.load().dim });
  assert.equal(store.hasImage(), false);
  assert.deepEqual(store.snapshot(), { image: null, dim: 0.6 });
});

test('stored names are bounded and unsafe image flags are dropped', () => {
  const store = new AppearanceStore(profile());
  const payload = store.save({ image: '../../evil.jpg', name: 'n'.repeat(400), dim: '0.4' });
  assert.equal(payload.image, null);
  assert.equal(payload.name.length, 160);
  assert.equal(payload.dim, 0.4);
});

test('corrupt settings fall back to defaults instead of throwing', () => {
  const directory = profile();
  fs.writeFileSync(path.join(directory, 'appearance.json'), '{not json', 'utf8');
  const store = new AppearanceStore(directory);
  assert.deepEqual(store.load(), {});
  assert.deepEqual(store.snapshot(), { image: null, dim: 0.35 });
  fs.writeFileSync(path.join(directory, 'appearance.json'), '[]', 'utf8');
  assert.deepEqual(store.load(), {});
});

test('writing an empty picture buffer is rejected', () => {
  const store = new AppearanceStore(profile());
  assert.throws(() => store.writeImage(Buffer.alloc(0)), /背景图片数据无效/);
});
