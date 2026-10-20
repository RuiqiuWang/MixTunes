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

test('background mask controls on Windows and Android', async t => {
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

  async function setRange(page,id,value) {
    await page.locator('#'+id).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  }
  async function alpha(page,preview=false) {
    return page.evaluate(preview=>{
      const el=document.querySelector(preview?'.background-crop-mask':'#cover-background');
      const color=getComputedStyle(el,preview?null:'::after').backgroundColor;
      const parts=color.match(/[\d.]+/g).map(Number);return {color,alpha:parts.length===4?parts[3]:1};
    },preview);
  }
  for(const mobile of [false,true]) {
    const client=mobile?'android':'windows';
    await t.test(client+': legacy defaults, live 0/100 endpoints and operable controls',async()=>{
      const page=await fixture(mobile);await openSettings(page,mobile);
      await page.locator('#background-mode').selectOption('current-cover');
      assert.equal(await page.locator('#background-mask').getAttribute('min'),'0');
      assert.equal(await page.locator('#background-mask').getAttribute('max'),'100');
      assert.equal(await page.locator('#background-mask').inputValue(),'88');
      assert.equal((await alpha(page)).alpha,.88);
      assert.equal(await page.evaluate(()=>localStorage.getItem('mixtunes-background-mask-light')),null);
      for(const value of [0,37,100]) {
        await setRange(page,'background-mask',value);
        assert.equal((await alpha(page)).alpha,value/100);
        assert.equal(await page.locator('#background-mask-value').textContent(),value+'%');
        assert.equal(await page.evaluate(()=>localStorage.getItem('mixtunes-background-mask-light')),String(value));
      }
      await setRange(page,'background-mask',0);
      assert.equal(await page.locator('#background-mask-hint').textContent().then(s=>s.includes('可读性')),true);
      await page.locator('#background-mode').selectOption('custom');
      await page.locator('#background-recrop').click();
      await page.locator('#background-cancel').click();
      assert.equal(await page.locator('#background-crop-dialog').isVisible(),false,'mask does not intercept controls');
    });
    await t.test(client+': per-theme masks survive reload and do not alter opacity or blur',async()=>{
      const page=await fixture(mobile);await openSettings(page,mobile);
      await page.locator('#background-mode').selectOption('custom');
      await setRange(page,'background-opacity',41);await page.locator('#background-opacity').dispatchEvent('change');
      await setRange(page,'background-blur',12);await page.locator('#background-blur').dispatchEvent('change');
      await setRange(page,'background-mask',17);
      await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
      await page.waitForFunction(()=>document.querySelector('#background-mask').value==='90');
      assert.equal((await alpha(page)).alpha,.9);
      await setRange(page,'background-mask',32);
      assert.equal((await alpha(page)).alpha,.32);
      assert.match((await alpha(page)).color,/32, 33, 35/);
      await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
      await page.waitForFunction(()=>document.querySelector('#background-mask').value==='17');
      assert.equal((await alpha(page)).alpha,.17);
      await page.locator('#background-mask').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(root,'.local-build/release-v1.1.0-mask',client+'-mask-light.png')});
      await page.reload();await openSettings(page,mobile);
      assert.equal(await page.locator('#background-mask').inputValue(),'17');
      assert.equal(await page.locator('#background-opacity').inputValue(),'41');
      assert.equal(await page.locator('#background-blur').inputValue(),'12');
      await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
      await page.waitForFunction(()=>document.querySelector('#background-mask').value==='32');
      await page.locator('#background-mask').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(root,'.local-build/release-v1.1.0-mask',client+'-mask-dark.png')});
    });
    await t.test(client+': crop effect uses the same theme mask and keeps saved crop intact',async()=>{
      const page=await fixture(mobile);await openSettings(page,mobile);
      await page.locator('#background-mode').selectOption('custom');
      await setRange(page,'background-mask',0);
      const before=await page.evaluate(()=>structuredClone(window.savedCustom));
      await page.locator('#background-recrop').click();await page.locator('#background-effect').check();
      assert.equal((await alpha(page,true)).alpha,0);
      await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
      assert.equal((await alpha(page,true)).alpha,.9);
      // Simulate the input event without closing the modal: both layers must update together.
      await setRange(page,'background-mask',100);
      assert.equal((await alpha(page,true)).alpha,1);assert.equal((await alpha(page)).alpha,1);
      await page.locator('#background-cancel').click();
      assert.deepEqual(await page.evaluate(()=>window.savedCustom),before);
      await page.locator('#background-mode').selectOption('theme');
      assert.equal(await page.locator('#background-mask').isDisabled(),true);
    });
  }
});
