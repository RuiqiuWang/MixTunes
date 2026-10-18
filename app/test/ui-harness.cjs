'use strict';

// Loads the real renderer (index.html + theme.js + ui-logic.js + app.js) inside
// jsdom so UI behaviour can be asserted without launching Electron.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const UI_DIR = path.join(__dirname, '..', 'ui');
const HTML = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8')
  // The Electron CSP blocks nothing jsdom needs, but inline <script src> tags are
  // replaced by direct evaluation below so no file:// fetches are involved.
  .replace(/<script src="[^"]+"><\/script>/g, '');

function track(overrides = {}) {
  return {
    key: 'netease:1',
    platform: 'netease',
    sourceId: '1',
    title: '晴天',
    artist: '周杰伦',
    url: 'https://music.163.com/song?id=1',
    durationMs: 269000,
    ...overrides,
  };
}

function baseState(overrides = {}) {
  const tracks = [
    track({ key: 'qq:1', platform: 'qq', sourceId: '1', title: '稻香', artist: '周杰伦', url: 'https://y.qq.com/n/ryqq/songDetail/1' }),
    track({ key: 'netease:1' }),
    track({ key: 'bilibili:1', platform: 'bilibili', sourceId: 'BV1', title: '演唱会', url: 'https://www.bilibili.com/video/BV1' }),
  ];
  return {
    tracks,
    playlists: [
      { id: 'p1', name: '通勤', queue: ['qq:1', 'netease:1'], mode: 'sequential', currentKey: null },
      { id: 'p2', name: '深夜', queue: ['bilibili:1'], mode: 'sequential', currentKey: null },
    ],
    activePlaylistId: 'p1',
    playbackPlaylistId: 'p1',
    queue: ['qq:1', 'netease:1'],
    mode: 'sequential',
    currentKey: null,
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    muted: false,
    qualitySettings: { qq: 'auto', netease: 'auto', bilibili: 'auto' },
    playbackQuality: null,
    videoPanel: { open: false, expanded: false },
    videoOpen: false,
    accounts: { qq: false, netease: false, bilibili: false },
    ...overrides,
  };
}

function createUi(initialState = baseState()) {
  const commands = [];
  const dom = new JSDOM(HTML, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;

  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolled = 'yes'; };

  let handler = null;
  window.playerAPI = {
    getState: async () => initialState,
    command: async (name, payload = {}) => { commands.push({ name, payload }); return { ok: true }; },
    importLinks: async () => ({ ok: true }),
    login: async () => ({ ok: true }),
    exportLibrary: async () => ({ ok: true }),
    importFile: async () => ({ ok: true }),
    openSource: async () => ({ ok: true }),
    search: async () => ({ ok: true, platforms: {} }),
    addSearchResult: async () => ({ ok: true }),
    playSearchResult: async () => ({ ok: true }),
    getLyrics: async () => ({ ok: true, lines: [] }),
    startPlaylistShare: async () => ({ ok: true }),
    stopPlaylistShare: async () => ({ ok: true }),
    openSearch: async () => ({ ok: true }),
    onState(fn) { handler = fn; return () => {}; },
    onNotice() { return () => {}; },
  };

  for (const file of ['theme.js', 'ui-logic.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(UI_DIR, file), 'utf8'));
  }

  return {
    window,
    document: window.document,
    commands,
    byId: (id) => window.document.getElementById(id),
    push(state) {
      handler?.({ ...baseState(), ...state });
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

module.exports = { createUi, baseState, track, flush, UI_DIR };
