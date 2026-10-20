'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function fixtureState() {
  const tracks = [{ key: 'netease:1', platform: 'netease', sourceId: '1', title: 'Local Song', artist: 'Tester', durationMs: 180000 }];
  return {
    tracks, playlists: [{ id: 'active', name: '测试歌单', queue: [tracks[0].key], currentKey: tracks[0].key }],
    activePlaylistId: 'active', queue: [tracks[0].key], currentKey: tracks[0].key, currentTrack: tracks[0],
    playbackPlaylistId: 'active', playbackQueue: [tracks[0].key], status: 'playing', positionMs: 1000,
    durationMs: 180000, volume: 0.7, muted: false, qualitySettings: { qq: 'auto', netease: 'auto', bilibili: 'auto' },
    accounts: {}, videoPanel: { open: false, expanded: false }
  };
}

test('sleep timer settings on Windows and Android', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());

  async function fixture(mobile) {
    const page = await browser.newPage({ viewport: mobile ? { width: 320, height: 640 } : { width: 960, height: 680 }, isMobile: mobile, hasTouch: mobile });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'no page errors'));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      if (mobile && file === 'runtime.js') {
        return route.fulfill({ contentType: 'application/javascript', body: ['sleep-timer.js', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js'].map((name) => read(`app/ui/${name}`)).join('\n') });
      }
      const allowed = ['index.html', 'styles.css', 'sleep-timer.js', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js', 'cover-background.css', 'ui.js', 'app.js', 'theme.js','ui-logic.js'];
      if (!allowed.includes(file)) return route.abort();
      const dir = mobile ? 'android/web' : 'app/ui';
      return route.fulfill({ body: fs.readFileSync(path.join(root, dir, file)), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript((snapshot) => {
      window.fixtureState = snapshot;
      window.calls = [];
      window.sleepCalls = [];
      window.sleepState = { active: false, endsAt: null, remainingMs: 0, minutes: null };
      window.playerAPI = {
        getState: async () => structuredClone(snapshot),
        onState: () => {}, onNotice: () => {},
        command: async (name, payload) => { window.calls.push({ name, payload }); return { ok: true }; },
        sleepTimer: async (action, payload = {}) => {
          window.sleepCalls.push({ action, payload: structuredClone(payload) });
          if (action === 'get') return { ok: true, ...window.sleepState, remainingMs: window.sleepState.active ? Math.max(0, window.sleepState.endsAt - Date.now()) : 0 };
          if (action === 'set') {
            const minutes = payload.minutes;
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return { ok: false, error: '睡眠定时器需为 1～240 分钟的整数' };
            window.sleepState = { active: true, minutes, endsAt: Date.now() + minutes * 60000 };
            return { ok: true, ...window.sleepState, remainingMs: minutes * 60000 };
          }
          if (action === 'cancel') {
            window.sleepState = { active: false, endsAt: null, remainingMs: 0, minutes: null };
            return { ok: true, ...window.sleepState };
          }
          return { ok: false, error: '无效的睡眠定时器操作' };
        },
        onSleepTimer: (fn) => { window.sleepListener = fn; return () => { window.sleepListener = null; }; }
      };
    }, fixtureState());
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI && window.mixTunesSleepTimer : () => document.getElementById('connection-status').textContent === '已就绪');
    return page;
  }

  async function openSettings(page, mobile) {
    if (mobile) await page.locator('[data-screen="settings"]').click();
    else await page.locator('#open-quality-settings').click();
    await page.locator('#sleep-timer-status').waitFor({ state: 'visible' });
  }

  const setCalls = (page) => page.evaluate(() => window.sleepCalls.filter((call) => call.action === 'set'));
  const cancelCalls = (page) => page.evaluate(() => window.sleepCalls.filter((call) => call.action === 'cancel'));

  for (const mobile of [false, true]) {
    const client = mobile ? 'android' : 'windows';

    await t.test(client + ': presets, custom minutes and validation', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      assert.equal(await page.locator('[data-sleep-minutes]').count(), 3);
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器未开启');
      assert.equal(await page.locator('#sleep-timer-cancel').isVisible(), false);

      for (const minutes of [15, 30, 60]) {
        await page.locator(`[data-sleep-minutes="${minutes}"]`).click();
        const calls = await setCalls(page);
        assert.deepEqual(calls.at(-1).payload, { minutes });
        assert.equal(await page.locator('#sleep-timer-status').textContent(), `睡眠定时器：剩余 ${minutes} 分 00 秒`);
      }

      await page.locator('#sleep-timer-minutes').fill('240');
      await page.locator('.sleep-timer-custom button[type="submit"]').click();
      assert.deepEqual((await setCalls(page)).at(-1).payload, { minutes: 240 });
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器：剩余 240 分 00 秒');

      const validSets = (await setCalls(page)).length;
      for (const invalid of ['0', '241', '1.5']) {
        await page.locator('#sleep-timer-minutes').fill(invalid);
        await page.locator('.sleep-timer-custom button[type="submit"]').click();
        assert.equal(await page.locator('#sleep-timer-error').isVisible(), true, invalid);
        assert.match(await page.locator('#sleep-timer-error').textContent(), /1～240/);
      }
      await page.locator('#sleep-timer-minutes').fill('');
      await page.locator('.sleep-timer-custom button[type="submit"]').click();
      assert.equal(await page.locator('#sleep-timer-error').isVisible(), true);
      assert.equal((await setCalls(page)).length, validSets, 'invalid input never reaches the authority');
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器：剩余 240 分 00 秒');
    });

    await t.test(client + ': replacement, cancel, persistence and no playback commands', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('[data-sleep-minutes="15"]').click();
      await page.locator('[data-sleep-minutes="30"]').click();
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器：剩余 30 分 00 秒');
      assert.equal(await page.evaluate(() => window.sleepState.minutes), 30);

      // Hiding the settings surface must not cancel the timer.
      if (mobile) {
        await page.locator('[data-screen="library"]').click();
        await page.locator('#next').click();
        await page.locator('[data-screen="settings"]').click();
      } else {
        await page.locator('#close-quality-settings').click();
        await page.locator('#next').click();
        await page.locator('#open-quality-settings').click();
      }
      await page.waitForFunction(() => window.sleepState.active === true);
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器：剩余 30 分 00 秒');
      assert.equal((await cancelCalls(page)).length, 0, 'other actions never cancel the timer');
      assert.equal(await page.evaluate(() => window.calls.filter((call) => call.name === 'pause').length), 0, 'sleep UI never issues its own pause');

      await page.locator('#sleep-timer-cancel').click();
      await page.waitForFunction(() => window.sleepState.active === false);
      assert.equal(await page.locator('#sleep-timer-status').textContent(), '睡眠定时器未开启');
      assert.equal(await page.locator('#sleep-timer-cancel').isVisible(), false);
    });

    await t.test(client + ': remaining format, external expiry and shared contract', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      assert.equal(await page.evaluate(() => window.mixTunesSleepTimer.formatRemaining({ active: true, remainingMs: 872000 })), '睡眠定时器：剩余 14 分 32 秒');
      assert.equal(await page.evaluate(() => window.mixTunesSleepTimer.formatRemaining({ active: false })), '睡眠定时器未开启');

      await page.locator('[data-sleep-minutes="15"]').click();
      await page.evaluate(() => { window.sleepState = { active: false, endsAt: null, remainingMs: 0, minutes: null }; window.dispatchEvent(new Event('mix-sleep-timer-expired')); });
      await page.waitForFunction(() => document.getElementById('sleep-timer-status').textContent === '睡眠定时器未开启');

      await page.evaluate(() => { window.sleepState = { active: true, minutes: 5, endsAt: Date.now() + 300000 }; window.sleepListener?.({ active: true, minutes: 5, endsAt: window.sleepState.endsAt }); });
      await page.waitForFunction(() => document.getElementById('sleep-timer-status').textContent.includes('5 分'));
      assert.equal(await page.locator('#sleep-timer-cancel').isVisible(), true);
      assert.equal(await page.locator('#sleep-timer-cancel').textContent(), '取消定时');
    });
  }
});
