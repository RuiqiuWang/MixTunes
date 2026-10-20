'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('../app/node_modules/playwright-core');

test('packaged Windows keeps live blur and opacity across tray hiding and restart', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const executable = process.env.MIXTUNES_EFFECTS_EXECUTABLE;
  assert.ok(executable && fs.existsSync(executable), 'Set MIXTUNES_EFFECTS_EXECUTABLE to the new Windows executable');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-effects-'));
  const track = { key: 'netease:1', platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1', title: '背景效果测试', artist: '自动化测试', coverUrl: 'https://covers.test/cover.svg', durationMs: 180000 };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 2, tracks: [track], playlists: [{ id: 'source', name: '隔离测试歌单', queue: [track.key], currentKey: track.key, mode: 'sequential' }],
    queue: [track.key], currentKey: track.key, activePlaylistId: 'source', muted: true, volume: 0
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#3a7"/></svg>';

  async function launch() {
    const app = await electron.launch({ executablePath: executable, args: ['--test-mode', '--data-dir=' + dataDir], env, timeout: 60000 });
    t.after(() => app.close().catch(() => {}));
    const page = await app.firstWindow();
    await page.route('https://covers.test/**', route => route.fulfill({ body: cover, contentType: 'image/svg+xml' }));
    await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');
    return { app, page };
  }
  const vars = (page) => page.evaluate(() => {
    const container = document.getElementById('cover-background');
    return { blur: container.style.getPropertyValue('--background-blur').trim(), opacity: container.style.getPropertyValue('--background-opacity').trim() };
  });
  const setRange = (page, id, value, event) => page.locator('#' + id).evaluate((node, data) => { node.value = String(data.value); node.dispatchEvent(new Event(data.event, { bubbles: true })); }, { value, event });

  const first = await launch();
  await first.page.locator('#open-quality-settings').click();
  await first.page.locator('#background-mode').selectOption('current-cover');
  await first.page.waitForFunction(() => { const image = document.querySelector('#cover-background img'); return image && image.naturalWidth > 0; });
  await setRange(first.page, 'background-blur', 40, 'input');
  await setRange(first.page, 'background-opacity', 35, 'input');
  assert.deepEqual(await vars(first.page), { blur: '40px', opacity: '0.35' });
  assert.match(await first.page.evaluate(() => getComputedStyle(document.querySelector('#cover-background img')).filter), /blur\(40px\)/);
  assert.equal(await first.page.evaluate(() => getComputedStyle(document.querySelector('.app')).filter), 'none');
  assert.equal(await first.page.evaluate(() => document.querySelectorAll('#sleep-timer-status').length), 1, 'task F panel still present');
  await setRange(first.page, 'background-blur', 40, 'change');
  await setRange(first.page, 'background-opacity', 35, 'change');
  await setRange(first.page, 'background-mask', 0, 'input');
  await first.page.evaluate(() => mixlinkTheme.set('dark'));
  await first.page.waitForFunction(() => document.querySelector('#background-mask').value === '90');
  await setRange(first.page, 'background-mask', 23, 'input');
  assert.match(await first.page.evaluate(() => getComputedStyle(document.querySelector('#cover-background'), '::after').backgroundColor), /0\.23/);
  await first.page.evaluate(() => mixlinkTheme.set('light'));
  await first.page.waitForFunction(() => document.querySelector('#background-mask').value === '0');
  const before = await first.page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  assert.equal(before['mixtunes-background-blur-cover'], '40');
  assert.equal(before['mixtunes-background-opacity'], '35');
  assert.equal(before['mixtunes-background-mask-light'], '0');
  assert.equal(before['mixtunes-background-mask-dark'], '23');

  const windowId = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MixTunes').id);
  await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), windowId);
  await first.page.waitForTimeout(300);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), windowId), false);
  await first.app.evaluate(({ app }) => app.emit('second-instance'));
  await first.page.waitForTimeout(250);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), windowId), true);
  assert.deepEqual(await vars(first.page), { blur: '40px', opacity: '0.35' }, 'tray cycle keeps the live effect');
  await first.app.close().catch(() => {});

  const second = await launch();
  await second.page.waitForFunction(() => { const image = document.querySelector('#cover-background img'); return image && image.naturalWidth > 0; });
  assert.equal(await second.page.locator('#background-mode').inputValue(), 'current-cover');
  assert.deepEqual(await vars(second.page), { blur: '40px', opacity: '0.35' }, 'restart restores both settings');
  await second.page.locator('#open-quality-settings').click();
  assert.equal(await second.page.locator('#background-blur').inputValue(), '40');
  assert.equal(await second.page.locator('#background-opacity').inputValue(), '35');
  assert.equal(await second.page.locator('#background-blur-value').textContent(), '40px');
  assert.equal(await second.page.locator('#background-mask').inputValue(), '0');
  await second.page.evaluate(() => mixlinkTheme.set('dark'));
  await second.page.waitForFunction(() => document.querySelector('#background-mask').value === '23');
  assert.equal(await second.page.evaluate(() => getComputedStyle(document.querySelector('#cover-background')).pointerEvents), 'none');
  await second.app.close().catch(() => {});
});
