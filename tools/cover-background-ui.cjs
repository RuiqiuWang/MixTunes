'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');
const clients = process.env.MIXTUNES_COVER_CLIENT === 'windows' ? [false] : [false, true];

test('current playback cover background stays local and independent of transport', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const seed = { tracks: [{ key: 'qq:one', platform: 'qq', title: '当前播放歌曲', artist: '封面背景验收', durationMs: 180000, coverUrl: 'https://covers.test/white.svg' },
    { key: 'netease:two', platform: 'netease', title: '浏览中的另一首歌', artist: '其他歌单', coverUrl: 'https://covers.test/black.svg' }],
    playlists: [{ id: 'source', name: '当前播放来源', queue: ['qq:one'] }, { id: 'other', name: '浏览歌单', queue: ['netease:two'] }],
    queue: ['qq:one'], activePlaylistId: 'source', currentKey: 'qq:one', playbackPlaylistId: 'source', playbackQueue: ['qq:one'],
    status: 'playing', positionMs: 42000, durationMs: 180000, volume: .7, muted: false, generation: 7 };
  seed.currentTrack = seed.tracks[0];
  async function fixture(mobile, realRuntime = false) {
    const page = await browser.newPage({ viewport: mobile ? { width: 375, height: 812 } : { width: 1240, height: 840 }, isMobile: mobile, hasTouch: mobile });
    t.after(() => page.close());
    const errors = [], requests = [], delayed = new Map();
    page.on('pageerror', e => errors.push(e.message));
    t.after(() => assert.deepEqual(errors, []));
    function art(name) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#f5187d"/><rect width="40" height="40" fill="#00b4c6"/><rect x="40" y="40" width="40" height="40" fill="#ffd317"/></pattern></defs><rect width="320" height="320" fill="${name.includes('white') ? 'white' : name.includes('black') ? 'black' : 'url(#p)'}"/></svg>`;
    }
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://covers.test') {
        requests.push(url.pathname);
        if (url.pathname.includes('failed')) return route.abort();
        if (url.pathname.includes('slow')) return new Promise(resolve => delayed.set(url.pathname, async () => { await route.fulfill({ body: art(url.pathname), contentType: 'image/svg+xml' }).catch(() => {}); resolve(); }));
        return route.fulfill({ body: art(url.pathname), contentType: 'image/svg+xml' });
      }
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      if (!['index.html', 'theme.js', 'styles.css', 'cover-background.css', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js', 'search-match.js', 'sleep-timer.js', 'runtime.js', 'app.js', 'ui.js'].includes(file)) return route.abort();
      let body;
      if (mobile && file === 'runtime.js' && !realRuntime) body = ['search-match.js', 'sleep-timer.js', 'locate-playing.js', 'cover-background.js', 'background-image.js', 'background-settings.js'].map(name => fs.readFileSync(path.join(__dirname, '../app/ui', name))).join('\n');
      else body = fs.readFileSync(path.join(__dirname, '..', mobile ? 'android/web' : 'app/ui', file));
      return route.fulfill({ body, contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript(({ snapshot, realRuntime }) => {
      window.stateFixture = snapshot; window.calls = [];
      window.nativeCalls = [];
      if (realRuntime) {
        let counter = 0, savedBackground = null;
        window.MixTunesBridge = {
          crypto: text => {
            const p = JSON.parse(text);
            if (p.op !== 'randomUUID') throw Error('Unexpected crypto operation');
            return JSON.stringify({ ok: true, value: 'background-fixture-' + (++counter) });
          },
          postMessage: text => {
            const p = JSON.parse(text); window.nativeCalls.push(p); let value = true, error;
            if (p.method === 'storage-load') value = { json: JSON.stringify({ ...snapshot, schemaVersion: 2,
              playlists: snapshot.playlists.map(playlist => ({ ...playlist, mode: 'sequential', currentKey: playlist.queue.includes(snapshot.currentKey) ? snapshot.currentKey : null })),
              tracks: snapshot.tracks.map((track, i) => ({ ...track, sourceId: String(i + 1), url: track.platform === 'qq' ? 'https://y.qq.com/n/ryqq/songDetail/' + (i + 1) : 'https://music.163.com/song?id=' + (i + 1) })) }) };
            else if (p.method === 'storage-background-load') value = savedBackground;
            else if (p.method === 'storage-background-save') { savedBackground = p.payload; value = savedBackground; }
            else if (p.method === 'storage-background-delete') { savedBackground = null; value = true; }
            else if (p.method === 'background-pick') value = window.fixtureBackgroundChoice || { canceled: true };
            else if (p.method === 'background-editor') value = true;
            else if (p.method === 'cookies') value = [];
            else if (p.method === 'sleep-timer-state') value = { active: false, endsAt: null, remainingMs: 0, minutes: null };
            else if (p.method === 'export') { window.exportedLibrary = p.payload.json; value = { saved: true }; }
            else if (!['storage-save', 'theme', 'app-ready', 'cancel'].includes(p.method)) error = 'Unexpected native operation: ' + p.method;
            queueMicrotask(() => window.__mixNativeReply({ id: p.id, ok: !error, value, error }));
          }
        };
        return;
      }
      window.sendState = patch => { Object.assign(window.stateFixture, patch); window.listener(structuredClone(window.stateFixture)); };
      window.playerAPI = { background: async () => null,
        getState: async () => structuredClone(snapshot), onState: fn => { window.listener = fn; }, onNotice: () => {},
        command: async (name, payload) => {
          window.calls.push({ name, payload });
          if (name === 'playlist-select') window.sendState({ activePlaylistId: payload.id, queue: stateFixture.playlists.find(p => p.id === payload.id).queue });
          return { ok: true };
        },
        search: async ({ platform }) => ({ ok: true, requestId: 'fixture', results: [{ platform, ok: true, items: [{ id: 'result', platform, title: '搜索结果封面', coverUrl: 'https://covers.test/black.svg' }] }] }),
        lyrics: async () => ({ lines: [] })
      };
    }, { snapshot: seed, realRuntime });
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI && !document.getElementById('play-pause').disabled : () => document.getElementById('connection-status').textContent === '已就绪');
    return { page, requests, delayed };
  }
  async function settings(page, mobile) { await page.locator(mobile ? '[data-screen="settings"]' : '#open-quality-settings').click(); }
  async function ready(page, suffix) {
    await page.waitForFunction(suffix => document.documentElement.classList.contains('has-cover-background') && [...document.querySelectorAll('#cover-background img')].some(img => img.src.endsWith(suffix) && img.style.opacity === '1'), suffix);
  }
  async function shot(page, name) {
    if (process.env.MIXTUNES_COVER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MIXTUNES_COVER_SCREENSHOTS, name + '.png') });
  }
  function ratio(a, b) {
    const luma = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const x = luma(a), y = luma(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  for (const mobile of clients) {
    const client = mobile ? 'android' : 'windows';
    await t.test(client + ': default off, local persistence, fresh snapshot after reload and immediate disable', async () => {
      const { page } = await fixture(mobile);
      assert.equal(await page.locator('#cover-background img').count(), 0);
      await settings(page, mobile); assert.equal(await page.locator('#background-mode').inputValue(), 'theme');
      const before = await page.evaluate(() => structuredClone(stateFixture));
      await page.locator('#background-mode').selectOption('current-cover'); await ready(page, 'white.svg');
      assert.deepEqual(await page.evaluate(() => stateFixture), before);
      const stored = await page.evaluate(() => ({ ...localStorage }));
      assert.equal(stored['mixtunes-background-mode'], 'current-cover');
      assert.ok(!JSON.stringify(stored).includes('covers.test'));
      await page.reload(); await ready(page, 'white.svg');
      await page.evaluate(() => window.sendState({ currentKey: null, currentTrack: null, status: 'idle' }));
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('has-cover-background')), false);
      await page.evaluate(() => window.sendState({ currentKey: stateFixture.tracks[1].key, currentTrack: stateFixture.tracks[1], status: 'paused' }));
      await ready(page, 'black.svg');
      await settings(page, mobile); await page.locator('#background-mode').selectOption('theme');
      assert.equal(await page.locator('#cover-background img').count(), 0);
      assert.equal(await page.locator('#cover-background').evaluate(layer => getComputedStyle(layer).visibility), 'hidden');
      await page.reload(); assert.equal(await page.locator('#cover-background img').count(), 0);
    });

    await t.test(client + ': playback identity survives browse/filter/search and progress without rebuilding images', async () => {
      const { page, requests } = await fixture(mobile); await settings(page, mobile);
      await page.locator('#background-mode').selectOption('current-cover'); await ready(page, 'white.svg');
      if (!mobile) await page.locator('#close-quality-settings').click();
      else await page.locator('[data-screen="library"]').click();
      await page.evaluate(() => { window.savedImage = document.querySelector('#cover-background img'); window.calls = []; });
      const count = requests.length;
      await page.evaluate(() => { for (let i = 0; i < 60; i++) window.sendState({ positionMs: 42000 + i * 10, status: 'paused' }); });
      assert.equal(requests.length, count);
      assert.equal(await page.evaluate(() => window.savedImage === document.querySelector('#cover-background img')), true);
      await page.evaluate(() => window.playerAPI.command('playlist-select', { id: 'other' }));
      await page.locator(mobile ? '#library-filter' : '#search-input').fill('不存在');
      await page.locator(mobile ? '[data-screen="search"]' : '#open-online-search').click();
      await page.locator(mobile ? '#search-query' : '#online-search-query').fill('另一张封面');
      await page.locator(mobile ? '#search-submit' : '#online-search-submit').click();
      await page.locator(mobile ? '.search-result' : '.online-result').first().waitFor();
      await ready(page, 'white.svg');
      assert.equal(await page.evaluate(() => window.savedImage === document.querySelector('#cover-background img')), true);
      await page.evaluate(() => window.sendState({ playbackPlaylistId: null, currentKey: 'preview', currentTrack: { key: 'preview', platform: 'bilibili', coverUrl: 'https://covers.test/complex.svg' }, status: 'playing' }));
      await ready(page, 'complex.svg');
      const calls = await page.evaluate(() => calls.filter(x => !['theme', 'video-layout', 'playlist-select'].includes(x.name)));
      assert.deepEqual(calls, []);
    });

    await t.test(client + ': failed, unsafe and missing covers fall back; late loads cannot replace latest song', async () => {
      const { page, delayed } = await fixture(mobile); await settings(page, mobile); await page.locator('#background-mode').selectOption('current-cover'); await ready(page, 'white.svg');
      for (const src of ['', 'http://covers.test/unsafe.svg', 'https://covers.test/failed.svg']) {
        await page.evaluate(src => window.sendState({ currentTrack: { ...stateFixture.currentTrack, coverUrl: src } }), src);
        await page.waitForFunction(() => !document.documentElement.classList.contains('has-cover-background'));
      }
      await page.evaluate(() => window.sendState({ currentTrack: { ...stateFixture.currentTrack, coverUrl: 'https://covers.test/slow.svg' } }));
      await page.waitForTimeout(50);
      await page.evaluate(() => window.sendState({ currentTrack: { ...stateFixture.currentTrack, coverUrl: 'https://covers.test/complex.svg' } }));
      await ready(page, 'complex.svg');
      for (const finish of delayed.values()) await finish();
      await page.waitForTimeout(250); await ready(page, 'complex.svg');
      assert.ok(await page.locator('#cover-background img').count() <= 2);
      assert.equal(await page.locator('#play-pause').getAttribute('aria-label'), '暂停');
    });

    await t.test(client + ': light/dark masks preserve contrast; reduced motion and screen sizes stay usable', async () => {
      const { page } = await fixture(mobile); await settings(page, mobile); await page.locator('#background-mode').selectOption('current-cover'); await ready(page, 'white.svg');
      if (!mobile) await page.locator('#close-quality-settings').click(); else await page.locator('[data-screen="library"]').click();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => window.mixlinkTheme.set(theme), theme);
        for (const src of ['white', 'black', 'complex']) {
          await page.evaluate(src => window.sendState({ currentTrack: { ...stateFixture.currentTrack, coverUrl: `https://covers.test/${src}.svg` } }), src);
          await ready(page, src + '.svg');
          const colors = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement), layer = getComputedStyle(document.getElementById('cover-background'), '::after');
            return { text: root.getPropertyValue('--text').trim(), muted: root.getPropertyValue('--muted').trim(), mask: layer.backgroundColor };
          });
          const mask = colors.mask.match(/[\d.]+/g).map(Number), alpha = mask[3];
          const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16));
          for (const extreme of [0, 255]) for (const color of [colors.text, colors.muted]) {
            assert.ok(ratio(rgb(color), mask.slice(0, 3).map(v => v * alpha + extreme * (1 - alpha))) >= 4.5, JSON.stringify(colors));
          }
          if (src === 'complex') { await page.waitForTimeout(260); await shot(page, client + '-' + theme); }
        }
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#cover-background img').last().evaluate(img => getComputedStyle(img).transitionDuration), '0s');
      assert.equal(await page.locator('.app').evaluate(app => getComputedStyle(app).filter), 'none');
      assert.equal(await page.locator('#cover-background').evaluate(layer => getComputedStyle(layer).pointerEvents), 'none');
      for (const size of mobile ? [{ width: 320, height: 640 }, { width: 812, height: 375 }, { width: 768, height: 1024 }] : [{ width: 960, height: 680 }]) {
        await page.setViewportSize(size); await settings(page, mobile);
        const checkbox = page.locator('#background-mode');
        await checkbox.selectOption('theme'); await checkbox.selectOption('current-cover');
        await ready(page, 'complex.svg');
        const rect = await checkbox.evaluate(node => node.getBoundingClientRect().toJSON());
        assert.ok(rect.left >= 0 && rect.right <= size.width);
        await shot(page, client + '-' + size.width + '-settings');
        if (!mobile) await page.locator('#close-quality-settings').click();
      }
      if (mobile) {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '28px'; });
        const label = page.locator('label[for=background-mode]');
        await label.scrollIntoViewIfNeeded();
        const bounds = await label.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), size: parseFloat(getComputedStyle(node).fontSize) }));
        assert.ok(bounds.size >= 25 && bounds.rect.left >= 0 && bounds.rect.right <= 320 && bounds.rect.height >= 48,JSON.stringify(bounds));
        await page.locator('#background-mode').selectOption('theme');
        await shot(page, client + '-large-text-settings');
      }
    });
  }
  if (clients.includes(true)) await t.test('android: real bundled runtime keeps background settings out of native library exports', async () => {
    const { page } = await fixture(true, true);
    await page.evaluate(() => window.playerAPI.command('playlist-select', { id: 'other' }));
    const before = await page.evaluate(async () => { window.nativeCalls = []; return window.playerAPI.getState(); });
    await settings(page, true); await page.locator('#background-mode').selectOption('current-cover'); await ready(page, 'white.svg');
    const after = await page.evaluate(() => window.playerAPI.getState());
    assert.deepEqual(after, before);
    const nativeCalls = await page.evaluate(() => window.nativeCalls);
    assert.ok(nativeCalls.every(call => call.method === 'theme' || call.method === 'sleep-timer-state'), JSON.stringify(nativeCalls));
    await page.evaluate(() => window.playerAPI.exportLibrary());
    const exported = await page.evaluate(() => window.exportedLibrary);
    assert.ok(exported && !exported.includes('mixtunes-background-mode') && !exported.includes('current-cover'));
    assert.equal(await page.locator('#background-mode').inputValue(), 'current-cover');
  });
  await t.test('Android real runtime routes private backgrounds separately from playlist and transport',async()=>{
    const {page}=await fixture(true,true);
    const result=await page.evaluate(async()=>{
      const before=await playerAPI.getState();nativeCalls.length=0;
      const value={version:1,image:'data:image/jpeg;base64,AAAA',crop:{x:.4,y:.6,zoom:2}};
      await playerAPI.background('save',value);const loaded=await playerAPI.background('load');
      await playerAPI.background('editor',{open:true});await playerAPI.background('editor',{open:false});
      const pick=await playerAPI.background('pick');await playerAPI.background('delete');
      return{before,after:await playerAPI.getState(),loaded,pick,methods:nativeCalls.map(c=>c.method)};
    });
    assert.deepEqual(result.after,result.before);assert.equal(result.loaded.crop.zoom,2);assert.equal(result.pick.canceled,true);
    assert.deepEqual(result.methods,['storage-background-save','storage-background-load','background-editor','background-editor','background-pick','storage-background-delete']);
  });
  await t.test('Android production crop dialog remains accessible above the player in small, landscape and tablet layouts',async()=>{
    const {page}=await fixture(true,true);
    const before=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#e08c58';ctx.fillRect(0,0,600,800);ctx.fillStyle='#527bcb';ctx.fillRect(600,0,600,800);
      window.fixtureBackgroundChoice={image:canvas.toDataURL('image/jpeg',.9)};return playerAPI.getState();
    });
    await settings(page,true);await page.locator('#background-pick').click();await page.locator('#background-crop-dialog').waitFor({state:'visible'});
    for(const viewport of [{width:320,height:640},{width:812,height:375},{width:768,height:1024}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(30);await page.locator('#background-confirm').scrollIntoViewIfNeeded();
      const bounds=await page.locator('#background-confirm').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);
      await shot(page,'android-actual-crop-'+viewport.width);
    }
    await page.locator('#background-confirm').click();await page.waitForFunction(()=>document.querySelector('#cover-background img.custom-background-image')?.naturalWidth===1200);
    assert.equal(await page.locator('#background-mode').inputValue(),'custom');assert.deepEqual(await page.evaluate(()=>playerAPI.getState()),before);
    assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('data:image'));
  });
});
