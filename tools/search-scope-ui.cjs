'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');

test('desktop and Android keep library filters separate from online searches', async t => {
  const browser = await chromium.launch({ channel: process.env.MIXTUNES_TEST_BROWSER || 'msedge', headless: true });
  t.after(() => browser.close());
  const tracks = ['qq', 'netease', 'bilibili', 'qq'].map((platform, i) => ({ key: `${platform}:${i + 1}`, platform,
    sourceId: String(i + 1), title: i === 3 ? 'OutsideOnly' : `Local ${i + 1}`, artist: i === 1 ? 'Other Artist' : 'Shared Artist', durationMs: 180000 }));
  const initial = { tracks, playlists: [{ id: 'active', name: '当前测试歌单', queue: tracks.slice(0, 3).map(x => x.key) },
    { id: 'other', name: '其他歌单', queue: [tracks[3].key] }], activePlaylistId: 'active', queue: tracks.slice(0, 3).map(x => x.key),
    currentKey: tracks[1].key, currentTrack: tracks[1], playbackPlaylistId: 'active', playbackQueue: tracks.slice(0, 3).map(x => x.key),
    status: 'paused', positionMs: 42000, durationMs: 180000, volume: .7, muted: false };

  async function fixture(mobile, empty = false, status = 'paused') {
    const page = await browser.newPage({ viewport: mobile ? { width: 320, height: 640 } : { width: 960, height: 680 }, isMobile: mobile, hasTouch: mobile });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://mixtunes.test') return route.abort();
      const file = url.pathname.slice(1) || 'index.html';
      const dir = mobile ? 'android/web' : 'app/ui';
      if (!['index.html', 'styles.css', 'ui.js', 'app.js', 'theme.js', 'runtime.js', 'sleep-timer.js', 'search-match.js'].includes(file)) return route.abort();
      const source = mobile && file === 'runtime.js' ? 'app/ui/search-match.js' : `${dir}/${file}`;
      return route.fulfill({ body: fs.readFileSync(path.resolve(__dirname, '..', source)), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.addInitScript(snapshot => {
      window.fixtureState = snapshot; window.calls = []; window.searchCalls = []; window.searchMode = 'results';
      window.playerAPI = {
        getState: async () => structuredClone(window.fixtureState), onState: fn => { window.stateListener = fn; }, onNotice: () => {},
        command: async (name, payload) => {
          window.calls.push({ name, payload });
          if (name === 'playlist-select') {
            const playlist=window.fixtureState.playlists.find(p=>p.id===payload.id);
            Object.assign(window.fixtureState,{activePlaylistId:playlist.id,queue:[...playlist.queue]});
            window.stateListener(structuredClone(window.fixtureState));
          }
          return { ok: true };
        },
        search: async payload => {
          window.searchCalls.push(payload);
          const failed = window.searchMode === 'error' && payload.platform === 'qq';
          const items = window.searchMode === 'results' ? [{ id: payload.platform + '-online', platform: payload.platform,
            title: 'Online ' + payload.platform, artist: 'Online Artist', durationMs: 180000 }] : [];
          return { ok: true, requestId: 'request-' + payload.platform, results: [{ platform: payload.platform, ok: !failed,
            error: failed ? '测试：平台请求失败' : '', items, total: items.length, hasMore: false }] };
        }
      };
    }, empty ? { ...initial, status, queue: [], playlists: [{ ...initial.playlists[0], queue: [] }, initial.playlists[1]] } : {...initial,status});
    await page.goto('http://mixtunes.test/');
    await page.waitForFunction(mobile ? () => window.mobileUI && !document.getElementById('play-pause').disabled : () => document.getElementById('connection-status').textContent === '已就绪');
    return page;
  }
  const localInput = (page, mobile) => page.locator(mobile ? '#library-filter' : '#search-input');
  const localRows = (page, mobile) => page.locator(mobile ? '.song-row' : '#track-list tr');
  const results = (page, mobile) => page.locator(mobile ? '.search-result' : '.online-result');
  async function openOnline(page, mobile) { await page.locator(mobile ? '[data-screen="search"]' : '#open-online-search').click(); }
  async function submit(page, mobile, query) {
    await page.locator(mobile ? '#search-query' : '#online-search-query').fill(query);
    await page.locator(mobile ? '#search-submit' : '#online-search-submit').click();
    await page.waitForFunction(() => window.searchCalls.length >= 3);
  }
  async function shot(page, name) {
    if (process.env.MIXTUNES_SCOPE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MIXTUNES_SCOPE_SCREENSHOTS, name + '.png') });
  }

  for (const mobile of [false, true]) {
    const client = mobile ? 'android' : 'windows';
    await t.test(client + ': filters only the current playlist without online requests; online searches keep their three providers', async () => {
      const page = await fixture(mobile);
      const before = await page.evaluate(() => structuredClone(fixtureState));
      assert.equal(await localInput(page,mobile).getAttribute('placeholder'),'筛选当前歌单');
      assert.equal(await localInput(page,mobile).getAttribute('aria-describedby'),'library-scope');
      await localInput(page, mobile).fill(' shared artist ');
      assert.equal(await localRows(page, mobile).count(), 2);
      if (!mobile) { await page.locator('[data-filter="qq"]').click(); assert.equal(await localRows(page, false).count(), 1); }
      await localInput(page, mobile).fill('OutsideOnly');
      assert.equal(await localRows(page, mobile).count(), 0);
      assert.equal(await page.locator('#empty-description').isVisible(), true);
      assert.equal(await page.locator('#library-scope').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => searchCalls), []);
      await shot(page, client + '-filter-empty');
      await openOnline(page, mobile);
      assert.equal(await page.locator('#online-search-scope').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => searchCalls), []);
      if (!mobile) assert.equal(await page.locator('#online-search-query').inputValue(), 'OutsideOnly');
      await page.locator(mobile ? '[data-search-platform="netease"]' : '[data-online-filter="netease"]').click();
      await submit(page, mobile, ' OutsideOnly ');
      await results(page, mobile).first().waitFor();
      const requests = await page.evaluate(() => searchCalls);
      assert.deepEqual(requests.sort((a, b) => a.platform.localeCompare(b.platform)), ['bilibili', 'netease', 'qq'].map(platform => ({ query: 'OutsideOnly', platform, page: 1 })));
      // Desktop resets its result tab on submit; Android retains it. Keep both existing behaviors.
      if (!mobile) {
        assert.equal(await results(page, false).count(), 3);
        await page.locator('[data-online-filter="netease"]').click();
      }
      assert.equal(await results(page, mobile).count(), 1);
      assert.equal(await results(page, mobile).getAttribute('data-platform'), 'netease');
      await page.locator(mobile ? '[data-search-platform="all"]' : '[data-online-filter="all"]').click();
      assert.equal(await results(page, mobile).count(), 3);
      assert.equal((await page.evaluate(() => searchCalls)).length, 3);
      await shot(page, client + '-online-results');
      await page.locator(mobile ? '[data-screen="library"]' : '#close-online-search').click();
      assert.equal(await localInput(page, mobile).inputValue(), 'OutsideOnly');
      assert.equal(await localRows(page, mobile).count(), 0);
      assert.deepEqual(await page.evaluate(() => fixtureState), before);
      assert.deepEqual(await page.evaluate(() => calls.filter(x => !['theme', 'video-layout'].includes(x.name))), []);
    });

    await t.test(client + ': empty library offers import and explains online scope without automatically searching', async () => {
      const page = await fixture(mobile, true);
      assert.equal(await page.locator(mobile ? '#empty-import' : '#focus-import').isVisible(), true);
      assert.equal(await page.locator('#empty-description').isVisible(), true);
      assert.ok((await page.locator('#empty-description').textContent()).includes('在线搜索'));
      await shot(page, client + '-empty-library');
      await page.locator('#toggle-theme').click();
      await shot(page, client + '-empty-library-dark');
      assert.deepEqual(await page.evaluate(() => searchCalls), []);
    });

    await t.test(client + ': empty online results remain provider-specific and failures retain retry actions', async () => {
      const page = await fixture(mobile);
      await openOnline(page, mobile);
      await page.evaluate(() => { window.searchMode = 'empty'; });
      await submit(page, mobile, 'NoResults');
      await page.waitForFunction(() => document.body.textContent.includes('该平台暂无匹配结果'));
      const states = page.locator(mobile ? '.platform-state' : '.online-platform-state');
      assert.equal(await states.count(), 3);
      assert.equal(await results(page, mobile).count(), 0);
      assert.equal(await page.locator(mobile ? '.original-search' : '[data-testid="online-search-original"]').count(), 3);
      await shot(page, client + '-online-empty');
      await page.evaluate(() => { window.searchCalls = []; window.searchMode = 'error'; });
      await submit(page, mobile, 'RetryQuery');
      await page.waitForFunction(() => document.body.textContent.includes('暂时无法搜索'));
      assert.equal(await page.locator(mobile ? '.retry-search' : '[data-testid="online-search-retry"]').count(), 1);
      assert.equal(await results(page, mobile).count(), 0);
      assert.deepEqual(await page.evaluate(() => calls.filter(x => !['theme', 'video-layout'].includes(x.name))), []);
    });

    await t.test(client + ': clearing a local filter preserves paused and playing snapshots without commands',async()=>{
      for(const status of ['paused','playing']){
        const page=await fixture(mobile,false,status),before=await page.evaluate(()=>structuredClone(fixtureState));
        await localInput(page,mobile).fill('OutsideOnly');assert.equal(await localRows(page,mobile).count(),0);
        await localInput(page,mobile).fill('');assert.equal(await localRows(page,mobile).count(),3);
        assert.deepEqual(await page.evaluate(()=>fixtureState),before);
        assert.deepEqual(await page.evaluate(()=>searchCalls),[]);
        assert.deepEqual(await page.evaluate(()=>calls.filter(x=>!['theme','video-layout'].includes(x.name))),[]);
        await page.close();
      }
    });

    await t.test(client + ': repeated search, provider retry and playlist switch retain original platform behavior',async()=>{
      const page=await fixture(mobile),before=await page.evaluate(()=>structuredClone(fixtureState));
      await localInput(page,mobile).fill('OutsideOnly');await openOnline(page,mobile);
      for(let repeat=0;repeat<2;repeat++){
        await page.evaluate(()=>{window.searchCalls=[];});await submit(page,mobile,' RepeatQuery ');
        await results(page,mobile).first().waitFor();
        assert.deepEqual((await page.evaluate(()=>searchCalls)).map(c=>c.platform).sort(),['bilibili','netease','qq']);
      }
      await page.evaluate(()=>{window.searchCalls=[];window.searchMode='error';});await submit(page,mobile,'RetryQuery');
      const retry=page.locator(mobile?'.retry-search':'[data-testid="online-search-retry"]');await retry.waitFor();
      await page.evaluate(()=>{window.searchMode='results';});await retry.click();
      await page.waitForFunction(()=>searchCalls.length===4);
      assert.deepEqual((await page.evaluate(()=>searchCalls)).at(-1),{query:'RetryQuery',platform:'qq',page:1});
      await page.locator(mobile?'.search-result[data-platform="qq"]':'.online-result[data-platform="qq"]').waitFor();
      await page.evaluate(()=>window.playerAPI.command('playlist-select',{id:'other'}));
      if(mobile)assert.equal(await results(page,true).count(),1);
      else{
        assert.equal(await results(page,false).count(),0);
        assert.match(await page.locator('#online-search-message').textContent(),/歌单已切换.*重新搜索/);
      }
      await page.locator(mobile?'[data-screen="library"]':'#close-online-search').click();
      assert.equal(await localInput(page,mobile).inputValue(),'');assert.equal(await localRows(page,mobile).count(),1);
      const after=await page.evaluate(()=>fixtureState);
      for(const key of ['currentKey','status','positionMs','playbackPlaylistId','playbackQueue','playlists','tracks'])assert.deepEqual(after[key],before[key],key);
      assert.deepEqual(await page.evaluate(()=>calls.filter(x=>!['theme','video-layout'].includes(x.name))),[{name:'playlist-select',payload:{id:'other'}}]);
    });
  }
});
