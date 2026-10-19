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

test('rows keep the grab handle, play button and download mark; other actions live in the right-click menu', async () => {
  const ui = await mount();
  for (const key of ['qq:1', 'netease:1']) {
    const row = rowFor(ui, key);
    assert.ok(row.querySelector('[data-testid="track-play"]'), `${key} keeps its play button`);
    const handle = row.querySelector('[data-testid="track-drag-out"]');
    assert.ok(handle, `${key} keeps a grab handle`);
    assert.equal(handle.draggable, true);
    assert.ok(handle.title.includes('拖到桌面'), handle.title);
    for (const gone of ['track-copy-link', 'track-rename', 'track-range', 'track-source', 'track-remove']) {
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

test('the grab handle drags the file out and never reorders', async () => {
  const ui = await mount();
  const handle = rowFor(ui, 'qq:1').querySelector('[data-testid="track-drag-out"]');
  handle.dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.prepareTrackFile, ['qq:1']);
  assert.ok(ui.byId('notice-text').textContent.includes('正在准备'));
  await settle();
  handle.dispatchEvent(dragEvent(ui, 'dragstart'));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['qq:1']);
  assert.equal(ui.commands.filter((entry) => entry.name === 'reorder').length, 0);
});

test('a plain row drag reorders inside the list', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  const reorder = ui.commands.find((entry) => entry.name === 'reorder');
  sameJson(reorder?.payload, { keys: ['netease:1', 'qq:1'] });
  assert.deepEqual(ui.calls.startTrackDrag, [], 'a plain drag does not export');
});

test('Alt+drag exports the file: first drag prepares it, second hands it to the OS', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { altKey: true }));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, [], 'nothing is dragged while the file is missing');
  assert.deepEqual(ui.calls.prepareTrackFile, ['qq:1']);
  assert.ok(ui.byId('notice-text').textContent.includes('正在准备'));

  await settle();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart', { altKey: true }));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['qq:1'], 'the second Alt+drag hands the file to the OS');
  assert.equal(ui.commands.filter((entry) => entry.name === 'reorder').length, 0, 'Alt+drag never reorders');
});

test('dragging a song onto another playlist moves it', async () => {
  const ui = await mount();
  rowFor(ui, 'qq:1').dispatchEvent(dragEvent(ui, 'dragstart'));
  const target = targetFor(ui, 'p2');
  target.dispatchEvent(dragEvent(ui, 'dragover'));
  assert.ok(target.classList.contains('playlist-drop-target'));
  target.dispatchEvent(dragEvent(ui, 'drop'));
  await settle();
  sameJson(ui.commands.find((entry) => entry.name === 'track-move')?.payload, { key: 'qq:1', playlistId: 'p2', copy: false });
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

test('a running download can be cancelled from the menu', async () => {
  const ui = await mount({}, { downloadPending: true });
  rightClick(ui, 'qq:1');
  menuItem(ui, 'track-menu-download').click();
  await settle();
  rightClick(ui, 'qq:1');
  const cancel = menuItem(ui, 'track-menu-cancel-download');
  assert.ok(cancel, 'the menu offers a cancel entry while downloading');
  cancel.click();
  await settle();
  assert.deepEqual(ui.calls.trackDownloadCancel, ['qq:1']);
});

test('one failed download does not block the songs queued after it', async () => {
  const ui = await mount({}, { downloadFails: ['qq:1'] });
  rightClick(ui, 'qq:1');
  menuItem(ui, 'track-menu-download').click();
  rightClick(ui, 'netease:1');
  menuItem(ui, 'track-menu-download').click();
  await settle();
  assert.deepEqual(ui.calls.trackDownload, ['qq:1', 'netease:1'], 'the second song still runs');
  await settle();
  assert.equal(rowFor(ui, 'netease:1').querySelector('[data-testid="track-downloaded"]').hidden, false);
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
  rowFor(ui, 'netease:1').dispatchEvent(dragEvent(ui, 'dragstart', { altKey: true }));
  await settle();
  assert.deepEqual(ui.calls.startTrackDrag, ['netease:1']);
  assert.deepEqual(ui.calls.prepareTrackFile, []);
});

test('the menu no longer carries manual move entries; dragging does that job', async () => {
  const ui = await mount();
  rightClick(ui, 'qq:1');
  assert.equal(menuItem(ui, 'track-menu-up'), null);
  assert.equal(menuItem(ui, 'track-menu-down'), null);
});

test('the context-menu key opens the same menu', async () => {
  const ui = await mount();
  rowFor(ui, 'netease:1').dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  assert.equal(menuFor(ui).hidden, false);
  assert.ok(menuItem(ui, 'track-menu-copy-link'));
});

test('a download shows its progress on the badge, then settles', async () => {
  const ui = await mount();
  rightClick(ui, 'qq:1');
  menuItem(ui, 'track-menu-download').click();
  ui.pushDownloadProgress({ key: 'qq:1', received: 5 * 1024 * 1024, total: 10 * 1024 * 1024 });
  const badge = rowFor(ui, 'qq:1').querySelector('[data-testid="track-downloaded"]');
  assert.equal(badge.textContent, '下载 50%');
  await settle();
  assert.equal(badge.textContent, '已下载');
});

test('the downloaded filter only keeps songs that are already on disk', async () => {
  const ui = await mount({}, { downloadedKeys: ['qq:1'] });
  await settleStatus();
  ui.byId('toggle-downloaded').click();
  await settleStatus();
  await settle();
  assert.equal(rowFor(ui, 'qq:1') !== undefined, true);
  assert.equal(rowFor(ui, 'netease:1'), undefined);
  assert.equal(ui.byId('toggle-downloaded').getAttribute('aria-pressed'), 'true');
  ui.byId('toggle-downloaded').click();
  await settle();
  assert.ok(rowFor(ui, 'netease:1'));
});

test('the downloads dialog shows the folder and can change it', async () => {
  const ui = await mount();
  ui.byId('open-downloads').click();
  await settle();
  assert.equal(ui.byId('downloads-dialog').open, true);
  assert.ok(ui.byId('downloads-path').textContent.includes('Music'));
  ui.byId('downloads-change').click();
  await settle();
  assert.deepEqual(ui.calls.chooseDownloads, [true]);
  assert.equal(ui.byId('downloads-path').textContent, 'D:\\Music');
});
