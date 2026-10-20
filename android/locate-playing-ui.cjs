'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');

test('Android locate UI and bundled runtime in isolated mobile browser', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const tracks = Array.from({ length: 35 }, (_, i) => ({ key: `netease:${i + 1}`, sourceId: String(i + 1),
    platform: 'netease', url: `https://music.163.com/song?id=${i + 1}`, title: `测试歌曲 ${i + 1}`, artist: '测试作者', durationMs: 180000 }));
  const initial = { tracks, playlists: [{ id: 'source', name: '播放来源', queue: tracks.map(x => x.key), mode: 'sequential', currentKey: tracks[34].key },
    { id: 'other', name: '浏览歌单', queue: [tracks[0].key], mode: 'sequential', currentKey: null }], activePlaylistId: 'other', queue: [tracks[0].key],
    currentKey: tracks[34].key, currentTrack: tracks[34], playbackPlaylistId: 'source', playbackQueue: tracks.map(x => x.key),
    generation: 7, status: 'paused', positionMs: 42000, durationMs: 180000, volume: .7, muted: false };

  async function fixture(patch = {}, realRuntime = false) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      if (!['index.html', 'styles.css', 'ui.js', 'runtime.js', 'cover-background.css'].includes(file)) return route.abort();
      if(file==='runtime.js'&&!realRuntime)return route.fulfill({contentType:'application/javascript',body:['search-match.js','sleep-timer.js','locate-playing.js','cover-background.js','background-image.js','background-settings.js'].map(name=>fs.readFileSync(path.join(__dirname,'../app/ui',name),'utf8')).join('\n')});
      const source = path.join(__dirname, 'web', file);
      return route.fulfill({ body: fs.readFileSync(source), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript(({ snapshot, real }) => {
      window.fixtureState = snapshot; window.calls = []; window.nativeCalls = [];
      if (real) {
        let counter = 0;
        window.MixTunesBridge = {
          crypto: text => {
            const p = JSON.parse(text);
            if (p.op !== 'randomUUID') throw new Error('Unexpected crypto request: ' + p.op);
            return JSON.stringify({ ok: true, value: 'test-uuid-' + (++counter) });
          },
          postMessage: text => {
            const p = JSON.parse(text); window.nativeCalls.push(p);
            let value = true, error;
            if (p.method === 'storage-load') value = { json: JSON.stringify(snapshot) };
            else if (p.method === 'cookies') value = [];
            else if (!['storage-save', 'theme', 'app-ready', 'cancel'].includes(p.method)) error = 'Unexpected native operation: ' + p.method;
            queueMicrotask(() => window.__mixNativeReply({ id: p.id, ok: !error, value, error }));
          }
        };
        return;
      }
      window.sendState = patch => { Object.assign(window.fixtureState, patch); window.stateListener(structuredClone(window.fixtureState)); };
      window.playerAPI = {
        getState: async () => structuredClone(snapshot),
        onState: fn => { window.stateListener = fn; }, onNotice: () => {},
        lyrics: async () => ({ lines: [] }),
        command: async (name, payload) => {
          window.calls.push({ name, payload });
          if (name === 'playlist-select') {
            if (window.deferSelect) return new Promise(resolve => { window.resolveSelect = resolve; });
            window.sendState({ activePlaylistId: payload.id, queue: window.fixtureState.playlists.find(p => p.id === payload.id).queue });
          }
          return { ok: true };
        }
      };
    }, { snapshot: { ...initial, ...patch }, real: realRuntime });
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(() => window.mobileUI && !document.getElementById('locate-playing').disabled);
    return page;
  }
  const locate = page => page.locator('#locate-playing').tap();
  const located = page => page.locator('.song-row.located');
  const commands = page => page.evaluate(() => calls.filter(x => x.name !== 'theme'));
  async function assertVisible(page) {
    const rects = await located(page).evaluate(row => ({ row: row.getBoundingClientRect().toJSON(), main: document.getElementById('main-content').getBoundingClientRect().toJSON() }));
    assert.ok(rects.row.top >= rects.main.top && rects.row.bottom <= rects.main.bottom, JSON.stringify(rects));
  }

  await t.test('locates from search and lyrics or after returning from settings; clears filter without changing playback', async () => {
    for (const screen of ['search', 'settings', 'lyrics']) {
      const page = await fixture();
      await page.locator('#library-filter').fill('不存在');
      if (screen === 'lyrics') await page.locator('#open-lyrics').tap();
      else await page.locator(`[data-screen="${screen}"]`).tap();
      if (screen === 'settings') { assert.equal(await page.locator('#player').isVisible(), false); await page.locator('[data-screen="library"]').tap(); }
      await locate(page); await located(page).waitFor();
      assert.equal(await located(page).getAttribute('data-key'), initial.currentKey);
      assert.equal(await page.locator('#library-filter').inputValue(), '');
      assert.equal(await page.locator('#screen-library').isVisible(), true);
      await assertVisible(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await located(page).evaluate(row => getComputedStyle(row).animationName), 'none');
      assert.deepEqual(await commands(page), [{ name: 'playlist-select', payload: { id: 'source' } }]);
      const snapshot = await page.evaluate(() => fixtureState);
      assert.equal(snapshot.positionMs, 42000); assert.equal(snapshot.status, 'paused');
      assert.deepEqual(snapshot.playbackQueue, initial.playbackQueue);
      await page.close();
    }
  });

  await t.test('same source while playing; 320px and 390px layouts with Bilibili video button remain usable', async () => {
    const page = await fixture({ activePlaylistId: 'source', queue: initial.playbackQueue, status: 'playing', currentTrack: { ...tracks[34], platform: 'bilibili' } });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      await page.locator('#library-filter').fill('不存在');
      await locate(page); await located(page).waitFor(); await assertVisible(page);
      const size = await page.locator('#locate-playing').evaluate(button => ({ width: button.offsetWidth, height: button.offsetHeight, right: button.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.ok(size.width >= 44 && size.height >= 44 && size.right <= width && !size.overflow, JSON.stringify(size));
      assert.equal(await page.locator('#play-pause').getAttribute('aria-label'), '暂停');
      assert.deepEqual(await commands(page), []);
      if (process.env.MIXTUNES_ANDROID_SCREENSHOT) await page.screenshot({ path: process.env.MIXTUNES_ANDROID_SCREENSHOT.replace(/\.png$/, `-${width}.png`) });
    }
    await page.locator('#toggle-theme').tap();
    if (process.env.MIXTUNES_ANDROID_SCREENSHOT) await page.screenshot({ path: process.env.MIXTUNES_ANDROID_SCREENSHOT.replace(/\.png$/, '-dark.png') });
  });

  await t.test('empty playback, preview, deleted source and removed song explain why without mutation', async () => {
    for (const [patch, message] of [[{ currentKey: null, currentTrack: null }, '暂无'], [{ playbackPlaylistId: null }, '搜索试听'],
      [{ playlists: [initial.playlists[1]] }, '已删除'], [{ playlists: [{ ...initial.playlists[0], queue: [] }, initial.playlists[1]] }, '已移出']]) {
      const page = await fixture(patch); await locate(page);
      assert.ok((await page.locator('#notice-text').textContent()).includes(message));
      assert.deepEqual(await commands(page), []); assert.equal(await located(page).count(), 0);
      await page.close();
    }
  });

  await t.test('acknowledgement before state and repeated taps do not focus stale rows or send duplicate commands', async () => {
    const page = await fixture(); await page.evaluate(() => { window.deferSelect = true; });
    await locate(page); await locate(page); assert.equal((await commands(page)).length, 1);
    await page.evaluate(() => window.resolveSelect({ ok: true }));
    assert.equal(await located(page).count(), 0);
    await page.evaluate(() => window.sendState({ activePlaylistId: 'source', queue: fixtureState.playbackQueue }));
    await located(page).waitFor(); await assertVisible(page);
  });

  await t.test('song changes, replay, deletion or removal while switching cancel the old locate', async () => {
    for (const patch of [{ currentKey: tracks[0].key, currentTrack: tracks[0] }, { generation: 8 }, { playbackPlaylistId: null },
      { playlists: [initial.playlists[1]] }, { playlists: [{ ...initial.playlists[0], queue: [] }, initial.playlists[1]] }]) {
      const page = await fixture(); await page.evaluate(() => { window.deferSelect = true; }); await locate(page);
      await page.evaluate(patch => window.sendState(patch), patch);
      await page.evaluate(() => { window.sendState({ activePlaylistId: 'source', queue: fixtureState.playbackQueue }); window.resolveSelect({ ok: true }); });
      assert.equal(await located(page).count(), 0);
      assert.ok(/变化|试听|删除|移出/.test(await page.locator('#notice-text').textContent()));
      await page.close();
    }
  });

  await t.test('failed selection and missing state time out safely and permit retries', async () => {
    for (const failure of ['error', 'timeout']) {
      const page = await fixture(); await page.clock.install();
      await page.evaluate(() => { window.deferSelect = true; }); await locate(page);
      await page.evaluate(failure => window.resolveSelect(failure === 'error' ? { ok: false, error: '测试：切换失败' } : { ok: true }), failure);
      if (failure === 'timeout') await page.clock.fastForward(5001);
      await page.waitForFunction(() => /失败|尚未更新/.test(document.getElementById('notice-text').textContent));
      assert.equal(await located(page).count(), 0);
      await page.evaluate(() => { window.deferSelect = false; }); await locate(page); await located(page).waitFor();
      await page.close();
    }
  });

  await t.test('actual bundled runtime and engine select the source without native playback operations or playlist changes', async () => {
    const page = await fixture({ schemaVersion: 2, activePlaylistId: 'source', queue: initial.playbackQueue }, true);
    await page.evaluate(() => window.playerAPI.command('playlist-select', { id: 'other' }));
    const before = await page.evaluate(async () => { window.nativeCalls = []; return window.playerAPI.getState(); });
    await page.locator('#library-filter').fill('不存在');
    await locate(page); await located(page).waitFor(); await assertVisible(page);
    const after = await page.evaluate(() => window.playerAPI.getState());
    assert.equal(after.activePlaylistId, 'source');
    for (const key of ['currentKey', 'playbackPlaylistId', 'playbackQueue', 'positionMs', 'status', 'generation', 'playlists', 'tracks']) assert.deepEqual(after[key], before[key], key);
    const nativeCalls = await page.evaluate(() => nativeCalls.map(call => call.method));
    assert.ok(nativeCalls.every(method => ['storage-save', 'theme'].includes(method)), JSON.stringify(nativeCalls));
  });
});
