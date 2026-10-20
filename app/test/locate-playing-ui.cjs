'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

test('Windows locate UI with isolated bridge and no external requests', async (t) => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const tracks = Array.from({ length: 35 }, (_, i) => ({ key: `netease:${i}`, sourceId: String(i),
    platform: 'netease', title: `测试歌曲 ${i}`, artist: '测试作者', durationMs: 180000 }));
  const initial = { tracks, playlists: [{ id: 'source', name: '播放来源', queue: tracks.map(x => x.key) },
    { id: 'other', name: '浏览歌单', queue: [tracks[0].key] }], activePlaylistId: 'other', queue: [tracks[0].key],
    currentKey: tracks[34].key, currentTrack: tracks[34], playbackPlaylistId: 'source', playbackQueue: tracks.map(x => x.key),
    generation: 7, status: 'paused', positionMs: 42000, durationMs: 180000 };

  async function fixture(patch = {}) {
    const page = await browser.newPage({ viewport: { width: 1240, height: 840 } });
    await page.route(/^https?:/, route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.addInitScript(snapshot => {
      window.fixtureState = snapshot;
      window.calls = [];
      window.sendState = patch => { Object.assign(window.fixtureState, patch); window.stateListener(structuredClone(window.fixtureState)); };
      window.playerAPI = {
        getState: async () => structuredClone(window.fixtureState),
        onState: listener => { window.stateListener = listener; }, onNotice: () => {},
        command: async (name, payload) => {
          window.calls.push({ name, payload });
          if (name === 'playlist-select') {
            if (window.deferSelect) return new Promise(resolve => { window.resolveSelect = resolve; });
            const playlist = window.fixtureState.playlists.find(p => p.id === payload.id);
            window.sendState({ activePlaylistId: payload.id, queue: playlist.queue });
          }
          return { ok: true };
        }
      };
    }, { ...initial, ...patch });
    await page.goto(pathToFileURL(path.join(__dirname, '../ui/index.html')).href);
    await page.waitForFunction(() => document.getElementById('connection-status').textContent === '已就绪');
    t.after(() => page.close());
    return { page, errors };
  }
  const locate = page => page.getByTestId('locate-playing').click();
  const located = page => page.locator('tr.located');
  const commands = page => page.evaluate(() => window.calls.filter(x => !['theme', 'video-layout'].includes(x.name)));

  await t.test('returns to actual source, clears both filters, scrolls and preserves paused playback', async () => {
    const { page, errors } = await fixture();
    await page.locator('#search-input').fill('不存在');
    await page.locator('[data-filter="qq"]').click();
    await locate(page);
    await located(page).waitFor();
    assert.equal(await located(page).getAttribute('data-key'), initial.currentKey);
    assert.equal(await page.locator('#search-input').inputValue(), '');
    assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await commands(page), [{ name: 'playlist-select', payload: { id: 'source' } }]);
    const playback = await page.evaluate(() => ({ status: fixtureState.status, positionMs: fixtureState.positionMs, queue: fixtureState.playbackQueue,
      focused: document.activeElement.dataset.key, rect: document.querySelector('tr.located').getBoundingClientRect().toJSON(),
      region: document.querySelector('.track-region').getBoundingClientRect().toJSON() }));
    assert.equal(playback.status, 'paused');
    assert.equal(playback.positionMs, 42000);
    assert.deepEqual(playback.queue, initial.playbackQueue);
    assert.equal(playback.focused, initial.currentKey);
    if (process.env.MIXTUNES_SCREENSHOT) await page.screenshot({ path: process.env.MIXTUNES_SCREENSHOT });
    assert.ok(playback.rect.top >= playback.region.top && playback.rect.bottom <= playback.region.bottom, JSON.stringify(playback));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await located(page).evaluate(row => getComputedStyle(row).animationName), 'none');
    await locate(page);
    assert.equal((await commands(page)).length, 1);
    if (process.env.MIXTUNES_SCREENSHOT) await page.screenshot({ path: process.env.MIXTUNES_SCREENSHOT });
    assert.deepEqual(errors, []);
  });

  await t.test('same playlist while playing clears filters without any playback commands; minimum window fits', async () => {
    const { page, errors } = await fixture({ activePlaylistId: 'source', queue: initial.playbackQueue, status: 'playing' });
    await page.setViewportSize({ width: 960, height: 680 });
    await page.locator('#search-input').fill('不存在');
    await page.locator('[data-filter="qq"]').click();
    await locate(page);
    await located(page).waitFor();
    assert.deepEqual(await commands(page), []);
    assert.equal(await page.locator('#playback-status').textContent(), '播放中');
    const fits = await page.locator('#locate-playing').evaluate(button => button.getBoundingClientRect().right <= button.closest('.now-playing').getBoundingClientRect().right);
    assert.ok(fits);
    if (process.env.MIXTUNES_SCREENSHOT) {
      await page.screenshot({ path: process.env.MIXTUNES_SCREENSHOT.replace(/\.png$/, '-minimum.png') });
      await page.locator('#toggle-theme').click();
      await page.screenshot({ path: process.env.MIXTUNES_SCREENSHOT.replace(/\.png$/, '-dark.png') });
    }
    assert.deepEqual(errors, []);
  });

  await t.test('unavailable origins explain the reason without changing the library', async () => {
    for (const [patch, text] of [[{ currentKey: null, currentTrack: null }, '暂无'], [{ playbackPlaylistId: null }, '搜索试听'],
      [{ playlists: [initial.playlists[1]] }, '已删除'],
      [{ playlists: [{ ...initial.playlists[0], queue: [] }, initial.playlists[1]] }, '已移出']]) {
      const { page } = await fixture(patch);
      await locate(page);
      assert.ok((await page.locator('#notice').textContent()).includes(text));
      assert.deepEqual(await commands(page), []);
      assert.equal(await located(page).count(), 0);
      await page.close();
    }
  });

  await t.test('waits for state even when command acknowledgement arrives first', async () => {
    const { page } = await fixture();
    await page.evaluate(() => { window.deferSelect = true; });
    await locate(page);
    await page.evaluate(() => window.resolveSelect({ ok: true }));
    assert.equal(await located(page).count(), 0);
    await page.evaluate(() => window.sendState({ activePlaylistId: 'source', queue: fixtureState.playbackQueue }));
    await located(page).waitFor();
    assert.deepEqual(await commands(page), [{ name: 'playlist-select', payload: { id: 'source' } }]);
  });

  await t.test('song change, replay, removal or deletion during selection never highlights a stale row', async () => {
    for (const patch of [{ currentKey: tracks[0].key, currentTrack: tracks[0] }, { generation: 8 },
      { playlists: [initial.playlists[1]] }, { playlists: [{ ...initial.playlists[0], queue: [] }, initial.playlists[1]] }]) {
      const { page } = await fixture();
      await page.evaluate(() => { window.deferSelect = true; });
      await locate(page);
      await page.evaluate(patch => window.sendState(patch), patch);
      await page.evaluate(() => { window.sendState({ activePlaylistId: 'source', queue: fixtureState.playbackQueue }); window.resolveSelect({ ok: true }); });
      assert.equal(await located(page).count(), 0);
      assert.ok(/变化|删除|移出/.test(await page.locator('#notice').textContent()));
      assert.equal((await commands(page)).length, 1);
      await page.close();
    }
  });

  await t.test('failed selection permits retry and duplicate pending clicks send one command', async () => {
    const { page } = await fixture();
    await page.evaluate(() => { window.deferSelect = true; });
    await locate(page);
    await locate(page);
    assert.equal((await commands(page)).length, 1);
    await page.evaluate(() => window.resolveSelect({ ok: false, error: '测试：歌单切换失败' }));
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('测试：歌单切换失败'));
    assert.equal(await located(page).count(), 0);
    await page.evaluate(() => { window.deferSelect = false; });
    await locate(page);
    await located(page).waitFor();
  });

  await t.test('missing state update times out without highlighting and permits retry', async () => {
    const { page } = await fixture();
    await page.clock.install();
    await page.evaluate(() => { window.deferSelect = true; });
    await locate(page);
    await page.evaluate(() => window.resolveSelect({ ok: true }));
    await page.clock.fastForward(5001);
    assert.ok((await page.locator('#notice').textContent()).includes('尚未更新'));
    assert.equal(await located(page).count(), 0);
    await page.evaluate(() => { window.deferSelect = false; });
    await locate(page);
    await located(page).waitFor();
  });
});
