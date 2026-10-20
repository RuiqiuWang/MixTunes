'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STORAGE_KEY, sourceFor, create } = require('../ui/cover-background.js');
const snapshot = (coverUrl = 'https://covers.test/a.png', patch = {}) => ({ currentKey: 'playing', status: 'playing',
  currentTrack: { key: 'playing', platform: 'netease', coverUrl }, tracks: [], ...patch });

function fixture(initial = null, brokenStorage = false, storedOpacity = null) {
  const values = new Map(initial ? [[STORAGE_KEY, initial]] : []), images = [], jobs = new Map(), flags = new Set();
  const container = { children: [], appendChild(image) { this.children.push(image); image.parent = this; } };
  if (storedOpacity !== null) values.set('mixtunes-background-opacity', storedOpacity);
  const controller = create({ container, documentRoot: { classList: { add: flag => flags.add(flag), remove: flag => flags.delete(flag) } },
    storage: { getItem: key => values.get(key), setItem(key, value) { if (brokenStorage) throw Error('denied'); values.set(key, value); } },
    makeImage() {
      const image = { style: {}, naturalWidth: 300, naturalHeight: 300, removeAttribute(name) { delete this[name]; },
        remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } };
      images.push(image); return image;
    }, schedule(fn) { const key = Symbol(); jobs.set(key, fn); return key; }, cancel: key => jobs.delete(key) });
  return { controller, images, values, flags, container, jobs };
}

test('background defaults off and only stores the local mode, never the cover or library', () => {
  const f = fixture(); const state = snapshot(); const before = structuredClone(state);
  f.controller.update(state); assert.equal(f.images.length, 0); assert.equal(f.controller.enabled(), false);
  f.controller.setEnabled(true); assert.equal(f.images.length, 1);
  assert.deepEqual([...f.values], [[STORAGE_KEY, 'current-cover']]); assert.deepEqual(state, before);
  assert.equal(fixture('current-cover').controller.enabled(), true);
  assert.equal(fixture('unexpected-future-value').controller.enabled(), false);
});

test('only actual playback identity supplies covers, including previews and paused playback', () => {
  for (const platform of ['qq', 'netease', 'bilibili']) {
    const state = snapshot(undefined, { status: 'paused', playbackPlaylistId: null, activePlaylistId: 'different',
      currentTrack: { key: 'playing', platform, coverUrl: 'https://covers.test/a.png' } });
    assert.equal(sourceFor(state), 'https://covers.test/a.png');
  }
  assert.equal(sourceFor(snapshot(undefined, { currentTrack: { key: 'wrong', platform: 'qq', coverUrl: 'https://covers.test/wrong.png' } })), '');
  assert.equal(sourceFor(snapshot(undefined, { currentTrack: null, tracks: [{ key: 'playing', platform: 'qq', coverUrl: 'https://covers.test/right.png' }] })), 'https://covers.test/right.png');
  for (const patch of [{ currentKey: null }, { status: 'idle' }, { status: 'error' }]) assert.equal(sourceFor(snapshot(undefined, patch)), '');
});

test('background URLs never expand the existing desktop or Android image policy', () => {
  for (const url of ['http://covers.test/a.png', 'file:///private.png', 'javascript:alert(1)', '/relative.png', 'https://user:password@covers.test/a.png',
    'data:image/svg+xml;base64,AAAA', 'not a URL', '', null]) {
    assert.equal(sourceFor(snapshot(url)), ''); assert.equal(sourceFor(snapshot(url), true), '');
  }
  assert.equal(sourceFor(snapshot('data:image/png;base64,AAAA')), '');
  assert.equal(sourceFor(snapshot('data:image/png;base64,AAAA'), true), 'data:image/png;base64,AAAA');
});

test('progress, pause and browsing changes reuse the same decoded image and DOM', () => {
  const f = fixture('current-cover'); f.controller.update(snapshot()); f.images[0].onload();
  for (let i = 0; i < 100; i++) f.controller.update(snapshot(undefined, { positionMs: i * 1000, status: 'paused', activePlaylistId: 'other-' + i }));
  assert.equal(f.images.length, 1); assert.equal(f.container.children[0], f.images[0]);
  f.controller.destroy(); assert.equal(f.jobs.size, 0); assert.equal(f.container.children.length, 0);
});

test('late images cannot replace a newer cover even for A-B-A transitions', () => {
  const f = fixture('current-cover');
  f.controller.update(snapshot()); const first = f.images[0].onload;
  f.controller.update(snapshot('https://covers.test/b.png')); const second = f.images[1].onload;
  f.controller.update(snapshot()); f.images[2].onload(); first(); second();
  assert.equal(f.container.children.length, 1); assert.equal(f.container.children[0], f.images[2]);
  assert.equal(f.flags.has('has-cover-background'), true);
});

test('missing, failed and timed-out images fall back without retrying on every progress tick', () => {
  const f = fixture('current-cover'); f.controller.update(snapshot()); f.images[0].onload();
  f.controller.update(snapshot('')); assert.equal(f.flags.size, 0); assert.equal(f.container.children.length, 0);
  f.controller.update(snapshot('https://covers.test/fail.png')); f.images[1].onerror();
  f.controller.update(snapshot('https://covers.test/fail.png', { positionMs: 1000 })); assert.equal(f.images.length, 2);
  f.controller.update(snapshot('https://covers.test/timeout.png'));
  [...f.jobs.values()][0](); assert.equal(f.flags.size, 0); assert.equal(f.container.children.length, 0);
});

test('disable cancels in-flight work immediately; storage failure does not break the session', () => {
  const f = fixture('current-cover', true); f.controller.update(snapshot()); const late = f.images[0].onload;
  assert.doesNotThrow(() => f.controller.setEnabled(false)); late();
  assert.equal(f.flags.size, 0); assert.equal(f.container.children.length, 0); assert.equal(f.jobs.size, 0);
  assert.doesNotThrow(() => f.controller.setEnabled(true)); assert.equal(f.images.length, 2);
});

test('cached rapid changes keep at most two image nodes and release them on destroy', () => {
  const f = fixture('current-cover');
  for (let i = 0; i < 20; i++) {
    f.controller.update(snapshot(`https://covers.test/${i}.png`)); f.images.at(-1).onload();
    assert.ok(f.container.children.length <= 2);
  }
  f.controller.destroy(); assert.equal(f.container.children.length, 0); assert.equal(f.jobs.size, 0);
});

test('custom backgrounds ignore playback and opacity changes never replace decoded pixels',()=>{
  const f=fixture('current-cover');f.controller.update(snapshot());f.images[0].onload();
  f.controller.setCustom({version:1,image:'data:image/jpeg;base64,AAAA',crop:{x:.5,y:.5,zoom:2}});
  f.controller.setMode('custom');f.images.at(-1).onload();const image=f.container.children[0],count=f.images.length;
  f.controller.update(snapshot('https://covers.test/new.png',{status:'paused',currentKey:'another'}));
  for(const opacity of [0,50,100])f.controller.setOpacity(opacity);
  assert.equal(f.images.length,count);assert.equal(f.container.children[0],image);
  assert.equal(f.values.get('mixtunes-background-opacity'),'100');assert.equal(f.controller.mode(),'custom');
  f.controller.setMode('theme');assert.equal(f.container.children.length,0);assert.ok(f.controller.custom());
  f.controller.setMode('custom');assert.ok(f.images.at(-1).src.startsWith('data:image/jpeg'));
});

test('a custom decode failure cannot replace a later mode and falls back to theme on its own failure',()=>{
  const f=fixture('custom');f.controller.setCustom({image:'data:image/jpeg;base64,AAAA'});const late=f.images[0].onerror;
  f.controller.setMode('current-cover');f.controller.update(snapshot());late();assert.equal(f.controller.mode(),'current-cover');
  f.controller.setMode('custom');f.images.at(-1).onerror();assert.equal(f.controller.mode(),'theme');
});

test('old cover mode retains 100% defaults; all providers share persisted opacity without fetching again',()=>{
  assert.equal(fixture('current-cover').controller.opacity(),100);
  assert.equal(fixture('current-cover',false,'45').controller.opacity(),45);
  assert.equal(fixture('current-cover',false,'invalid').controller.opacity(),100);
  const unavailable=fixture('current-cover',true);
  assert.equal(unavailable.controller.setMode('theme'),false);
  assert.equal(unavailable.controller.setMode('theme'),false);
  assert.equal(unavailable.controller.setOpacity(45),false);
  for(const platform of ['qq','netease','bilibili']){
    const f=fixture('current-cover'),state=snapshot();state.currentTrack.platform=platform;
    f.controller.update(state);f.images[0].onload();
    for(const opacity of [0,50,100])f.controller.setOpacity(opacity);
    assert.equal(f.images.length,1);assert.equal(f.values.get('mixtunes-background-opacity'),'100');
    assert.equal(f.controller.mode(),'current-cover');assert.equal(state.currentTrack.platform,platform);
  }
});
