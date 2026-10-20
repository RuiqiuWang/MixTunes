'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('../app/node_modules/playwright-core');

test('packaged Windows background persists across minimize and application restart without changing transport', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-cover-'));
  const track = { key: 'netease:1', platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1', title: '隔离的封面背景测试',
    artist: '自动化测试', coverUrl: 'https://covers.test/runtime.svg', durationMs: 180000 };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ schemaVersion: 2, tracks: [track], playlists: [{ id: 'source', name: '隔离测试歌单', queue: [track.key], currentKey: track.key, mode: 'sequential' }],
    queue: [track.key], activePlaylistId: 'source', currentKey: track.key, muted: true, volume: 0 }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  async function launch() {
    if (!process.env.MIXTUNES_COVER_EXECUTABLE) throw new Error('Set MIXTUNES_COVER_EXECUTABLE to the built Windows executable');
    const app = await _electron.launch({ executablePath: process.env.MIXTUNES_COVER_EXECUTABLE,
      args: ['--test-mode', '--data-dir=' + dataDir], env, timeout: 20000 });
    t.after(() => app.close().catch(() => {}));
    const page = await app.firstWindow();
    await page.route('https://covers.test/**', route => route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#f09"/></svg>', contentType: 'image/svg+xml' }));
    await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');
    return { app, page };
  }
  const first = await launch();
  assert.equal(await first.page.locator('#cover-background img').count(), 0);
  await first.page.locator('#open-quality-settings').click();
  await first.page.locator('#background-mode').selectOption('current-cover');
  await first.page.waitForFunction(() => document.documentElement.classList.contains('has-cover-background'));
  await first.page.locator('#close-quality-settings').click();
  const before = await first.page.evaluate(() => window.playerAPI.getState());
  const id = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'MixTunes').id);
  await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), id);
  await first.page.waitForTimeout(250);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(), id), true);
  await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).restore(), id);
  assert.equal(await first.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), id), true);
  const after = await first.page.evaluate(() => window.playerAPI.getState());
  for (const key of ['currentKey', 'status', 'positionMs', 'playbackQueue', 'generation']) assert.deepEqual(after[key], before[key], key);
  assert.equal(await first.page.locator('#cover-background img').first().getAttribute('src'), track.coverUrl);
  await first.app.close();
  const second = await launch();
  await second.page.waitForFunction(() => document.documentElement.classList.contains('has-cover-background'));
  assert.equal(await second.page.locator('#background-mode').inputValue(), 'current-cover');
  const restored = await second.page.evaluate(() => window.playerAPI.getState());
  assert.equal(restored.currentKey, track.key); assert.equal(restored.status, 'paused');
  assert.ok(!fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8').includes('mixtunes-background-mode'));
  const report = { passed: true, packaged: await second.app.evaluate(({ app }) => app.isPackaged), minimizeRestore: true, settingsRestored: true,
    pausedPlaybackPreserved: true, actualPlatformPlaybackUsed: false, dataDir };
  fs.writeFileSync(path.join(dataDir, 'background-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
