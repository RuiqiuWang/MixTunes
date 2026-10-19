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

function createUi(initialState = baseState(), options = {}) {
  const commands = [];
  const calls = { trackFileStatus: [], prepareTrackFile: [], saveTrackFile: [], startTrackDrag: [], trackDownloadStatus: [], trackDownload: [], trackDownloadCancel: [], trackReveal: [], login: [], chooseDownloads: [] };
  const clipboard = [];
  const prepareResult = options.prepareResult === undefined ? { ok: true } : options.prepareResult;
  const background = options.background || { file: null, dim: 0.72, blur: 0, luminance: 0.5, image: null };
  const dom = new JSDOM(HTML, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;

  // jsdom has no clipboard; the sharing tests need to see what would be copied.
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { clipboard.push(String(text)); } },
  });

  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolled = 'yes'; };
  // jsdom implements <dialog> only partially; keep the same open/close contract as
  // Chromium so the dialogs can be exercised.
  const dialogProto = window.HTMLDialogElement.prototype;
  Object.defineProperty(dialogProto, 'open', {
    configurable: true,
    get() { return this.hasAttribute('open'); },
    set(value) { if (value) this.setAttribute('open', ''); else this.removeAttribute('open'); },
  });
  dialogProto.showModal = function showModal() { this.setAttribute('open', ''); };
  dialogProto.show = function show() { this.setAttribute('open', ''); };
  dialogProto.close = function close() { this.removeAttribute('open'); };

  let handler = null;
  let backgroundHandler = null;
  let progressHandler = null;
  let chosenDirectory = null;
  window.playerAPI = {
    getState: async () => initialState,
    command: async (name, payload = {}) => { commands.push({ name, payload }); return { ok: true }; },
    importLinks: async () => ({ ok: true }),
    login: async (platform, mode) => { calls.login.push([platform, mode]); return { ok: true }; },
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
    getBackground: async () => ({ ok: true, background }),
    chooseBackground: async () => ({ ok: true }),
    setBackground: async () => ({ ok: true }),
    clearBackground: async () => ({ ok: true }),
    trackFileStatus: async (keys = []) => { calls.trackFileStatus.push(keys); return { ok: true, ready: Array.isArray(options.readyKeys) ? options.readyKeys : [] }; },
    trackDownloadStatus: async (keys = []) => { calls.trackDownloadStatus.push(keys); return { ok: true, downloaded: Array.isArray(options.downloadedKeys) ? options.downloadedKeys : [] }; },
    trackDownload: async (key) => {
      calls.trackDownload.push(key);
      if (options.downloadPending) return new Promise(() => {});
      if (Array.isArray(options.downloadFails) && options.downloadFails.includes(key)) return { ok: false, error: '下载失败' };
      return { ok: true, path: 'C:\\Users\\demo\\Music\\MixTunes\\demo.mp3' };
    },
    trackDownloadCancel: async (key) => { calls.trackDownloadCancel.push(key); return { ok: true, stopped: true }; },
    trackReveal: async (key) => { calls.trackReveal.push(key); return { ok: true }; },
    downloadsInfo: async () => ({ ok: true, directory: chosenDirectory || 'C:\\Users\\demo\\Music\\MixTunes', count: Array.isArray(options.downloadedKeys) ? options.downloadedKeys.length : 0 }),
    chooseDownloads: async () => { calls.chooseDownloads.push(true); chosenDirectory = 'D:\\Music'; return { ok: true, directory: chosenDirectory }; },
    openDownloads: async () => ({ ok: true }),
    onDownloadProgress(fn) { progressHandler = fn; return () => {}; },
    prepareTrackFile: async (key) => { calls.prepareTrackFile.push(key); if (prepareResult?.ok === false) return prepareResult; return { ok: true, key }; },
    saveTrackFile: async (key) => { calls.saveTrackFile.push(key); return { ok: true }; },
    startTrackDrag: (key) => { calls.startTrackDrag.push(key); },
    onState(fn) { handler = fn; return () => {}; },
    onNotice() { return () => {}; },
    onBackground(fn) { backgroundHandler = fn; return () => {}; },
  };

  for (const file of ['theme.js', 'background-math.js', 'ui-logic.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(UI_DIR, file), 'utf8'));
  }

  return {
    window,
    document: window.document,
    commands,
    calls,
    clipboard,
    byId: (id) => window.document.getElementById(id),
    push(state) {
      handler?.({ ...baseState(), ...state });
    },
    pushBackground(value) {
      backgroundHandler?.(value);
    },
    pushDownloadProgress(payload) {
      progressHandler?.(payload);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

module.exports = { createUi, baseState, track, flush, UI_DIR };
