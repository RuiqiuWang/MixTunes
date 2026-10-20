'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('../app/node_modules/playwright-core');

// Runs the packaged Windows build. The test hook only exists when the app was
// started with --test-mode, so it is never reachable for normal users.
test('packaged Windows sleep timer expires normally and while minimized with tray lifecycle', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.MIXTUNES_SLEEP_EXECUTABLE;
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('Set MIXTUNES_SLEEP_EXECUTABLE to this branch packaged EXE');
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-sleep-'));
  const track = { key: 'netease:1', platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1', title: '隔离定时器测试', artist: '自动化测试', durationMs: 180000 };
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 2, tracks: [track],
    playlists: [{ id: 'source', name: '隔离测试歌单', queue: [track.key], currentKey: track.key, mode: 'sequential' }],
    queue: [track.key], currentKey: track.key, activePlaylistId: 'source', muted: true, volume: 0
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, args: ['--test-mode', '--data-dir=' + dataDir], env, timeout: 60000 });
  t.after(() => app.close().catch(() => {}));
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');
  // The UI can answer IPC before loadFile resolves and setupTray completes.
  // Wait for the existing application-ready signal before testing minimize.
  const readyLog = path.join(dataDir, 'playback-events.jsonl');
  const ready = () => fs.existsSync(readyLog) && fs.readFileSync(readyLog, 'utf8').includes('"type":"app-ready"');
  for (let attempt = 0; !ready() && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready(), true, 'application startup and tray initialization completed');

  const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MixTunes').id);
  await app.evaluate(({BrowserWindow},id)=>{
    const win=BrowserWindow.fromId(id);win.__restoreCalls=0;
    for(const name of ['restore','show','focus']){
      const original=win[name];win[name]=function(...args){this.__restoreCalls++;return original.apply(this,args);};
    }
  },windowId);
  const restoreCalls=()=>app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).__restoreCalls,windowId);
  async function restoreWindow(){
    await app.evaluate(({BrowserWindow},id)=>{const win=BrowserWindow.fromId(id);if(win.isMinimized())win.restore();win.show();},windowId);
    for(let i=0;await minimized()&&i<100;i++)await page.waitForTimeout(50);
    assert.equal(await minimized(),false,'explicit restoration settled');
  }
  const minimized = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(), windowId);
  const hook = (expression) => app.evaluate(({ app }, source) => {
    const test = app.__mixSleepTest;
    if (!test) throw new Error('sleep test hook missing');
    return Function('test', 'return ' + source)(test);
  }, expression);

  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
  const timer=(action,payload)=>page.evaluate(({action,payload})=>window.playerAPI.sleepTimer(action,payload),{action,payload});
  assert.equal((await timer('set',{minutes:15})).minutes,15);
  assert.equal((await timer('set',{minutes:0})).ok,false);
  assert.equal((await timer('get')).minutes,15);
  assert.equal((await timer('set',{minutes:30})).minutes,30);
  assert.equal((await timer('cancel')).active,false);
  await page.evaluate(()=>window.playerAPI.command('seek',{positionMs:16789}));
  const before=await page.evaluate(()=>window.playerAPI.getState());
  // A playing player must be paused by the deadline while minimized.
  await hook('test.forceStatus("playing")');
  const started = await hook('test.startSeconds(2)');
  assert.equal(started.active, true);
  assert.ok(started.remainingMs > 1000 && started.remainingMs <= 2000, 'short test duration accepted');

  await app.evaluate(({ BrowserWindow }, id) => {const win=BrowserWindow.fromId(id);win.show();win.minimize();}, windowId);
  await page.waitForTimeout(400);
  assert.equal(await minimized(), true, 'original window minimizes without relying on close-to-tray');
  const restoresBeforeExpiry=await restoreCalls();
  await page.waitForTimeout(2400);

  const expired = await hook('test.state()');
  assert.equal(expired.active, false, 'deadline cleared after expiry');
  const status = await hook('test.status()');
  assert.equal(status, 'paused', 'expiry paused the active playback');
  const state = await page.evaluate(() => window.playerAPI.getState());
  assert.equal(state.status, 'paused');
  assert.equal(state.currentKey, 'netease:1', 'current track kept');
  assert.equal(state.positionMs, 16789, 'progress untouched by the timer');
  for(const key of ['queue','playbackQueue','playbackPlaylistId','playlists','mode'])assert.deepEqual(state[key],before[key],key);
  // Native minimize state can be changed externally by the desktop/window
  // manager. Assert that the timer itself never requests a restore or focus.
  assert.equal(await restoreCalls(), restoresBeforeExpiry, 'expiry never requests a window restore');
  assert.equal(app.process().killed, false, 'process stays alive after expiry');

  const log = await hook('test.log');
  const pauses = log.filter((entry) => entry.type === 'sleep-timer-expire');
  assert.equal(pauses.length, 1, 'expiry fires exactly once');
  assert.equal(pauses[0].pause, true, 'playing status requested a pause');

  // The normal window also expires; canceled and replaced deadlines are checked.
  await restoreWindow();
  assert.equal(await minimized(), false, 'normal-window expiry is independent of minimize');
  await hook('test.forceStatus("playing")');
  await hook('test.startSeconds(0.2)');await timer('cancel');await page.waitForTimeout(350);
  assert.equal(await hook('test.status()'),'playing');
  await hook('test.startSeconds(0.2)');await hook('test.startSeconds(1)');await page.waitForTimeout(350);
  assert.equal(await hook('test.status()'),'playing');
  for(let i=0;(await hook('test.state()')).active&&i<100;i++)await page.waitForTimeout(50);
  assert.equal(await hook('test.status()'),'paused');
  const normal=await page.evaluate(()=>window.playerAPI.getState());
  assert.equal((await hook('test.state()')).active,false,'authority expired the replacement');
  for(const key of ['currentKey','positionMs','queue','playbackQueue','playbackPlaylistId','playlists'])assert.deepEqual(normal[key],before[key],key);
  // A manually paused player must never be resumed by the deadline.
  await restoreWindow();
  await page.waitForTimeout(300);
  assert.equal(await minimized(), false, 'explicitly restored original window');
  await page.locator('#open-quality-settings').click();
  await page.locator('#sleep-timer-status').waitFor({ state: 'visible' });
  await page.waitForFunction(()=>document.getElementById('sleep-timer-status').textContent==='睡眠定时器未开启');
  assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器未开启');
  await page.locator('#close-quality-settings').click();

  await hook('test.forceStatus("paused")');
  await hook('test.startSeconds(1)');
  await page.waitForTimeout(1500);
  const secondLog = (await hook('test.log')).filter((entry) => entry.type === 'sleep-timer-expire');
  assert.equal(secondLog.length, 3);
  assert.equal(secondLog[1].pause,true,'normal-window expiry requested pause');
  assert.equal(secondLog[2].pause, false, 'already paused never re-issues pause');
  assert.equal(await hook('test.status()'), 'paused', 'still paused, never resumed');
  assert.equal(await page.locator('#sleep-timer-cancel').isVisible().catch(() => false), false);

  const exit = new Promise(resolve => { app.process().once('exit', code => resolve(code)); setTimeout(() => resolve(null), 15000).unref(); });
  await timer('set',{minutes:1});
  await app.evaluate(({BrowserWindow},id)=>{setTimeout(()=>BrowserWindow.fromId(id).close(),0);},windowId);
  await page.waitForTimeout(250);
  assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isVisible(),windowId),false);
  assert.equal((await timer('get')).active,true,'closing to tray retains the timer');
  await hook('test.forceStatus("playing")');await hook('test.startSeconds(.2)');
  for(let i=0;(await hook('test.state()')).active&&i<100;i++)await page.waitForTimeout(50);
  assert.equal(await hook('test.status()'),'paused','hidden playback pauses on expiry');
  await page.evaluate(()=>window.playerAPI.command('quit'));
  assert.equal(await exit,0,'explicit quit exits');
});
