'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('../app/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const TRACK = { key: 'netease:1', platform: 'netease', sourceId: '1', title: 'Song', artist: 'Tester', coverUrl: 'https://covers.test/cover.png', durationMs: 180000 };
const STATE = { tracks: [TRACK], playlists: [{ id: 'a', name: '歌单', queue: [TRACK.key] }], activePlaylistId: 'a', queue: [TRACK.key], currentKey: TRACK.key, currentTrack: TRACK, status: 'playing', positionMs: 0, durationMs: 180000, volume: 0.7, muted: false, qualitySettings: {}, accounts: {} };

function channel(value) { const c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(rgb) { const [r, g, b] = rgb; return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); }
function contrast(a, b) { const [high, low] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]; return (high + 0.05) / (low + 0.05); }
function rgb(text) { const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(text); if (!match) throw new Error('not an rgb colour: ' + text); return [Number(match[1]), Number(match[2]), Number(match[3])]; }

test('background sliders stay legible and operable in light and dark themes', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const shots = process.env.MIXTUNES_BACKGROUND_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-slider-shots-'));
  fs.mkdirSync(shots, { recursive: true });

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
      if (mobile && file === 'runtime.js') return route.fulfill({ contentType: 'application/javascript', body: ['search-match.js', 'cover-background.js', 'background-image.js', 'background-settings.js', 'sleep-timer.js'].map((name) => read('app/ui/' + name)).join('\n') });
      const dir = mobile ? 'android/web' : 'app/ui';
      const source = file === 'cover-background.css' ? path.join(root, 'app/ui', file) : path.join(root, dir, file);
      if (!fs.existsSync(source)) return route.abort();
      return route.fulfill({ body: fs.readFileSync(source), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript((snapshot) => {
      window.playerAPI = {
        getState: async () => structuredClone(snapshot), onState: () => {}, onNotice: () => {},
        command: async () => ({ ok: true }),
        background: async (action) => action === 'load' ? null : ({ ok: true }),
        sleepTimer: async () => ({ ok: true, active: false, endsAt: null, remainingMs: 0, minutes: null }),
        onSleepTimer: () => () => {}
      };
    }, STATE);
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI : () => document.getElementById('connection-status').textContent === '已就绪');
    if (mobile) await page.locator('[data-screen="settings"]').click(); else await page.locator('#open-quality-settings').click();
    await page.locator('#background-mode').selectOption('current-cover');
    return page;
  }

  const theme = (page, name) => page.evaluate((value) => { document.documentElement.dataset.theme = value; }, name);

  async function colours(page) {
    return page.evaluate(() => {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const resolve = (name) => { probe.style.backgroundColor = 'var(' + name + ')'; return getComputedStyle(probe).backgroundColor; };
      const values = { track: resolve('--bg-slider-track'), fill: resolve('--bg-slider-fill'), thumb: resolve('--bg-slider-thumb'), ring: resolve('--bg-slider-ring'), surface: resolve('--surface') };
      probe.remove();
      return values;
    });
  }

  for (const mobile of [false, true]) {
    const client = mobile ? 'android' : 'windows';

    for (const name of ['light', 'dark']) {
      await t.test(client + ' ' + name + ': track, fill, thumb and focus meet the contrast contract', async () => {
        const page = await fixture(mobile);
        await theme(page, name);
        const value = await colours(page);
        const surface = rgb(value.surface), track = rgb(value.track), fill = rgb(value.fill), thumb = rgb(value.thumb), ring = rgb(value.ring);
        assert.ok(contrast(track, surface) >= 3, `track vs surface ${contrast(track, surface).toFixed(2)}`);
        assert.ok(contrast(fill, track) >= 3, `fill vs track ${contrast(fill, track).toFixed(2)}`);
        assert.ok(contrast(thumb, track) >= 3, `thumb vs track ${contrast(thumb, track).toFixed(2)}`);
        assert.ok(contrast(ring, thumb) >= 3, `ring vs thumb ${contrast(ring, thumb).toFixed(2)}`);
        for (const id of ['background-opacity', 'background-blur']) {
          const box = await page.locator('#' + id).boundingBox();
          assert.ok(box.height >= 44, `${id} keeps a 44px touch target`);
          assert.ok(box.width >= 200, `${id} keeps a usable width`);
        }
        await page.locator('#background-opacity').evaluate((node) => { node.value = '50'; node.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.locator('#background-blur').evaluate((node) => { node.value = '20'; node.dispatchEvent(new Event('input', { bubbles: true })); });
        const progress = await page.locator('#background-opacity').evaluate((node) => node.style.getPropertyValue('--range-progress'));
        assert.equal(progress, '50.00%');
        await page.locator('#background-blur').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, `${client}-${name}.png`) });
      });
    }

    await t.test(client + ': mouse dragging previews during the drag and keeps its hit area', async () => {
      const page = await fixture(mobile);
      const slider = page.locator('#background-opacity');
      const box = await slider.boundingBox();
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.9, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, y, { steps: 6 });
      const during = await page.evaluate(() => ({ opacity: document.getElementById('cover-background').style.getPropertyValue('--background-opacity'), value: document.getElementById('background-opacity').value }));
      await page.mouse.up();
      assert.ok(Number(during.opacity) < 0.95, 'background changes before the mouse is released: ' + JSON.stringify(during));
      assert.ok(Number(during.value) < 90);
      assert.equal(await page.locator('#background-blur').inputValue(), mobile ? '18' : '24');
    });

    await t.test(client + ': keyboard focus is visible and arrow keys adjust the slider', async () => {
      const page = await fixture(mobile);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      let reached = false;
      for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement && document.activeElement.id) === 'background-opacity') { reached = true; break; } }
      assert.equal(reached, true, 'opacity slider is keyboard reachable');
      const focused = await page.evaluate(() => {
        const node = document.getElementById('background-opacity');
        const style = getComputedStyle(node);
        return { id: document.activeElement.id, width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, height: node.getBoundingClientRect().height };
      });
      assert.equal(focused.id, 'background-opacity');
      assert.notEqual(focused.style, 'none');
      assert.ok(parseFloat(focused.width) >= 2, 'focus outline width ' + focused.width);
      assert.ok(focused.height >= 44);
      const before = Number(await page.locator('#background-opacity').inputValue());
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      assert.equal(Number(await page.locator('#background-opacity').inputValue()), before - 2);
      assert.ok(Number(await page.evaluate(() => getComputedStyle(document.getElementById('cover-background')).getPropertyValue('--background-opacity'))) < 1);
    });

    await t.test(client + ': disabled sliders are visibly different but keep their layout', async () => {
      const page = await fixture(mobile);
      await page.locator('#background-opacity').evaluate((node) => { node.value = '37'; node.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.locator('#background-mode').selectOption('theme');
      const state = await page.evaluate(() => {
        const node = document.getElementById('background-opacity');
        return { disabled: node.disabled, opacity: getComputedStyle(node).opacity, cursor: getComputedStyle(node).cursor, height: node.getBoundingClientRect().height, value: node.value };
      });
      assert.equal(state.disabled, true);
      assert.ok(Number(state.opacity) < 1);
      assert.equal(state.cursor, 'not-allowed');
      assert.ok(state.height >= 44);
      assert.equal(state.value, '37');
      await page.locator('#background-mode').selectOption('current-cover');
      assert.equal(await page.locator('#background-opacity').isDisabled(), false);
      assert.equal(await page.locator('#background-opacity').inputValue(), '37');
    });

    await t.test(client + ': unrelated player sliders keep their own styling', async () => {
      const page = await fixture(mobile);
      const result = await page.evaluate(() => {
        const seek = document.getElementById('seek');
        const style = getComputedStyle(seek);
        return { height: style.height, image: style.backgroundImage, ours: getComputedStyle(document.getElementById('background-opacity')).height };
      });
      if (!mobile) assert.equal(result.height, '3px');
      assert.ok(result.image === 'none' || !result.image.includes('rgb(124, 125, 132)'));
      assert.ok(!result.image.includes('rgb(124, 125, 132)'));
      assert.equal(result.ours, '44px');
      assert.equal(await page.locator('#sleep-timer-status').count(), 1, 'task F panel still present');
    });
  }
});
