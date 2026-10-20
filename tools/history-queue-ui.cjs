'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../app/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const shotDir = process.env.MIX_UI_SHOT_DIR || '';
async function capture(page, name) { if (!shotDir) return; fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false }); }
const tracks = ['a', 'b', 'c'].map((id, index) => ({
  key: id, platform: 'netease', sourceId: String(index + 1), title: `歌曲 ${id.toUpperCase()}`,
  artist: '测试歌手', durationMs: 180000, coverUrl: '',
}));
const baseState = {
  tracks, playlists: [{ id: 'p', name: '测试歌单', queue: ['a', 'b', 'c'], mode: 'sequential', currentKey: 'a' }],
  activePlaylistId: 'p', queue: ['a', 'b', 'c'], playbackQueue: ['a', 'b', 'c'],
  currentKey: 'a', currentTrack: tracks[0], mode: 'sequential', status: 'paused',
  positionMs: 0, durationMs: 180000, volume: .7, muted: false, accounts: {},
  historyVersion: 1, historyCount: 2, generation: 1, playbackPlaylistId: 'p',
};
const historySeed = [
  { id: 'h1', key: 'a', platform: 'netease', sourceId: '1', title: '历史歌曲 A', artist: '歌手甲', durationMs: 180000, playedAt: Date.now() - 60000 },
  { id: 'h2', key: 'b', platform: 'netease', sourceId: '2', title: '历史歌曲 B', artist: '歌手乙', durationMs: 180000, playedAt: Date.now() - 3600000 },
];

function mockScript() {
  const state = JSON.parse(JSON.stringify(window.__seedState));
  let history = JSON.parse(JSON.stringify(window.__seedHistory));
  let upcoming = ['b', 'c'];
  const listeners = [];
  const calls = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const summary = (key) => {
    const track = state.tracks.find((item) => item.key === key) || { key, title: key, artist: '', platform: '' };
    return { key, title: track.title, artist: track.artist, platform: track.platform, durationMs: track.durationMs || 0, coverUrl: '' };
  };
  const preview = () => ({
    ok: true, mode: state.mode, currentKey: state.currentKey,
    current: summary(state.currentKey), upcoming: state.mode === 'repeat-one' ? [] : upcoming.map(summary),
    repeatOne: state.mode === 'repeat-one', canReorder: state.mode !== 'repeat-one', playbackPlaylistId: 'p',
  });
  const push = () => listeners.forEach((fn) => fn(clone(state)));
  window.__calls = calls;
  window.__history = history;
  window.__queueOrder = () => upcoming.slice();
  window.__setMode = (mode) => {
    state.mode = mode;
    state.playlists[0].mode = mode;
    if (mode === 'repeat-one') upcoming = [];
    push();
  };
  window.__setUpcoming = (keys) => { upcoming = keys.slice(); push(); };
  window.__setHistory = (entries) => { history = entries.slice(); state.historyCount = history.length; state.historyVersion += 1; push(); };
  window.playerAPI = {
    getState: async () => clone(state),
    onState: (fn) => { listeners.push(fn); return () => {}; },
    onNotice: () => () => {},
    command: async (name, payload = {}) => {
      calls.push({ name, payload: clone(payload) });
      if (name === 'queue-preview' && window.__failQueue) throw new Error('队列读取失败');
      if (name === 'history-list' && window.__failHistory) throw new Error('历史读取失败');
      if (name === 'queue-preview') return preview();
      if (name === 'queue-move') {
        if (state.mode === 'repeat-one') throw new Error('单曲循环下不能调整待播顺序');
        const list = upcoming.slice();
        const [key] = list.splice(payload.fromIndex, 1);
        list.splice(payload.toIndex, 0, key);
        upcoming = list;
        state.playbackQueue = [state.currentKey, ...upcoming];
        push();
        return preview();
      }
      if (name === 'queue-play-next') {
        if (state.mode === 'repeat-one') throw new Error('单曲循环下不能设置下一首');
        upcoming = [payload.key, ...upcoming.filter((key) => key !== payload.key)];
        state.playbackQueue = [state.currentKey, ...upcoming];
        push();
        return preview();
      }
      if (name === 'history-list') return { ok: true, entries: clone(history) };
      if (name === 'history-remove') {
        history = history.filter((entry) => entry.id !== payload.id);
        state.historyCount = history.length; state.historyVersion += 1; push();
        return { ok: true };
      }
      if (name === 'history-clear') {
        history = []; state.historyCount = 0; state.historyVersion += 1; push();
        return { ok: true, cleared: 2 };
      }
      if (name === 'history-play') return { ok: true, key: 'a' };
      if (name === 'mode') { state.mode = payload.mode; if (payload.mode === 'repeat-one') upcoming = []; push(); return { ok: true }; }
      if (name === 'play') { state.status = 'playing'; push(); return { ok: true }; }
      return { ok: true };
    },
  };
}

async function fixture(browser, mobile, viewport) {
  const context = await browser.newContext({ viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1100, height: 800 }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let shell = mobile ? path.join(root, 'android/web') : path.join(root, 'app/ui');
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://mixtunes.test') return route.abort();
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (mobile && file === 'runtime.js') return route.fulfill({ body: ['search-match.js','sleep-timer.js','locate-playing.js','cover-background.js','background-image.js','background-settings.js'].map(name => fs.readFileSync(path.join(root,'app/ui',name),'utf8')).join('\n'), contentType: 'application/javascript' });
    const target = path.join(shell, file);
    if (!target.startsWith(shell) || !fs.existsSync(target)) return route.abort();
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript';
    await route.fulfill({ body: fs.readFileSync(target), contentType: type });
  });
  await page.addInitScript(({ state, history }) => {
    window.__seedState = state;
    window.__seedHistory = history;
  }, { state: baseState, history: historySeed });
  await page.addInitScript(mockScript);
  await page.goto('http://mixtunes.test/');
  await page.waitForFunction((mobile) => {
    if (mobile) return document.querySelector('#open-queue') && window.playerAPI;
    return document.querySelector('#open-queue') && document.querySelector('#connection-status')?.textContent === '已就绪';
  }, mobile);
  return { page, context, errors };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const mobile of [false, true]) {
      const client = mobile ? 'android' : 'windows';
      const { page, context, errors } = await fixture(browser, mobile);
      try {
        if (mobile) {
          assert.equal(await page.locator('.bottom-nav button').count(), 3, 'no fourth bottom-nav item');
          assert.equal(await page.locator('#open-history').isVisible(), true);
          assert.equal(await page.locator('#open-queue').isVisible(), true);
          const overflow = await page.evaluate(() => {
            const box = document.getElementById('player').getBoundingClientRect();
            return [...document.querySelectorAll('.transport button')].some((button) => {
              const rect = button.getBoundingClientRect();
              return rect.right > innerWidth + 1 || rect.left < -1 || rect.bottom > box.bottom + 1;
            });
          });
          assert.equal(overflow, false, 'transport controls fit on a 390px phone');
        }

        await page.locator(mobile ? '#open-history' : '#open-history').click();
        const historySelector = mobile ? '.history-sheet-row' : '.history-row';
        await page.locator(historySelector).first().waitFor();
        assert.equal(await page.locator(historySelector).count(), 2);
        assert.equal(await page.locator(mobile ? '#sheet-title' : '#history-dialog-title').textContent(), '播放历史');
        assert.equal(await page.locator(mobile ? '.history-sheet-title' : '.history-title').first().textContent(), '历史歌曲 A');
        await capture(page, client + '-history');
        // History replay closes the panel and asks the engine to play it.
        await page.locator(mobile ? '.history-sheet-main' : '.history-main').first().click();
        await page.waitForFunction(() => window.__calls.some((call) => call.name === 'history-play'));
        const playCall = await page.evaluate(() => window.__calls.find((call) => call.name === 'history-play'));
        assert.equal(playCall.payload.id, 'h1');
        if (mobile) assert.equal(await page.locator('#sheet-layer').isHidden(), true);
        else assert.equal(await page.locator('#history-dialog').evaluate((node) => node.open), false);

        if (mobile) await page.locator('#open-history').click();
        else await page.locator('#open-history').click();
        await page.locator(historySelector).first().waitFor();
        await page.locator(mobile ? '.history-sheet-delete' : '.history-delete').first().click();
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 1, historySelector);
        await page.locator(mobile ? '#history-clear-sheet' : '#history-clear').click();
        await page.locator(mobile ? '#history-clear-sheet' : '#history-clear').click();
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, historySelector);
        const emptyText = mobile ? '还没有播放记录。' : '还没有播放记录。播放满 3 秒后会自动出现在这里。';
        assert.equal(await page.locator(mobile ? '.queue-sheet-empty' : '#history-empty').textContent(), emptyText);
        if (mobile) await page.locator('#close-sheet').click();
        else await page.locator('#close-history').click();

        await page.locator('#open-queue').click();
        const queueRows = mobile ? '.queue-sheet-row' : '.queue-row';
        await page.locator(queueRows).first().waitFor();
        assert.equal(await page.locator(queueRows).count(), 2);
        assert.equal(await page.locator(mobile ? '.queue-sheet-note' : '#queue-mode-note').textContent().then((text) => text.includes('顺序播放')), true);
        assert.deepEqual(await page.evaluate(() => window.__queueOrder()), ['b', 'c']);
        await capture(page, client + '-queue');
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await capture(page, client + '-queue-dark');
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

        // Drag the second upcoming song to the front.
        const rows = page.locator(queueRows);
        const secondTitle = await page.locator(mobile ? '.queue-sheet-song' : '.queue-row-title').nth(1).textContent();
        if (mobile) {
          const handle = rows.nth(1).locator('.queue-sheet-handle');
          const target = rows.nth(0);
          const hb = await handle.boundingBox();
          const tb = await target.boundingBox();
          await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
          await page.mouse.down();
          await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
          await page.mouse.up();
        } else {
          await rows.nth(1).dragTo(rows.nth(0));
        }
        await page.waitForFunction(() => window.__calls.some((call) => call.name === 'queue-move'));
        const moveCall = await page.evaluate(() => window.__calls.find((call) => call.name === 'queue-move'));
        assert.deepEqual(moveCall.payload, { fromIndex: 1, toIndex: 0, limit: 50 });
        await page.waitForFunction(() => window.__queueOrder()[0] === 'c');
        assert.equal(await page.locator(mobile ? '.queue-sheet-song' : '.queue-row-title').first().textContent(), secondTitle);
        assert.deepEqual(await page.evaluate(() => window.__seedState.playlists[0].queue), ['a', 'b', 'c'], 'playlist order unchanged');

        // Touch/mouse drag works; explicit "next" buttons remain the non-drag path.
        await page.locator(mobile ? '.queue-next' : '.queue-next').nth(1).click();
        await page.waitForFunction(() => window.__calls.some((call) => call.name === 'queue-play-next'));
        assert.equal(await page.evaluate(() => window.__queueOrder()[0]), 'b');

        await page.evaluate(() => window.__setMode('repeat-one'));
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, queueRows);
        assert.equal(await page.locator(mobile ? '.queue-sheet-note' : '#queue-mode-note').textContent().then((text) => text.includes('单曲循环')), true);
        await capture(page, client + '-repeat-one');
        assert.equal(await page.locator(mobile ? '.queue-sheet-handle' : '.queue-handle').count(), 0);

        await page.evaluate(() => { window.__setUpcoming(['c', 'b']); window.__setMode('shuffle'); });
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 2, queueRows);
        const shuffleBefore = await page.locator(mobile ? '.queue-sheet-song' : '.queue-row-title').allTextContents();
        if (mobile) {
          const handle = page.locator(queueRows).nth(1).locator('.queue-sheet-handle');
          const target = page.locator(queueRows).nth(0);
          const hb = await handle.boundingBox();
          const tb = await target.boundingBox();
          await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
          await page.mouse.down();
          await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
          await page.mouse.up();
        } else {
          await page.locator(queueRows).nth(1).dragTo(page.locator(queueRows).nth(0));
        }
        await page.waitForFunction(() => window.__queueOrder()[0] !== 'c');
        assert.notDeepEqual(await page.evaluate(() => window.__queueOrder()), ['c', 'b']);
        assert.equal(await page.evaluate(() => window.__seedState.playlists[0].queue.join(',')), 'a,b,c');

        // Failure states keep a clear retry rather than an empty/confusing panel.
        await page.evaluate(() => { window.__failQueue = true; });
        if (mobile) await page.locator('#close-sheet').click(); else await page.locator('#close-queue').click();
        await page.locator('#open-queue').click();
        await page.waitForFunction(() => window.__calls.filter((call) => call.name === 'queue-preview').length >= 2);
        await page.locator('#queue-retry').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.__failQueue = false; });
        await page.locator('#queue-retry').click();
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 2, queueRows);
        if (mobile) await page.locator('#close-sheet').click(); else await page.locator('#close-queue').click();
        await page.evaluate(() => { window.__failHistory = true; });
        await page.locator('#open-history').click();
        await page.locator('#history-retry').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.__failHistory = false; });
        await page.locator('#history-retry').click();
        await page.waitForFunction(() => document.querySelectorAll('.history-row, .history-sheet-row').length === 0);
        if (mobile) await page.locator('#close-sheet').click(); else await page.locator('#close-history').click();
        assert.deepEqual(errors, []);
        console.log(`PASS ${client} history + queue UI`);
      } finally { await context.close(); }
    }
    {
      const { page, context, errors } = await fixture(browser, true, { width: 320, height: 640 });
      try {
        assert.equal(await page.locator('#open-history').isVisible(), true);
        assert.equal(await page.locator('#open-queue').isVisible(), true);
        await page.locator('#open-queue').click();
        await page.locator('.queue-sheet-row').first().waitFor();
        const overflow = await page.evaluate(() => [...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null).some((button) => {
          const rect = button.getBoundingClientRect();
          return rect.right > innerWidth + 1 || rect.left < -1;
        }));
        assert.equal(overflow, false, '320px sheet controls stay inside the viewport');
        assert.equal(await page.locator('#sheet').evaluate((node) => node.getBoundingClientRect().width <= innerWidth), true);
        await page.locator('#close-sheet').click();
        await page.locator('#open-history').click();
        await page.locator('.history-sheet-row').first().waitFor();
        assert.equal(await page.locator('#history-clear-sheet').isVisible(), true);
        const many = Array.from({ length: 500 }, (_, index) => ({ id: `many-${index}`, key: 'a', platform: 'netease', sourceId: '1', title: `历史 ${index}`, artist: '歌手', durationMs: 180000, playedAt: Date.now() - index * 1000 }));
        const started = Date.now();
        await page.evaluate((entries) => window.__setHistory(entries), many);
        await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 500, '.history-sheet-row');
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 3000, `500-row history rendered in ${elapsed}ms`);
        await page.locator('#close-sheet').click();
        assert.deepEqual(errors, []);
        console.log('PASS android 320px layout; 500 history rows rendered in ' + elapsed + 'ms');
      } finally { await context.close(); }
    }    console.log('PASS history/queue UI on Windows and Android');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
