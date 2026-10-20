'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const TRACK = { key: 'key-a', platform: 'netease', sourceId: '1', title: '已添加歌曲', artist: '作者', durationMs: 180000, coverUrl: '' };
const STATE = {
  tracks: [TRACK],
  playlists: [{ id: 'a', name: '歌单 A', queue: [TRACK.key], currentKey: TRACK.key }, { id: 'b', name: '歌单 B', queue: [] }],
  activePlaylistId: 'a', queue: [TRACK.key], currentKey: TRACK.key, currentTrack: TRACK,
  playbackPlaylistId: 'a', playbackQueue: [TRACK.key], status: 'paused', positionMs: 0, durationMs: 180000,
  volume: 0.7, muted: false, qualitySettings: { qq: 'auto', netease: 'auto', bilibili: 'auto' }, accounts: {}
};

test('search add feedback and result state stay in sync on Windows and Android', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());

  async function fixture(mobile, snapshot = STATE) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 760 } : { width: 960, height: 680 }, isMobile: mobile, hasTouch: mobile });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'no page errors'));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      if (mobile && file === 'runtime.js') return route.fulfill({ contentType: 'application/javascript', body: ['search-match.js', 'locate-playing.js'].map((name) => read('app/ui/' + name)).join('\n') });
      const dir = mobile ? 'android/web' : 'app/ui';
      const source = path.join(root, dir, file);
      if (!fs.existsSync(source)) return route.abort();
      return route.fulfill({ body: fs.readFileSync(source), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript((snapshot) => {
      window.fixtureState = structuredClone(snapshot);
      window.addMode = 'added';
      window.addCalls = [];
      window.searchCalls = [];
      window.playerAPI = {
        getState: async () => structuredClone(window.fixtureState),
        onState: (fn) => { window.stateListener = fn; return () => { window.stateListener = null; }; },
        onNotice: () => {},
        command: async () => ({ ok: true }),
        search: async (payload) => {
          window.searchCalls.push(payload);
          const ids = { qq: '0016IKty1sTxqi', netease: '33894312', bilibili: 'BV17x411w7KC' };
          const item = { id: ids[payload.platform], platform: payload.platform, title: '搜索结果 ' + payload.platform, artist: '搜索作者', durationMs: 180000, coverUrl: '' };
          return { ok: true, requestId: 'batch-' + payload.platform, results: [{ platform: payload.platform, ok: true, items: [item], total: 1, hasMore: false }] };
        },
        addSearchResult: async (payload) => {
          window.addCalls.push(structuredClone(payload));
          if (window.addMode === 'error') return { ok: false, error: '网络异常，未能加入' };
          if (window.addMode === 'duplicate') return { ok: true, status: 'duplicate', added: 0, existingKey: 0, duplicateMetadata: 1, key: 'key-dup', playlistId: payload.playlistId };
          if (window.addMode === 'exists') return { ok: true, status: 'exists', added: 0, existingKey: 1, duplicateMetadata: 0, key: 'key-' + payload.playlistId, playlistId: payload.playlistId };
          return { ok: true, status: 'added', added: 1, existingKey: 0, duplicateMetadata: 0, key: 'key-' + payload.playlistId, playlistId: payload.playlistId };
        }
      };
    }, snapshot);
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI : () => document.getElementById('connection-status').textContent === '已就绪');
    return page;
  }

  async function search(page, mobile) {
    if (mobile) {
      await page.locator('[data-screen="search"]').click();
      await page.locator('#search-query').fill('测试');
      await page.locator('#search-submit').click();
      await page.locator('.search-result').first().waitFor();
      return page.locator('.search-result').first();
    }
    await page.locator('#open-online-search').click();
    await page.locator('#online-search-query').fill('测试');
    await page.locator('#online-search-submit').click();
    await page.locator('.online-result').first().waitFor();
    return page.locator('.online-result').first();
  }
  const addButton = (row, mobile) => mobile ? row.locator('.result-add') : row.locator('[data-testid="online-result-add"]');
  const rowFor = (page, mobile, platform) => page.locator(`${mobile ? '.search-result' : '.online-result'}[data-platform="${platform}"]`).first();
  async function openTarget(page, row, mobile) {
    await addButton(row, mobile).click();
    if (mobile) await page.locator('[data-target-add]').first().waitFor();
    else await page.locator('#search-add-playlist').waitFor({ state: 'visible' });
  }
  async function chooseAndSubmit(page, mobile, playlistId) {
    if (mobile) await page.locator(`[data-target-add="${playlistId}"]`).click();
    else {
      await page.locator('#search-add-playlist').selectOption(playlistId);
      await page.locator('#search-add-submit').click();
    }
  }
  async function closeTarget(page, mobile) {
    if (mobile) await page.evaluate(() => window.mobileUI.back());
    else if (await page.locator('#search-add-dialog').evaluate((node) => node.open)) await page.locator('#search-add-cancel').click();
  }
  const icon = async (row, mobile) => (await addButton(row, mobile).textContent()).trim();
  const messageText = (page, mobile) => mobile ? page.evaluate(() => document.getElementById('notice-text').textContent) : page.locator('#online-search-message').textContent();

  for (const mobile of [false, true]) {
    const client = mobile ? 'android' : 'windows';

    await t.test(client + ': P2 does not disable adding the missing P1', async () => {
      const snapshot = structuredClone(STATE);
      const part = { key: 'bilibili:BV17x411w7KC:102', platform: 'bilibili', sourceId: 'BV17x411w7KC', url: 'https://www.bilibili.com/video/BV17x411w7KC?p=2', title: 'Video P2', artist: 'Author', extra: { page: 2, cid: '102' } };
      snapshot.tracks.push(part); snapshot.playlists[0].queue.push(part.key);
      const page = await fixture(mobile, snapshot);
      await search(page, mobile);
      const row = rowFor(page, mobile, 'bilibili');
      assert.equal(await icon(row, mobile), '＋');
      await openTarget(page, row, mobile);
      const submit = page.locator(mobile ? '[data-target-add="a"]' : '#search-add-submit');
      assert.equal(await submit.isDisabled(), false);
      await chooseAndSubmit(page, mobile, 'a');
      assert.equal(await page.evaluate(() => window.addCalls[0].platform), 'bilibili');
    });

    await t.test(client + ': success shows feedback, marks the result and still allows other playlists', async () => {
      const page = await fixture(mobile);
      const row = await search(page, mobile);
      assert.equal(await icon(row, mobile), '＋');
      await openTarget(page, row, mobile);
      await chooseAndSubmit(page, mobile, 'a');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added === '1';
      }, mobile);
      assert.equal(await icon(row, mobile), '✓');
      assert.match(await messageText(page, mobile), /已加入/);
      assert.equal(await addButton(row, mobile).isDisabled(), false, 'other playlists remain reachable');

      await closeTarget(page, mobile);
      await openTarget(page, row, mobile);
      if (mobile) {
        assert.equal(await page.locator('[data-target-add="a"]').textContent(), '已加入');
        assert.equal(await page.locator('[data-target-add="a"]').isDisabled(), true);
      } else {
        const options = await page.locator('#search-add-playlist option').allTextContents();
        assert.match(options.find((text) => text.includes('歌单 A')), /已加入|已存在/);
      }
      await chooseAndSubmit(page, mobile, 'b');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added === '2';
      }, mobile);
      assert.equal(await icon(row, mobile), '✓');
    });

    await t.test(client + ': duplicate metadata is explained and never marks the track as added', async () => {
      const page = await fixture(mobile);
      await page.evaluate(() => { window.addMode = 'duplicate'; });
      const row = await search(page, mobile);
      await openTarget(page, row, mobile);
      await chooseAndSubmit(page, mobile, 'a');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.duplicate === 'true';
      }, mobile);
      assert.equal(await icon(row, mobile), '＋');
      assert.match(await messageText(page, mobile), /同名同作者/);
      assert.equal(await addButton(row, mobile).isDisabled(), false);
    });

    await t.test(client + ': failures keep the dialog usable and can be retried', async () => {
      const page = await fixture(mobile);
      await page.evaluate(() => { window.addMode = 'error'; });
      const row = await search(page, mobile);
      await openTarget(page, row, mobile);
      await chooseAndSubmit(page, mobile, 'a');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.failed === 'true';
      }, mobile);
      assert.equal(await icon(row, mobile), '＋');
      assert.match(await messageText(page, mobile), /网络异常/);
      if (!mobile) {
        assert.equal(await page.locator('#search-add-dialog').evaluate((node) => node.open), true, 'dialog stays open for retry');
        assert.match(await page.locator('#search-add-status').textContent(), /网络异常/);
      } else {
        assert.equal(await page.locator('[data-target-add="a"]').textContent(), '重试');
      }
      await page.evaluate(() => { window.addMode = 'added'; });
      await chooseAndSubmit(page, mobile, 'a');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added === '1';
      }, mobile);
      assert.equal(await icon(row, mobile), '✓');
      assert.equal(await page.evaluate(() => window.addCalls.length >= 2), true);
    });

    await t.test(client + ': removing the song clears the mark, a new search starts clean', async () => {
      const page = await fixture(mobile);
      const row = await search(page, mobile);
      await openTarget(page, row, mobile);
      await chooseAndSubmit(page, mobile, 'a');
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added === '1';
      }, mobile);
      await closeTarget(page, mobile);
      await page.evaluate(() => {
        const next = structuredClone(window.fixtureState);
        next.playlists = next.playlists.map((playlist) => playlist.id === 'a' ? { ...playlist, queue: [] } : playlist);
        next.queue = []; next.currentKey = null; next.currentTrack = null;
        window.stateListener(next);
      });
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added === '0';
      }, mobile);
      assert.equal(await icon(row, mobile), '＋');

      if (mobile) {
        await search(page, mobile);
      } else {
        await page.locator('#online-search-query').fill('重新搜索');
        await page.locator('#online-search-submit').click();
        await page.locator('.online-result').first().waitFor();
      }
      assert.equal(await page.evaluate((m) => {
        const button = m ? document.querySelector('.search-result .result-add') : document.querySelector('[data-testid="online-result-add"]');
        return button && button.dataset.added;
      }, mobile), '0');
    });

    await t.test(client + ': songs already in the library show as added on first search', async () => {
      const ids = { qq: '0016IKty1sTxqi', netease: '33894312', bilibili: 'BV17x411w7KC' };
      const localTracks = [
        { key: 'qq:' + ids.qq, platform: 'qq', sourceId: ids.qq, title: '同一首歌', artist: '同一作者', url: 'https://y.qq.com/n/ryqq/songDetail/' + ids.qq },
        { key: 'netease:' + ids.netease, platform: 'netease', sourceId: ids.netease, title: '同一首歌', artist: '同一作者', url: 'https://music.163.com/song?id=' + ids.netease },
        { key: 'bilibili:' + ids.bilibili + ':12345', platform: 'bilibili', sourceId: ids.bilibili, title: '同一首歌', artist: '同一作者', url: 'https://www.bilibili.com/video/' + ids.bilibili }
      ];
      const queues = localTracks.map((track) => track.key);
      const preloaded = { ...STATE, tracks: localTracks,
        playlists: [{ id: 'a', name: '歌单 A', queue: queues }, { id: 'b', name: '歌单 B', queue: queues }],
        queue: queues, currentKey: localTracks[0].key, currentTrack: localTracks[0], playbackQueue: queues, playbackPlaylistId: 'a' };
      const page = await fixture(mobile, preloaded);
      await search(page, mobile);
      for (const platform of ['qq', 'netease', 'bilibili']) {
        const row = rowFor(page, mobile, platform);
        await row.waitFor();
        await page.waitForFunction(({ mobile: isMobile, platform: name }) => {
          const button = isMobile ? document.querySelector(`.search-result[data-platform="${name}"] .result-add`) : document.querySelector(`.online-result[data-platform="${name}"] [data-testid="online-result-add"]`);
          return button && button.dataset.added === '2';
        }, { mobile, platform });
        assert.equal(await icon(row, mobile), '✓');
      }
      assert.equal(await page.evaluate(() => window.addCalls.length), 0, 'no network add or import required');
      const netease = rowFor(page, mobile, 'netease');
      await openTarget(page, netease, mobile);
      if (mobile) {
        assert.equal(await page.locator('[data-target-add="a"]').textContent(), '已存在');
        assert.equal(await page.locator('[data-target-add="b"]').textContent(), '已存在');
      } else {
        const options = await page.locator('#search-add-playlist option').allTextContents();
        assert.equal(options.filter((text) => /歌单 [AB] · 已存在/.test(text)).length, 2);
        assert.equal(await page.locator('#search-add-submit').isDisabled(), true);
      }
      await closeTarget(page, mobile);
      await page.evaluate(() => {
        const next = structuredClone(window.fixtureState);
        next.playlists = next.playlists.map((playlist) => playlist.id === 'a' ? { ...playlist, queue: playlist.queue.filter((key) => key !== 'netease:33894312') } : playlist);
        window.stateListener(next);
      });
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result[data-platform="netease"] .result-add') : document.querySelector('.online-result[data-platform="netease"] [data-testid="online-result-add"]');
        return button && button.dataset.added === '1';
      }, mobile);
      assert.equal(await icon(netease, mobile), '✓');
      await page.evaluate(() => {
        const next = structuredClone(window.fixtureState);
        next.playlists = next.playlists.map((playlist) => ({ ...playlist, queue: playlist.queue.filter((key) => key !== 'netease:33894312') }));
        window.stateListener(next);
      });
      await page.waitForFunction((m) => {
        const button = m ? document.querySelector('.search-result[data-platform="netease"] .result-add') : document.querySelector('.online-result[data-platform="netease"] [data-testid="online-result-add"]');
        return button && button.dataset.added === '0';
      }, mobile);
      assert.equal(await icon(netease, mobile), '＋');
    });

    await t.test(client + ': same title and artist from another source is not marked as added', async () => {
      const local = { key: 'qq:otherMid123', platform: 'qq', sourceId: 'otherMid123', title: '搜索结果 qq', artist: '搜索作者', url: 'https://y.qq.com/n/ryqq/songDetail/otherMid123' };
      const page = await fixture(mobile, { ...STATE, tracks: [local], playlists: [{ id: 'a', name: '歌单 A', queue: [local.key] }], queue: [local.key], currentKey: local.key, currentTrack: local, playbackQueue: [local.key] });
      await search(page, mobile);
      const row = rowFor(page, mobile, 'qq');
      await row.waitFor();
      assert.equal(await page.evaluate((m) => {
        const button = m ? document.querySelector('.search-result[data-platform="qq"] .result-add') : document.querySelector('.online-result[data-platform="qq"] [data-testid="online-result-add"]');
        return button && button.dataset.added;
      }, mobile), '0');
      assert.equal(await icon(row, mobile), '＋');
    });
  }
});
