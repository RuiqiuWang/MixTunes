'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi, baseState, flush } = require('./ui-harness.cjs');

async function mount(overrides, options) {
  const ui = createUi(baseState(overrides), options);
  await flush();
  return ui;
}

const sameJson = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

// Several queued microtasks and the exporter's own promises have to run before
// the row reaches a settled export state. The initial cache lookup waits a
// quarter of a second so repeated renders only ask once.
const settle = async (rounds = 6) => {
  for (let index = 0; index < rounds; index++) await new Promise((resolve) => setTimeout(resolve, 4));
};
const settleStatus = async () => new Promise((resolve) => setTimeout(resolve, 340));

function dragEvent(ui, type, properties = {}) {
  const event = new ui.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: { effectAllowed: '', dropEffect: '', setData() {}, getData: () => '' },
  });
  for (const [name, value] of Object.entries(properties)) Object.defineProperty(event, name, { configurable: true, value });
  return event;
}

const rowFor = (ui, key) => [...ui.document.querySelectorAll('#track-list tr')].find((row) => row.dataset.key === key);
const targetFor = (ui, id) => [...ui.document.querySelectorAll('[data-testid="playlist-drop"]')].find((wrap) => wrap.dataset.playlistId === id);
const menuFor = (ui) => ui.byId('track-context-menu');
const menuItem = (ui, testid) => menuFor(ui).querySelector(`[data-testid="${testid}"]`);

function rightClick(ui, key) {
  const row = rowFor(ui, key);
  row.dispatchEvent(new ui.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
  return row;
}

test('rows keep only the play button; the other actions live in the right-click menu', async () => {
  const ui = await mount();
  for (const key of ['qq:1', 'netease:1']) {
    const row = rowFor(ui, key);
    assert.ok(row.querySelector('[data-testid="track-play"]'), `${key} keeps its play button`);
    for (const gone of ['track-copy-link', 'track-drag-out', 'track-rename', 'track-range', 'track-source', 'track-remove']) {
      assert.equal(row.querySelector(`[data-testid="${gone}"]`), null, `${key} must not render ${gone} inline`);
    }
  }
  rightClick(ui, 'qq:1');
  assert.equal(menuFor(ui).hidden, false, 'right click opens the song menu');
  const labels = [...menuFor(ui).querySelectorAll('button')].map((button) => button.dataset.testid);
  assert.deepEqual(labels, [
    'track-menu-play', 'track-menu-rename', 'track-menu-range', 'track-menu-source',
    'track-menu-copy-link', 'track-menu-download', 'track-menu-save-as', 'track-menu-remove',
  ]);
  assert.equal(menuItem(ui, 'track-menu-video'), null, 'only Bilibili rows get the video entry');
});

test('the Bilibili row adds a video entry to the menu', async () => {
  const ui = await mount({
    queue: ['qq:1', 'netease:1', 'bilibili:1'],
    playlists: [{ id: 'p1', name: '通勤', queue: ['qq:1', 'netease:1', 'bilibili:1'], mode: 'sequential', currentKey: null }],
  });
  rightClick(ui, 'bilibili:1');
  assert.ok(menuItem(ui, 'track-menu-video'), 'Bilibili songs can open their video');
});

test('copying the link works from the menu, not from the row', async () => {
  const ui = await mount();
  rightClick(ui, 'qq:1');
  menuItem(ui, 'track-menu-copy-link').click();
  await settle();
  assert.deepEqual(ui.clipboard, ['https://y.qq.com/n/ryqq/songDetail/1']);
  assert.equal(menuFor(ui).hidden, true, 'clicking an item closes the menu');
  assert.ok(ui.byId('notice-text').textContent.includes('已复制'));
});

test('a song without an address says so instead of copying nothing', async () => {
  const ui = await mount({
    tracks: [{ key: 'QQ:1', platform: 'qq', sourceId: '1', title: '稻香', artist: '周杰伦', url: '' }],
    playlists: [{ id: 'p1', name: '通勤', queue: ['QQ:1'], mode: 'sequential', currentKey: null }],
    queue: ['QQ:1'],
  });
  rightClick(ui, 'QQ:1');
  menuItem(ui, 'track-menu-copy-link').click();
  await settle();
  assert.deepEqual(ui.clipboard, []);
  assert.ok(ui.byId('notice-text').textContent.includes('没有可复制的链接'));
});

test('a plain row drag exports the file: first drag prepares it, second hands it to the OS', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, [], 'nothing is dragged while the file is missing');
  assert.deepEqual(ui.calls.prepareTrackFile, ['qq:1']);
  assert.ok(ui.byId('notice-text').textContent.includes('正在准备'));

  await settle();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['qq:1'], 'the second drag hands the file to the OS');
  assert.equal(ui.commands.filter((entry) => entry.name === 'reorder').length, 0, 'a plain drag never reorders');
});

test('Shift keeps the reorder gesture inside the list', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { shiftKey: true }));
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  const reorder = ui.commands.find((entry) => entry.name === 'reorder');
  sameJson(reorder?.payload, { keys: ['netease:1', 'qq:1'] });
  assert.deepEqual(ui.calls.startTrackDrag, [], 'Shift+drag does not export');
});

test('Shift+drag onto another playlist still moves the song', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { shiftKey: true }));
  const target = targetFor(ui, 'p2');
  target.dispatchEvent(dragEvent(ui, 'dragover'));
  assert.ok(target.classList.contains('playlist-drop-target'));
  target.dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  sameJson(ui.commands.find((entry) => entry.name === 'track-move')?.payload, { key: 'qq:1', playlistId: 'p2', copy: false });
});

test('Ctrl while dropping keeps a copy in the playlist it came from', async () => {
  const ui = await mount();
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'dragstart', { shiftKey: true }));
  const target = targetFor(ui, 'p2');
  target.dispatchEvent(dragEvent(ui, 'dragover', { ctrlKey: true }));
  target.dispatchEvent(dragEvent(ui, 'drop', { ctrlKey: true }));
  await settle();
  sameJson(ui.commands.find((entry) => entry.name === 'track-move')?.payload, { key: 'netease:1', playlistId: 'p2', copy: true });
});

test('dropping onto the playlist you are browsing does nothing', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { shiftKey: true }));
  const target = targetFor(ui, 'p1');
  target.dispatchEvent(dragEvent(ui, 'dragover'));
  assert.equal(target.classList.contains('playlist-drop-target'), false, 'the active playlist stays a reorder zone');
  target.dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  assert.equal(ui.commands.filter((entry) => entry.name === 'track-move').length, 0);
});

test('the menu download asks main to save the song and marks the row', async () => {
  const ui = await mount();
  rightClick(ui, 'qq:1');
  menuItem(ui, 'track-menu-download').click();
  await settle();
  assert.deepEqual(ui.calls.trackDownload, ['qq:1']);
  const badge = rowFor(ui, 'qq:1').querySelector('[data-testid="track-downloaded"]');
  assert.ok(badge, 'the row carries a download badge');
  assert.equal(badge.hidden, false, 'the badge appears after the download');
});

test('songs already in the download folder show the badge without a click', async () => {
  const ui = await mount({}, { downloadedKeys: ['netease:1'] });
  await settleStatus();
  assert.equal(rowFor(ui, 'netease:1').querySelector('[data-testid="track-downloaded"]').hidden, false);
  assert.equal(rowFor(ui, 'qq:1').querySelector('[data-testid="track-downloaded"]').hidden, true);
});

test('the downloaded badge opens the folder instead of downloading again', async () => {
  const ui = await mount({}, { downloadedKeys: ['qq:1'] });
  await settleStatus();
  rowFor(ui, 'qq:1').querySelector('[data-testid="track-downloaded"]').click();
  await settle();
  assert.deepEqual(ui.calls.trackReveal, ['qq:1']);
  assert.deepEqual(ui.calls.trackDownload, []);
});

test('an open menu closes when the pointer lands outside it', async () => {
  const ui = await mount();
  rightClick(ui, 'qq:1');
  assert.equal(menuFor(ui).hidden, false);
  ui.document.body.dispatchEvent(new ui.window.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(menuFor(ui).hidden, true);
});

test('the visible rows are checked against the export cache', async () => {
  const ui = await mount();
  await settleStatus();
  sameJson(ui.calls.trackFileStatus.at(-1), ['qq:1', 'netease:1']);
});

test('a cached song is exported straight away without downloading again', async () => {
  const ui = await mount({}, { readyKeys: ['netease:1'] });
  await settleStatus();
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['netease:1']);
  assert.deepEqual(ui.calls.prepareTrackFile, []);
});
