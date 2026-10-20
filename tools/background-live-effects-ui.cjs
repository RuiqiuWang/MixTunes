'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const TRACK = { key: 'netease:1', platform: 'netease', sourceId: '1', title: 'Background Song', artist: 'Tester', coverUrl: 'https://covers.test/cover.png', durationMs: 180000 };
const STATE = { tracks: [TRACK], playlists: [{ id: 'active', name: '歌单', queue: [TRACK.key] }], activePlaylistId: 'active', queue: [TRACK.key], currentKey: TRACK.key, currentTrack: TRACK, status: 'playing', positionMs: 1000, durationMs: 180000, volume: 0.7, muted: false, qualitySettings: {}, accounts: {} };

test('live background blur and opacity on Windows and Android', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());

  async function fixture(mobile) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 760 } : { width: 960, height: 680 }, isMobile: mobile, hasTouch: mobile });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'no page errors'));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'covers.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#68b"/></svg>' });
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      if (mobile && file === 'runtime.js') {
        return route.fulfill({ contentType: 'application/javascript', body: ['search-match.js', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js', 'sleep-timer.js'].map((name) => read('app/ui/' + name)).join('\n') });
      }
      const allowed = ['index.html', 'styles.css', 'cover-background.css', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js', 'sleep-timer.js', 'ui.js', 'app.js', 'theme.js','ui-logic.js', 'search-match.js'];
      if (!allowed.includes(file)) return route.abort();
      const dir = mobile ? 'android/web' : 'app/ui';
      const source = file === 'cover-background.css' ? path.join(root, 'app/ui', file) : path.join(root, dir, file);
      return route.fulfill({ body: fs.readFileSync(source), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript((snapshot) => {
      window.savedCustom = { version: 1, image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', crop: { x: 0.5, y: 0.5, zoom: 1 } };
      window.backgroundCalls = [];
      window.playerAPI = {
        getState: async () => structuredClone(snapshot), onState: () => {}, onNotice: () => {},
        command: async () => ({ ok: true }),
        sleepTimer: async () => ({ ok: true, active: false, endsAt: null, remainingMs: 0, minutes: null }),
        onSleepTimer: () => () => {},
        background: async (action, payload) => {
          window.backgroundCalls.push(action);
          if (action === 'load') return window.savedCustom;
          if (action === 'save') { window.savedCustom = payload; return payload; }
          if (action === 'delete') { window.savedCustom = null; return true; }
          if (action === 'pick') return { canceled: true };
          return { ok: true };
        }
      };
    }, STATE);
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI : () => document.getElementById('connection-status').textContent === '已就绪');
    await page.evaluate(() => { const advanced = document.getElementById('background-advanced'); if (advanced) advanced.open = true; });
    return page;
  }

  async function openSettings(page, mobile) {
    if (mobile) await page.locator('[data-screen="settings"]').click();
    else await page.locator('#open-quality-settings').click();
    await page.locator('#background-mode').waitFor({ state: 'visible' });
  }
  const vars = (page) => page.evaluate(() => {
    const container = document.getElementById('cover-background');
    return { blur: container.style.getPropertyValue('--background-blur').trim(), scale: container.style.getPropertyValue('--background-blur-scale').trim(), opacity: container.style.getPropertyValue('--background-opacity').trim() };
  });
  const storage = (page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  async function setRange(page, id, value, event = 'input') {
    await page.locator('#' + id).evaluate((node, { value, event }) => { node.value = String(value); node.dispatchEvent(new Event(event, { bubbles: true })); }, { value, event });
  }

  for (const mobile of [false, true]) {
    const client = mobile ? 'android' : 'windows';

    await t.test(client + ': blur slider is live, bounded and does not persist while dragging', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('#background-mode').selectOption('current-cover');
      const slider = page.locator('#background-blur');
      assert.equal(await slider.getAttribute('min'), '0');
      assert.equal(await slider.getAttribute('max'), '40');
      assert.equal(await slider.getAttribute('step'), '1');
      assert.equal(await page.locator('label[for="background-blur"]').textContent(), '背景模糊度 ' + (mobile ? '18px' : '24px'));
      assert.equal((await vars(page)).blur, (mobile ? '18px' : '24px'), 'legacy cover default');

      for (const value of [0, 20, 40]) {
        await setRange(page, 'background-blur', value);
        assert.equal((await vars(page)).blur, value + 'px', 'applied during input');
        assert.equal(await page.locator('#background-blur-value').textContent(), value + 'px');
        assert.equal(await page.locator('#background-blur').inputValue(), String(value));
      }
      const beforeRelease = await storage(page);
      assert.equal(beforeRelease['mixtunes-background-blur-cover'], undefined, 'dragging never writes storage');
      await setRange(page, 'background-blur', 40, 'change');
      assert.equal((await storage(page))['mixtunes-background-blur-cover'], '40');
    });

    await t.test(client + ': opacity stays live and the two effects combine', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('#background-mode').selectOption('current-cover');
      await setRange(page, 'background-opacity', 20);
      await setRange(page, 'background-blur', 40);
      const values = await vars(page);
      assert.equal(values.opacity, '0.2');
      assert.equal(values.blur, '40px');
      assert.equal(await page.locator('#background-opacity-value').textContent(), '20%');
      assert.equal((await storage(page))['mixtunes-background-opacity'], undefined);
      await setRange(page, 'background-opacity', 20, 'change');
      assert.equal((await storage(page))['mixtunes-background-opacity'], '20');
      assert.equal((await vars(page)).blur, '40px', 'opacity never resets blur');
      await setRange(page, 'background-blur', 10, 'change');
      assert.equal((await vars(page)).opacity, '0.2', 'blur never resets opacity');
    });

    await t.test(client + ': cover and custom modes keep independent values and theme keeps both', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('#background-mode').selectOption('current-cover');
      await setRange(page, 'background-blur', 40, 'change');
      await page.locator('#background-mode').selectOption('custom');
      assert.equal(await page.locator('#background-blur').inputValue(), '0', 'custom starts clear');
      await setRange(page, 'background-blur', 12, 'change');
      await setRange(page, 'background-opacity', 60, 'change');
      const saved = await storage(page);
      assert.equal(saved['mixtunes-background-blur-cover'], '40');
      assert.equal(saved['mixtunes-background-blur-custom'], '12');

      await page.locator('#background-mode').selectOption('current-cover');
      assert.equal(await page.locator('#background-blur').inputValue(), '40');
      assert.equal(await page.locator('#background-opacity').inputValue(), '60');
      await page.locator('#background-mode').selectOption('theme');
      assert.equal(await page.locator('#background-blur').isDisabled(), true);
      assert.equal(await page.locator('#background-opacity').isDisabled(), true);
      await page.locator('#background-mode').selectOption('custom');
      assert.equal(await page.locator('#background-blur').inputValue(), '12');
      assert.equal((await storage(page))['mixtunes-background-blur-cover'], '40');
    });

    await t.test(client + ': only the background image is filtered and decoded pixels are reused', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('#background-mode').selectOption('current-cover');
      await page.waitForFunction(() => { const image = document.querySelector('#cover-background img'); return image && image.naturalWidth > 0; });
      const before = await page.evaluate(() => { const image = document.querySelector('#cover-background img'); return { src: image?.src, count: document.querySelectorAll('#cover-background img').length }; });
      await setRange(page, 'background-blur', 30);
      await setRange(page, 'background-opacity', 70);
      const after = await page.evaluate(() => {
        const image = document.querySelector('#cover-background img');
        const filter = getComputedStyle(image).filter;
        const appFilter = getComputedStyle(document.querySelector('.app')).filter;
        const buttonFilter = getComputedStyle(document.querySelector('button')).filter;
        return { src: image?.src, count: document.querySelectorAll('#cover-background img').length, filter, appFilter, buttonFilter };
      });
      assert.equal(after.count, before.count);
      assert.equal(after.src, before.src, 'no image reload');
      assert.match(after.filter, /blur\(30px\)/);
      assert.match(after.filter, /opacity\(0\.7\)/);
      assert.equal(after.appFilter, 'none');
      assert.equal(after.buttonFilter, 'none');
    });

    await t.test(client + ': crop preview mirrors blur and opacity without resetting them', async () => {
      const page = await fixture(mobile);
      await openSettings(page, mobile);
      await page.locator('#background-mode').selectOption('custom');
      await setRange(page, 'background-blur', 18, 'change');
      await setRange(page, 'background-opacity', 45, 'change');
      await page.locator('#background-recrop').click();
      await page.locator('#background-crop-dialog').waitFor({ state: 'visible' });
      await page.waitForFunction(() => { const image = document.querySelector('#background-crop-stage img'); return document.getElementById('background-crop-stage').clientWidth > 0 && image && image.naturalWidth > 0; });
      await page.locator('#background-effect').check();
      await page.waitForFunction(() => document.getElementById('background-crop-stage').classList.contains('preview-background-effect'));
      const preview = await page.evaluate(() => {
        const stage = document.getElementById('background-crop-stage');
        const image = stage.querySelector('img');
        return { blur: stage.style.getPropertyValue('--preview-blur').trim(), opacity: stage.style.getPropertyValue('--preview-opacity').trim(), filter: getComputedStyle(image).filter, checked: document.getElementById('background-effect').checked };
      });
      assert.equal(preview.blur, '18px');
      assert.equal(preview.opacity, '0.45');
      assert.match(preview.filter, /blur\(18px\)/);
      assert.equal(preview.checked, true);
      await page.locator('#background-cancel').click();
      assert.equal(await page.locator('#background-blur').inputValue(), '18');
      assert.equal(await page.locator('#background-opacity').inputValue(), '45');
      assert.equal((await storage(page))['mixtunes-background-blur-custom'], '18');
    });

    await t.test(client + ': legacy storage without blur keys keeps defaults and sleeps timer still mounts', async () => {
      const page = await fixture(mobile);
      const values = await storage(page);
      assert.equal(values['mixtunes-background-blur-cover'], undefined);
      assert.equal(await page.locator('#sleep-timer-status').count(), 1, 'task F panel still present');
    });
  }
});
