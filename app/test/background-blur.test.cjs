'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, BLUR_KEYS, OPACITY_KEY, STORAGE_KEY } = require('../ui/cover-background.js');

function fixture({ mode = 'theme', values = {}, matchSmall = false, broken = false, rect = { width: 1000, height: 800 } } = {}) {
  const map = new Map(Object.entries({ [STORAGE_KEY]: mode, ...values }));
  const vars = new Map(), images = [], flags = new Set(), errors = [];
  const container = {
    children: [],
    style: { setProperty(name, value) { vars.set(name, value); } },
    getBoundingClientRect: () => rect,
    appendChild(image) { this.children.push(image); image.parent = this; }
  };
  const controller = create({
    container,
    documentRoot: { classList: { add: flag => flags.add(flag), remove: flag => flags.delete(flag) } },
    storage: {
      getItem: key => map.get(key),
      setItem(key, value) { if (broken) throw Error('denied'); map.set(key, value); }
    },
    matchMedia: () => ({ matches: matchSmall }),
    makeImage() {
      const image = { style: {}, naturalWidth: 300, naturalHeight: 300, removeAttribute(name) { delete this[name]; },
        remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } };
      images.push(image); return image;
    },
    schedule() { return Symbol('timer'); },
    cancel() {},
    onStorageError: () => errors.push(true)
  });
  return { controller, map, vars, images, flags, errors, container };
}

const snapshot = () => ({ currentKey: 'k', status: 'playing', currentTrack: { key: 'k', platform: 'netease', coverUrl: 'https://covers.test/a.png' } });

test('legacy cover blur stays responsive and custom blur starts clear', () => {
  assert.equal(fixture({ mode: 'current-cover' }).controller.blur(), 24);
  assert.equal(fixture({ mode: 'current-cover', matchSmall: true }).controller.blur(), 18);
  assert.equal(fixture({ mode: 'custom' }).controller.blur(), 0);
  assert.equal(fixture({ mode: 'theme' }).controller.blur(), 0);
});

test('legacy users keep their defaults without new storage writes', () => {
  const f = fixture({ mode: 'current-cover' });
  assert.equal(f.map.has(BLUR_KEYS.cover), false);
  assert.equal(f.map.has(BLUR_KEYS.custom), false);
  assert.equal(f.vars.get('--background-blur'), '24px');
  assert.equal(f.map.size, 1);
});

test('cover and custom blur are remembered independently', () => {
  const f = fixture({ mode: 'current-cover' });
  assert.equal(f.controller.setBlur(40), true);
  assert.equal(f.map.get(BLUR_KEYS.cover), '40');
  assert.equal(f.controller.blur(), 40);
  assert.equal(f.vars.get('--background-blur'), '40px');

  f.controller.setMode('custom');
  assert.equal(f.controller.blur(), 0);
  assert.equal(f.controller.setBlur(12), true);
  assert.equal(f.map.get(BLUR_KEYS.custom), '12');

  f.controller.setMode('current-cover');
  assert.equal(f.controller.blur(), 40, 'cover value survives custom edits');
  f.controller.setMode('custom');
  assert.equal(f.controller.blur(), 12, 'custom value survives cover edits');
});

test('theme mode keeps both saved values and applies no blur', () => {
  const f = fixture({ mode: 'current-cover', values: { [BLUR_KEYS.cover]: '30', [BLUR_KEYS.custom]: '20' } });
  f.controller.setMode('theme');
  assert.equal(f.controller.blur(), 0);
  assert.equal(f.vars.get('--background-blur'), '0px');
  assert.equal(f.map.get(BLUR_KEYS.cover), '30');
  assert.equal(f.map.get(BLUR_KEYS.custom), '20');
  f.controller.setMode('custom');
  assert.equal(f.controller.blur(), 20);
});

test('preview writes apply immediately without touching storage', () => {
  const f = fixture({ mode: 'current-cover' });
  f.controller.setBlur(20, { persist: false });
  f.controller.setOpacity(50, { persist: false });
  assert.equal(f.vars.get('--background-blur'), '20px');
  assert.equal(f.vars.get('--background-opacity'), '0.5');
  assert.equal(f.map.has(BLUR_KEYS.cover), false);
  assert.equal(f.map.has(OPACITY_KEY), false);
});

test('released sliders persist exactly once per value', () => {
  const f = fixture({ mode: 'current-cover' });
  f.controller.setBlur(16);
  f.controller.setOpacity(35);
  assert.equal(f.map.get(BLUR_KEYS.cover), '16');
  assert.equal(f.map.get(OPACITY_KEY), '35');
});

test('invalid stored blur falls back to the legacy default', () => {
  for (const value of ['41', '-1', 'abc', '']) {
    const f = fixture({ mode: 'current-cover', values: { [BLUR_KEYS.cover]: value } });
    assert.equal(f.controller.blur(), 24, value);
  }
});

test('blur clamps to 0-40 whole pixels', () => {
  const f = fixture({ mode: 'current-cover' });
  f.controller.setBlur(99); assert.equal(f.controller.blur(), 40);
  f.controller.setBlur(-3); assert.equal(f.controller.blur(), 0);
  f.controller.setBlur(3.6); assert.equal(f.controller.blur(), 4);
  f.controller.setBlur('invalid'); assert.equal(f.controller.blur(), 0);
});

test('explicit blur adds edge compensation, legacy defaults do not', () => {
  const legacy = fixture({ mode: 'current-cover', rect: { width: 320, height: 640 } });
  assert.equal(legacy.vars.get('--background-blur-scale'), '0', 'legacy framing is untouched');

  const explicit = fixture({ mode: 'current-cover', rect: { width: 1000, height: 800 } });
  explicit.controller.setBlur(40, { persist: false });
  assert.equal(explicit.vars.get('--background-blur-scale'), '0.125', '40px on an 800px edge');
  explicit.controller.setBlur(0, { persist: false });
  assert.equal(explicit.vars.get('--background-blur-scale'), '0');
});

test('storage failures are reported without breaking the live effect', () => {
  const f = fixture({ mode: 'current-cover', broken: true });
  assert.equal(f.controller.setBlur(30), false);
  assert.equal(f.controller.setOpacity(40), false);
  assert.ok(f.errors.length >= 2);
  assert.equal(f.controller.blur(), 30);
  assert.equal(f.vars.get('--background-blur'), '30px');
});

test('moving the sliders never rebuilds or reloads the decoded image', () => {
  const f = fixture({ mode: 'current-cover' });
  f.controller.update(snapshot());
  f.images[0].onload();
  const image = f.container.children[0];
  const count = f.images.length;
  const clone = structuredClone(snapshot());
  for (const value of [0, 20, 40, 0]) f.controller.setBlur(value, { persist: false });
  for (const value of [0, 50, 100]) f.controller.setOpacity(value, { persist: false });
  f.controller.update({ ...clone, positionMs: 99999 });
  assert.equal(f.images.length, count);
  assert.ok(image);
});
