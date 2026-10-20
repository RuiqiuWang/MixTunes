'use strict';

// Official references: Electron WebContentsView/View/Debugger, CDP
// Page.addScriptToEvaluateOnNewDocument, and HTMLMediaElement metadata/seeked.
// No remote page receives a preload, Node.js, IPC, or a local filesystem bridge.
const BRIDGE = '__mixlinkOfficialVideoV1';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Verified against the official page's #bilibili-player / bpx-player DOM.
// The original player, quality/fullscreen/volume controls and danmaku remain.
const PLAYER_ONLY_CSS = `
html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-width:0!important;overflow:hidden!important;background:#000!important}
#bili-header-container,.bili-header{display:none!important}
#bilibili-player{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;margin:0!important;padding:0!important;z-index:9999!important}
#bilibili-player .bpx-player-container,#bilibili-player .bpx-player-primary-area,#bilibili-player .bpx-player-video-area,#bilibili-player .bpx-player-video-perch,#bilibili-player .bpx-player-video-wrap{width:100%!important;height:100%!important}
`;

function videoTarget(track) {
  if (track?.platform !== 'bilibili') throw new Error('视频界面仅支持 Bilibili。');
  const bvid = String(track.extra?.bvid || track.sourceId || '');
  const page = Number(track.extra?.page || new URL(track.url || 'https://www.bilibili.com').searchParams.get('p') || 1);
  if (!/^BV[A-Za-z0-9]{10}$/.test(bvid) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Bilibili 视频或分 P 信息无效。');
  return { bvid, page, url: `https://www.bilibili.com/video/${bvid}/?p=${page}` };
}

function sameVideo(url, target) {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' && value.hostname === 'www.bilibili.com' &&
      value.pathname.replace(/\/$/, '') === `/video/${target.bvid}` && Number(value.searchParams.get('p') || 1) === target.page;
  } catch { return false; }
}

function clipRange(value = {}) {
  const startMs = Number(value.startMs ?? 0);
  const endMs = value.endMs == null ? null : Number(value.endMs);
  if (!Number.isFinite(startMs) || startMs < 0 || (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs))) throw new Error('视频播放区间无效。');
  return { startMs: Math.round(startMs), endMs: endMs === null ? null : Math.round(endMs) };
}

function clampVideoBounds(bounds, content) {
  const values = ['x', 'y', 'width', 'height'].map(key => Number(bounds?.[key] ?? 0));
  if (values.some(value => !Number.isFinite(value))) throw new Error('视频区域尺寸无效。');
  const limitWidth = Math.max(0, Math.floor(Number(content.width) || 0));
  const limitHeight = Math.max(0, Math.floor(Number(content.height) || 0));
  const x = Math.max(0, Math.min(limitWidth, Math.round(values[0])));
  const y = Math.max(0, Math.min(limitHeight, Math.round(values[1])));
  return { x, y, width: Math.max(0, Math.min(limitWidth - x, Math.round(values[2]))), height: Math.max(0, Math.min(limitHeight - y, Math.round(values[3]))) };
}

async function inspectBilibiliSession(session) {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); timer.unref?.();
  try {
    const response = await session.fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include', redirect: 'error', headers: { Referer: 'https://www.bilibili.com/' }, signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Invalid account response');
    const data = JSON.parse(text);
    if (Number(data.code) === 0 && data.data?.isLogin === true) return { isLogin: true, verified: true, status: 'signed-in', checkedAt };
    if (Number(data.code) === -101 || data.data?.isLogin === false) return { isLogin: false, verified: true, status: 'signed-out', checkedAt };
    return { isLogin: null, verified: false, status: 'unknown', checkedAt };
  } catch { return { isLogin: null, verified: false, status: 'unavailable', checkedAt }; }
  finally { clearTimeout(timer); }
}

function playbackAccess(payload, source = 'official-playurl') {
  const data = payload?.data || payload?.result || payload || {};
  const flag = data.is_preview ?? data.isPreview;
  const trial = data.trial_info ?? data.trialInfo ?? data.video_trial;
  const isPreview = typeof flag === 'boolean' ? flag : flag === 1 ? true : flag === 0 ? false : trial ? true : null;
  return { isPreview, source, hasTrialInfo: Boolean(trial), durationMs: Number.isFinite(Number(data.timelength)) && Number(data.timelength) > 0 ? Number(data.timelength) : null };
}

// Installed before website scripts, rather than racing the website's autoplay.
function videoPageBootstrap(name) {
  if (window[name]?.version === 1) return;
  const bridge = {
    version: 1, generation: null, expected: null, canPlay: false, ready: false,
    range: { startMs: 0, endMs: null }, volume: 0.75, seekApplied: false,
    media: new Set(), watched: new WeakSet(), events: [], endSent: false,
  };
  window[name] = bridge;
  const emit = (type, extra = {}) => {
    bridge.events.push({ type, ...extra });
    if (bridge.events.length > 30) bridge.events.shift();
  };
  const matches = () => {
    if (!bridge.expected) return false;
    try {
      const url = new URL(location.href);
      return url.hostname === 'www.bilibili.com' && url.pathname.replace(/\/$/, '') === '/video/' + bridge.expected.bvid && Number(url.searchParams.get('p') || 1) === bridge.expected.page;
    } catch { return false; }
  };
  const originalPlay = HTMLMediaElement.prototype.play;
  const stopAll = () => { for (const media of bridge.media) media.pause(); };
  const finish = (media, event) => {
    if (!matches() || bridge.endSent) return;
    if (event) event.stopImmediatePropagation();
    bridge.canPlay = false;
    bridge.endSent = true;
    media.pause();
    emit('ended');
  };
  const watch = media => {
    if (!(media instanceof HTMLMediaElement)) return;
    try {media.playbackRate=bridge.rate||1;}catch{}
    bridge.media.add(media);
    if (bridge.watched.has(media)) return;
    bridge.watched.add(media);
    media.autoplay = false;
    if (!bridge.canPlay) { media.muted = true; media.pause(); }
    media.addEventListener('play', event => {
      if (!bridge.canPlay || !bridge.ready || !matches()) {
        event.stopImmediatePropagation(); media.muted = true; media.pause();
      }
    }, true);
    media.addEventListener('ended', event => { if (media === bridge.findMedia() && media.ended) finish(media, event); }, true);
    media.addEventListener('timeupdate', () => {
      if (media !== bridge.findMedia() || !matches()) return;
      if (bridge.range.endMs !== null && media.currentTime * 1000 >= bridge.range.endMs - 40) finish(media);
    }, true);
    media.addEventListener('error', () => {
      if (matches() && media === bridge.findMedia()) emit('error', { message: 'Bilibili 官方视频加载失败（媒体错误 ' + (media.error?.code || '?') + '）。' });
    }, true);
  };
  bridge.findMedia = () => {
    for (const item of document.querySelectorAll('video')) watch(item);
    const video = [...bridge.media].filter(item => item.tagName?.toLowerCase() === 'video');
    return video.find(item => item.readyState >= 1 && !item.paused) || video.find(item => item.readyState >= 1) || video.at(-1) || null;
  };
  HTMLMediaElement.prototype.play = function (...args) {
    watch(this);
    if (!bridge.canPlay || !bridge.ready || !matches()) { this.muted = true; this.pause(); return Promise.resolve(); }
    return originalPlay.apply(this, args);
  };
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (...args) {
    const item = createElement.apply(this, args);
    if (/^(video|audio)$/i.test(String(args[0]))) watch(item);
    return item;
  };
  const discover = () => { for (const item of document.querySelectorAll('video,audio')) watch(item); };
  new MutationObserver(discover).observe(document, { childList: true, subtree: true });
  discover();
  bridge.configure = config => {
    bridge.canPlay = false; bridge.ready = false; stopAll();
    bridge.generation = config.generation; bridge.expected = config.target;
    bridge.range = config.range; bridge.volume = config.volume;
    bridge.seekApplied = false; bridge.endSent = false; bridge.events.length = 0;
    for (const media of bridge.media) media.muted = true;
    return true;
  };
  bridge.prepare = () => {
    if (!matches()) return { ready: false };
    const media = bridge.findMedia();
    if (!media || media.readyState < 1 || !Number.isFinite(media.duration) || media.duration <= 0) return { ready: false };
    media.pause(); media.muted = true;
    const target = Math.min(bridge.range.startMs / 1000, Math.max(0, media.duration - 0.05));
    if (bridge.range.startMs >= media.duration * 1000) throw new Error('视频播放区间起点超过视频时长。');
    if (!bridge.seekApplied || Math.abs(media.currentTime - target) > 0.25) {
      bridge.seekApplied = true;
      if (Math.abs(media.currentTime - target) > 0.05) media.currentTime = target;
    }
    bridge.ready = !media.seeking && Math.abs(media.currentTime - target) <= 0.25;
    return { ready: bridge.ready, positionMs: media.currentTime * 1000, durationMs: media.duration * 1000, videoWidth: media.videoWidth || 0 };
  };
  bridge.command = async (command, value) => {
    const media = bridge.findMedia();
    if (command === 'disarm') {
      bridge.canPlay = false; bridge.ready = false; stopAll();
      for (const item of bridge.media) item.muted = true;
      return true;
    }
    if (command === 'pause') { stopAll(); return true; }
    if (command === 'volume') {
      bridge.volume = value;
      for (const item of bridge.media) { item.volume = value; if (bridge.canPlay) item.muted = value === 0; }
      return true;
    }
    if (command === 'rate') {
      bridge.rate = Math.max(0.5, Math.min(2, Number(value) || 1));
      for (const item of bridge.media) { try { item.playbackRate = bridge.rate; } catch {} }
      if (media) { try { media.playbackRate = bridge.rate; } catch {} }
      return true;
    }
    if (command === 'range') { bridge.range = value; bridge.endSent = false; return true; }
    if (!media || !matches()) throw new Error('官方视频尚未准备好或已切换到其他视频。');
    if (command === 'play') {
      if (!bridge.ready) throw new Error('视频元数据或起始进度尚未准备好。');
      bridge.canPlay = true; bridge.endSent = false;
      if (media.ended || (bridge.range.endMs !== null && media.currentTime * 1000 >= bridge.range.endMs - 40)) media.currentTime = bridge.range.startMs / 1000;
      media.volume = bridge.volume; media.muted = bridge.volume === 0;
      await originalPlay.call(media);
      return true;
    }
    if (command === 'seek') {
      const lower = bridge.range.startMs;
      const upper = Math.min(bridge.range.endMs ?? Infinity, media.duration * 1000);
      const position = Math.max(lower, Math.min(value, Math.max(lower, upper - 30)));
      bridge.endSent = false;
      if (Math.abs(media.currentTime * 1000 - position) < 100 && !media.seeking) return true;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('视频定位超时。')); }, 10000);
        const done = () => { cleanup(); resolve(); };
        const cleanup = () => { clearTimeout(timer); media.removeEventListener('seeked', done); };
        media.addEventListener('seeked', done, { once: true });
        try { media.currentTime = position / 1000; } catch (error) { cleanup(); reject(error); }
      });
      return true;
    }
    throw new Error('未知的视频控制命令。');
  };
  bridge.snapshot = () => {
    const media = bridge.findMedia();
    const data = window.__playinfo__?.data || {};
    const flag = data.is_preview ?? data.isPreview;
    const prompts = [...document.querySelectorAll('.bpx-player-popup,.bpx-player-toast,.bpx-player-ending,.bpx-player-dialog,.bpx-player-login,[class*="trial"],[class*="preview"]')]
      .filter(node => typeof node.getClientRects === 'function' && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden')
      .map(node => String(node.innerText || node.textContent || '').trim()).filter(text => /试看|试播|登录.*(?:继续观看|观看完整|完整观看)|(?:观看|试看).{0,12}(?:30|三十)\s*秒/.test(text)).slice(0, 3).map(text => text.slice(0, 200));
    const access = prompts.length ? { isPreview: true, source: 'official-player-prompt', message: prompts.join(' / ') } :
      { isPreview: typeof flag === 'boolean' ? flag : flag === 1 ? true : flag === 0 ? false : null, source: 'official-page-playinfo', hasTrialInfo: Boolean(data.trial_info || data.trialInfo) };
    return {
      generation: bridge.generation, matches: matches(), ready: bridge.ready,
      media: Boolean(media), paused: media?.paused ?? true, ended: media?.ended ?? false,
      positionMs: media ? Math.max(0, media.currentTime * 1000 || 0) : 0,
      durationMs: media && Number.isFinite(media.duration) ? media.duration * 1000 : 0,
      videoWidth: media?.videoWidth || 0, muted: media?.muted ?? true,
      access,
      events: bridge.events.splice(0),
    };
  };
}

class VideoPlayer {
  constructor({ electron, sessionFor, getHostWindow, onEvent, onClosed }) {
    this.electron = electron; this.sessionFor = sessionFor; this.getHostWindow = getHostWindow;
    this.onEvent = onEvent || (() => {}); this.onClosed = onClosed;
    this.current = null; this.record = null; this.destroyed = false;
    this.volume = 0.75; this.ordinal = 0; this.polling = false;
    this.layout = { visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } };
    this.timer = setInterval(() => this._poll().catch(() => {}), 250); this.timer.unref?.();
  }

  _emit(request, type, extra = {}) {
    if (this.destroyed || this.current !== request) return;
    this.onEvent({ type, backend: 'video', generation: request.generation, key: request.track.key,
      auth: request.auth, preview: request.preview, ...extra });
  }

  setLayout(value = {}) {
    if (value.visible !== undefined && typeof value.visible !== 'boolean') throw new Error('视频区域可见状态无效。');
    if (value.bounds) {
      clampVideoBounds(value.bounds, { width: 100000, height: 100000 });
      this.layout.bounds = { ...value.bounds };
    }
    if (value.visible !== undefined) this.layout.visible = value.visible;
    return this._applyBounds();
  }

  _applyBounds() {
    const record = this.record;
    if (!record || record.disposed || record.host.isDestroyed() || record.webContents.isDestroyed()) return { visible: this.layout.visible, bounds: null };
    const bounds = clampVideoBounds(this.layout.bounds, record.host.getContentBounds());
    record.view.setBounds(bounds);
    const visible = this.layout.visible && bounds.width > 0 && bounds.height > 0;
    record.view.setVisible(visible);
    return { visible, bounds };
  }

  _notifyClosed(record) {
    const request = this.current;
    if (!request || request.record !== record || request.closedSent || this.destroyed) return;
    request.closedSent = true;
    try {
      this._emit(request, 'closed');
      this.onClosed?.({ backend: 'video', key: request.track.key, generation: request.generation });
    } finally { if (this.current === request) this.current = null; }
  }

  _dispose(record, notify = true) {
    if (!record || record.disposed) return;
    record.disposed = true;
    record.host.removeListener('resize', record.resizeListener);
    record.host.removeListener('closed', record.hostClosedListener);
    try { record.view.setVisible(false); } catch {}
    try { if (!record.host.isDestroyed()) record.host.contentView.removeChildView(record.view); } catch {}
    try { if (!record.webContents.isDestroyed()) record.webContents.setAudioMuted(true); } catch {}
    if (this.record === record) this.record = null;
    if (notify) this._notifyClosed(record);
    try { if (!record.webContents.isDestroyed()) record.webContents.close({ waitForBeforeUnload: false }); } catch {}
  }

  async _ensure() {
    if (this.record && !this.record.disposed && !this.record.webContents.isDestroyed()) {
      await this._installGuard(this.record); return this.record;
    }
    const host = this.getHostWindow?.();
    if (!host || host.isDestroyed() || !host.contentView) throw new Error('主播放器窗口尚未准备好，无法打开内嵌视频。');
    const session = this.sessionFor('bilibili');
    const view = new this.electron.WebContentsView({ webPreferences: {
      ...(typeof session === 'string' ? { partition: session } : { session }),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    } });
    const webContents = view.webContents;
    const record = { view, webContents, host, guardReady: false, disposed: false, accessRequests: new Map() };
    this.record = record;
    host.contentView.addChildView(view); view.setBackgroundColor('#000000');
    record.resizeListener = () => this._applyBounds();
    record.hostClosedListener = () => this._dispose(record, true);
    host.on('resize', record.resizeListener); host.once('closed', record.hostClosedListener);
    this._applyBounds(); webContents.setAudioMuted(this.volume === 0);
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect']) webContents.on(event, (e, url) => {
      if (!this.current || !sameVideo(url, this.current.target)) e.preventDefault();
    });
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame || !this.current || sameVideo(url, this.current.target)) return;
      const request = this.current;
      this._command('disarm').catch(() => {});
      this._emit(request, 'error', { message: '官网切换了视频或分 P，请通过MixTunes歌单选择播放内容。' });
    });
    webContents.on('context-menu', () => {
      const request = this.current;
      if (!request || !this.electron.Menu || !this.electron.shell) return;
      this.electron.Menu.buildFromTemplate([{ label: '在浏览器打开此视频', click: () => {
        if (sameVideo(request.target.url, request.target)) this.electron.shell.openExternal(request.target.url).catch(() => {});
      } }]).popup({ window: host });
    });
    webContents.on('destroyed', () => this._dispose(record, true));
    webContents.debugger.on('detach', () => {
      record.guardReady = false;
      if (this.current?.record === record && !webContents.isDestroyed()) this._command('disarm').catch(() => {});
    });
    webContents.debugger.on('message', (_event, method, params) => this._networkAccess(record, method, params));
    await webContents.loadURL('about:blank'); await this._installGuard(record);
    return record;
  }

  async _installGuard(record) {
    const debuggerApi = record.webContents.debugger;
    if (record.guardReady && debuggerApi.isAttached()) return;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    await debuggerApi.sendCommand('Page.enable');
    await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${videoPageBootstrap.toString()})(${JSON.stringify(BRIDGE)})` });
    await debuggerApi.sendCommand('Network.enable', { maxTotalBufferSize: 2 * 1024 * 1024, maxResourceBufferSize: 256 * 1024 });
    record.guardReady = true;
  }

  _networkAccess(record, method, params) {
    const request = this.current;
    if (!request || request.record !== record || record.disposed) return;
    if (method === 'Network.responseReceived') {
      try {
        const url = new URL(params.response.url);
        if (url.hostname === 'api.bilibili.com' && /\/(?:x\/player\/(?:wbi\/)?playurl|pgc\/player\/web\/playurl)$/.test(url.pathname)) {
          if (record.accessRequests.size > 30) record.accessRequests.clear();
          record.accessRequests.set(params.requestId, request);
        }
      } catch {}
    } else if (method === 'Network.loadingFailed') record.accessRequests.delete(params.requestId);
    else if (method === 'Network.loadingFinished' && record.accessRequests.has(params.requestId)) {
      const owner = record.accessRequests.get(params.requestId); record.accessRequests.delete(params.requestId);
      record.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then(result => {
        if (this.current !== owner || record.disposed) return;
        const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
        if (text.length <= 256 * 1024) this._updatePreview(owner, playbackAccess(JSON.parse(text)));
      }).catch(() => {});
    }
  }

  _updatePreview(request, next) {
    if (this.current !== request || !next) return;
    if (next.isPreview === null && request.preview?.isPreview !== null) return;
    if (next.isPreview === null && request.preview?.source === 'official-playurl' && next.source !== 'official-playurl') return;
    if (request.preview?.isPreview === true && next.isPreview === false) return;
    if (JSON.stringify(request.preview) === JSON.stringify(next)) return;
    request.preview = next; this._emit(request, 'access');
    if (next.isPreview && !request.previewNotice) {
      request.previewNotice = true;
      this._emit(request, 'notice', { message: 'Bilibili 官方播放器或接口提示当前内容为试看，请在官方平台确认登录和视频权限。' });
    }
  }

  getAccessState() {
    const request = this.current;
    return request ? { key: request.track.key, generation: request.generation, auth: { ...request.auth }, preview: { ...request.preview } } : null;
  }

  async _eval(request, expression) {
    if (this.destroyed || this.current !== request || !request.record || request.record.disposed || request.record.webContents.isDestroyed()) throw new Error('视频播放请求已失效。');
    if (!sameVideo(request.record.webContents.getURL(), request.target)) throw new Error('官方视频页面尚未准备好。');
    const value = await request.record.webContents.executeJavaScript(expression, false);
    if (this.destroyed || this.current !== request) throw new Error('视频播放请求已失效。');
    return value;
  }

  async _applyLayout(request) {
    const contents = request.record.webContents;
    if (request.record.layoutKey) {
      await contents.removeInsertedCSS(request.record.layoutKey).catch(() => {}); request.record.layoutKey = null;
    }
    const known = await this._eval(request, `!!document.querySelector('#bilibili-player .bpx-player-control-wrap')`);
    if (known) {
      request.record.layoutKey = await contents.insertCSS(PLAYER_ONLY_CSS);
      const valid = await this._eval(request, `(() => { const box = document.querySelector('#bilibili-player')?.getBoundingClientRect(); const video = document.querySelector('#bilibili-player video')?.getBoundingClientRect(); if(innerWidth<32||innerHeight<32)return !!box&&!!video; return !!box&&!!video&&Math.abs(box.x)<2&&Math.abs(box.y)<2&&box.width>=innerWidth-2&&box.height>=innerHeight-2&&video.width>innerWidth*.7&&video.height>innerHeight*.4; })()`);
      if (valid) return 'official-player';
      await contents.removeInsertedCSS(request.record.layoutKey).catch(() => {}); request.record.layoutKey = null;
    }
    this._emit(request, 'notice', { message: 'Bilibili 官网布局已变化，视频栏暂时保留完整官方页面。' });
    return 'official-page';
  }

  async load(track, generation, range = {}) {
    const target = videoTarget(track); const clip = clipRange(range); const ordinal = ++this.ordinal;
    if (this.current) this.current.startPending = false;
    await this._command('disarm').catch(() => {});
    if (ordinal !== this.ordinal || this.destroyed) throw new Error('视频加载已被新的请求取代。');
    const request = { track, generation, target, range: clip, lastPosition: null, playingSent: false, errorSent: false,
      auth: { isLogin: null, verified: false, status: 'checking' }, preview: { isPreview: null, source: 'unknown' } };
    this.current = request;
    try {
      request.record = await this._ensure();
      request.auth = await inspectBilibiliSession(request.record.webContents.session);
      if (this.current !== request) throw new Error('视频播放请求已失效。');
      const record = request.record;
      const authChanged = record.authLogin !== undefined && record.authLogin !== request.auth.isLogin;
      if (!sameVideo(record.webContents.getURL(), target) || authChanged) await record.webContents.loadURL(target.url);
      record.authLogin = request.auth.isLogin;
      if (this.current !== request) throw new Error('视频播放请求已失效。');
      const config = { generation, target, range: clip, volume: this.volume };
      await this._eval(request, `(() => { const bridge = window[${JSON.stringify(BRIDGE)}]; if (!bridge) throw new Error('视频自动播放保护未安装。'); return bridge.configure(${JSON.stringify(config)}); })()`);
      const deadline = Date.now() + 30000; let state;
      while (Date.now() < deadline) {
        state = await this._eval(request, `window[${JSON.stringify(BRIDGE)}].prepare()`);
        if (state.ready) break;
        await wait(150);
      }
      if (!state?.ready) throw new Error('30 秒内未取得官方视频元数据，请检查网络、登录或官网提示。');
      const layout = await this._applyLayout(request); request.prepared = true; this._applyBounds();
      const snapshot = await this._eval(request, `window[${JSON.stringify(BRIDGE)}].snapshot()`);
      if (snapshot?.access) this._updatePreview(request, snapshot.access);
      if (request.auth.isLogin === false) this._emit(request, 'notice', { message: 'MixTunes内的 Bilibili 官方会话尚未登录，请先使用账号区的官方登录；网站可能限制未登录观看时长。' });
      else if (request.auth.isLogin !== true) this._emit(request, 'notice', { message: '暂时无法向 Bilibili 验证登录状态，请检查网络后重试；这不代表账号已退出。' });
      this._emit(request, 'ready', { positionMs: Math.round(state.positionMs), durationMs: Math.round(state.durationMs) });
      return { ...state, layout, auth: request.auth, preview: request.preview };
    } catch (error) { this._emit(request, 'error', { message: error.message, code: error.code }); throw error; }
  }

  async _command(command, value, expectedGeneration) {
    const request = this.current;
    if (!request?.record || (expectedGeneration !== undefined && expectedGeneration !== request.generation)) throw new Error('视频播放请求已失效。');
    return this._eval(request, `(() => { const bridge = window[${JSON.stringify(BRIDGE)}]; if (!bridge || bridge.generation !== ${JSON.stringify(request.generation)}) throw new Error('视频播放请求已失效。'); return bridge.command(${JSON.stringify(command)}, ${JSON.stringify(value ?? null)}); })()`);
  }

  async play(generation) {
    const request = this.current;
    if (!request || (generation !== undefined && generation !== request.generation)) throw new Error('视频播放请求已失效。');
    if (request.auth?.isLogin !== true) {
      const error = new Error(request.auth?.isLogin === false ? '请先在MixTunes账号区完成 Bilibili 官方登录，再播放视频。' : '暂时无法验证 Bilibili 登录状态，请检查网络后重试。');
      error.code = request.auth?.isLogin === false ? 'LOGIN_REQUIRED' : 'AUTH_UNAVAILABLE'; throw error;
    }
    if (request.preview?.isPreview === true) { const error = new Error('Bilibili 官方返回试看限制，请在官方平台确认该视频的观看权限。'); error.code = 'PREVIEW_ONLY'; throw error; }
    request.startedAt = Date.now(); request.startPending = true; request.errorSent = false;
    return this._command('play', null, generation);
  }

  async pause() {
    if (!this.current?.record || this.current.record.disposed || this.current.record.webContents.isDestroyed()) return;
    this.current.startPending = false; return this._command('pause');
  }
  async seek(positionMs) {
    if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error('视频进度无效。');
    if (this.current) this.current.lastPosition = null;
    return this._command('seek', positionMs);
  }
  async setRange(range) {
    const value = clipRange(range);
    if (this.current) { this.current.range = value; return this._command('range', value); }
  }
  async setVolume(value) {
    if (!Number.isFinite(value)) throw new Error('音量无效。');
    this.volume = Math.max(0, Math.min(1, value));
    if (this.record && !this.record.disposed && !this.record.webContents.isDestroyed()) this.record.webContents.setAudioMuted(this.volume === 0);
    if (this.current?.record) return this._command('volume', this.volume);
  }

  async setRate(value) {
    const rate = Math.max(0.5, Math.min(2, Number(value) || 1));
    this.rate = rate;
    if (this.current?.record) return this._command('rate', rate).catch(() => {});
  }

  async _poll() {
    if (this.polling || this.destroyed || !this.current?.prepared) return;
    this.polling = true; const request = this.current;
    try {
      const state = await this._eval(request, `window[${JSON.stringify(BRIDGE)}]?.snapshot()`);
      if (!state || state.generation !== request.generation || !state.matches) return;
      if (state.access) this._updatePreview(request, state.access);
      for (const event of state.events || []) {
        if (event.type === 'ended') { request.startPending = false; request.playingSent = false; this._emit(request, 'ended'); return; }
        if (event.type === 'error' && !request.errorSent) { request.errorSent = true; request.startPending = false; this._emit(request, 'error', { message: event.message }); }
      }
      const extra = { positionMs: Math.round(state.positionMs), durationMs: Math.round(state.durationMs) };
      if (!state.paused && request.lastPosition !== null && state.positionMs > request.lastPosition + 30) {
        if (!request.playingSent) this._emit(request, 'playing', extra);
        request.playingSent = true; request.startPending = false;
      } else if (state.paused && request.playingSent && !state.ended) {
        request.playingSent = false; this._emit(request, 'paused', extra);
      }
      request.lastPosition = state.positionMs; this._emit(request, 'progress', extra);
      if (request.startPending && !request.errorSent && Date.now() - request.startedAt > 20000) {
        request.errorSent = true; request.startPending = false; await this.pause().catch(() => {});
        this._emit(request, 'error', { message: '20 秒内没有确认视频播放进度，请检查官方播放器提示。' });
      }
    } catch {} finally { this.polling = false; }
  }
  close() { ++this.ordinal; this._dispose(this.record, true); }
  destroy() { this.destroyed = true; ++this.ordinal; clearInterval(this.timer); this._dispose(this.record, false); this.current = null; }
}

module.exports = { VideoPlayer, videoTarget, sameVideo, clipRange, clampVideoBounds, inspectBilibiliSession, playbackAccess, videoPageBootstrap };
