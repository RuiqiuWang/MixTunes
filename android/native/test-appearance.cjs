'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'appearance.js'), 'utf8');

function boot(stored) {
  const properties = new Map();
  const events = [];
  const storage = new Map(stored === undefined ? [] : [['mixlink-background', stored]]);
  const root = {
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const window = {
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
  };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const sandbox = {
    window,
    document: { documentElement: root },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    CustomEvent,
  };
  window.window = window;
  vm.runInNewContext(source, sandbox, { filename: 'appearance.js' });
  return { api: window.mixlinkBackground, properties, events, storage, root };
}

test('no saved colour leaves the theme variables untouched', () => {
  const { api, properties, root } = boot();
  assert.equal(api.get(), '');
  assert.equal(properties.size, 0);
  assert.equal(root.attributes.has('data-background'), false);
});

test('a light solid colour derives a dark, readable palette', () => {
  const { api, properties } = boot('#f5f0e1');
  assert.equal(api.get(), '#f5f0e1');
  assert.equal(properties.get('--bg'), 'rgb(245,240,225)');
  assert.equal(properties.get('--text'), 'rgb(27,27,32)');
  assert.match(properties.get('--muted'), /^rgba\(27,27,32,0\.64\)$/);
  assert.match(properties.get('--border'), /^rgba\(27,27,32,0\.14\)$/);
  assert.notEqual(properties.get('--surface'), properties.get('--bg'));
  assert.notEqual(properties.get('--raised'), properties.get('--bg'));
  assert.equal(properties.get('--scrim'), 'rgba(0,0,0,0.32)');
});

test('a dark solid colour derives a light, readable palette', () => {
  const { api, properties } = boot('#1e293b');
  assert.equal(api.get(), '#1e293b');
  assert.equal(properties.get('--bg'), 'rgb(30,41,59)');
  assert.equal(properties.get('--text'), 'rgb(242,242,245)');
  assert.match(properties.get('--muted'), /^rgba\(242,242,245,0\.72\)$/);
  assert.equal(properties.get('--scrim'), 'rgba(0,0,0,0.55)');
  assert.equal(properties.get('--on-primary'), 'rgb(32,32,36)');
});

test('setting a colour stores it, notifies listeners, and can be cleared', () => {
  const { api, events, storage, properties } = boot();
  assert.equal(api.set('#123456'), '#123456');
  assert.equal(storage.get('mixlink-background'), '#123456');
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.color, '#123456');
  assert.equal(properties.get('--bg'), 'rgb(18,52,86)');
  api.set('#123456');
  assert.equal(events.length, 1, 'repeating the same colour must not notify twice');
  assert.equal(api.set(''), '');
  assert.equal(storage.has('mixlink-background'), false);
  assert.equal(events.length, 2);
  assert.equal(properties.size, 0, 'clearing must remove every override');
});

test('a saved colour is applied before the stylesheet loads', () => {
  const { api, properties } = boot('#eaf2ec');
  assert.equal(api.get(), '#eaf2ec');
  assert.equal(properties.get('--bg'), 'rgb(234,242,236)');
});

test('malformed values are ignored instead of breaking the palette', () => {
  for (const value of ['#12', 'red', '#1234567', '#gggggg', 'rgb(1,2,3)', '']) {
    const { api, properties } = boot(value);
    assert.equal(api.get(), '', `unexpected colour for ${JSON.stringify(value)}`);
    assert.equal(properties.size, 0);
  }
});
