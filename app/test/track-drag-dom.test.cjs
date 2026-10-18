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
const handleFor = (ui, key) => rowFor(ui, key)?.querySelector('[data-testid="track-drag-out"]');
const targetFor = (ui, id) => [...ui.document.querySelectorAll('[data-testid="playlist-drop"]')].find((wrap) => wrap.dataset.playlistId === id);

test('every row carries the copy-link and drag-out buttons', async () => {
  const ui = await mount();
  for (const key of ['qq:1', 'netease:1']) {
    const row = rowFor(ui, key);
    assert.ok(row.querySelector('[data-testid="track-copy-link"]'), `${key} can be copied`);
    const handle = row.querySelector('[data-testid="track-drag-out"]');
    assert.ok(handle, `${key} can be dragged out`);
    assert.equal(handle.draggable, true);
    assert.ok(handle.title.includes('拖到桌面'), handle.title);
  }
});

test('the copy button puts the platform address on the clipboard', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').querySelector('[data-testid="track-copy-link"]').click();
  await settle();
  assert.deepEqual(ui.clipboard, ['https://y.qq.com/n/ryqq/songDetail/1']);
  assert.ok(ui.byId('notice-text').textContent.includes('已复制'));
});

test('a song without an address says so instead of copying nothing', async () => {
  const ui = await mount({
    tracks: [{ key: 'QQ:1', platform: 'qq', sourceId: '1', title: '稻香', artist: '周杰伦', url: '' }],
    playlists: [{ id: 'p1', name: '通勤', queue: ['QQ:1'], mode: 'sequential', currentKey: null }],
    queue: ['QQ:1'],
  });
  rowFor(ui, 'QQ:1').querySelector('[data-testid="track-copy-link"]').click();
  await settle();
  assert.deepEqual(ui.clipboard, []);
  assert.ok(ui.byId('notice-text').textContent.includes('没有可复制的链接'));
});

test('dragging out before the file exists asks the main process to prepare it', async () => {
  const ui = await mount();
  handleFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, [], 'nothing is dragged while the file is missing');
  assert.deepEqual(ui.calls.prepareTrackFile, ['qq:1']);
  assert.ok(ui.byId('notice-text').textContent.includes('正在准备'));

  await settle();
  handleFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['qq:1'], 'the second drag hands the file to the OS');
  assert.ok(handleFor(ui, 'qq:1').classList.contains('ready'));
});

test('the export handle does not start the row reorder drag', async () => {
  const ui = await mount({ readyKeys: undefined });
  handleFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.equal(ui.commands.filter((entry) => entry.name === 'reorder').length, 0);
});

test('Alt turns a row drag into a file export drag', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { altKey: true }));
  await settle();
  assert.deepEqual(ui.calls.prepareTrackFile, ['qq:1']);
  targetFor(ui, 'p2').dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  assert.equal(ui.commands.filter((entry) => entry.name === 'track-move').length, 0, 'Alt+drag must not be captured as a playlist move');
});

test('dropping a song on another playlist moves it', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  const target = targetFor(ui, 'p2');
  target.dispatchEvent(dragEvent(ui, 'dragover'));
  assert.ok(target.classList.contains('playlist-drop-target'));
  target.dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  const move = ui.commands.find((entry) => entry.name === 'track-move');
  sameJson(move?.payload, { key: 'qq:1', playlistId: 'p2', copy: false });
  assert.equal(target.classList.contains('playlist-drop-target'), false);
  assert.ok(ui.byId('notice-text').textContent.includes('移到'));
});

test('Ctrl while dropping keeps a copy in the playlist it came from', async () => {
  const ui = await mount();
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  const target = targetFor(ui, 'p2');
  target.dispatchEvent(dragEvent(ui, 'dragover', { ctrlKey: true }));
  target.dispatchEvent(dragEvent(ui, 'drop', { ctrlKey: true }));
  await settle();
  sameJson(ui.commands.find((entry) => entry.name === 'track-move')?.payload, { key: 'netease:1', playlistId: 'p2', copy: true });
});

test('dropping onto the playlist you are browsing does nothing', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  const target = targetFor(ui, 'p1');
  target.dispatchEvent(dragEvent(ui, 'dragover'));
  assert.equal(target.classList.contains('playlist-drop-target'), false, 'the active playlist stays a reorder zone');
  target.dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  assert.equal(ui.commands.filter((entry) => entry.name === 'track-move').length, 0);
});

test('the visible rows are checked against the export cache', async () => {
  const ui = await mount();
  await settleStatus();
  sameJson(ui.calls.trackFileStatus.at(-1), ['qq:1', 'netease:1']);
});

test('a cached song shows as ready without being downloaded again', async () => {
  const ui = await mount({}, { readyKeys: ['netease:1'] });
  await settleStatus();
  const handle = handleFor(ui, 'netease:1');
  assert.ok(handle.classList.contains('ready'));
  assert.ok(handle.title.includes('已就绪'));
  handle.dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['netease:1']);
  assert.deepEqual(ui.calls.prepareTrackFile, []);
});
