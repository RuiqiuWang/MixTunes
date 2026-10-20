'use strict';

// Optional official-site playback. These are website internals, not supported SDKs.
// Remote windows receive no preload, Node.js or local IPC bridge. All commands
// below run in the website's main world, and state is read back by the main process.
const HOME = {
  qq: 'https://y.qq.com/portal/player.html',
  netease: 'https://music.163.com/',
};
const BRIDGE = '__mixlinkOfficialPlayerV1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function allowedNavigation(platform, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    const suffixes = platform === 'qq' ? ['qq.com'] : ['163.com', '126.net', 'qq.com', 'weibo.com'];
    return suffixes.some(suffix => host === suffix || host.endsWith('.' + suffix));
  } catch { return false; }
}

function qqSong(track) {
  const raw = track.extra?.qqRawSong;
  if (!raw || typeof raw !== 'object') {
    throw new Error('QQ 网页播放需要歌曲原始资料，请重新通过 QQ 歌曲或歌单链接导入。');
  }
  const song = JSON.parse(JSON.stringify(raw));
  song.songmid = song.songmid || song.mid || track.extra?.songmid || track.sourceId;
  song.songid = song.songid || song.id || track.extra?.songId;
  song.songname = song.songname || song.name || track.title;
  song.songtype = Number(song.songtype ?? song.type ?? 0);
  song.mtype = song.mtype || 'qqmusic';
  song.singer = song.singer || [];
  song.albumname = song.albumname || song.album?.name || track.album || '';
  song.albummid = song.albummid || song.album?.mid || '';
  song.interval = song.interval || Math.round((track.durationMs || 0) / 1000);
  song.action = song.action || {};
  song.pay = song.pay || {};
  if (!song.songid || !song.songmid) throw new Error('QQ 歌曲资料缺少 songid/songmid，不能安全定位歌曲。');
  return song;
}

function neteaseSong(track) {
  const raw = track.extra?.neteaseRawSong;
  if (!raw || typeof raw !== 'object') return null;
  const song = JSON.parse(JSON.stringify(raw));
  song.id = song.id || Number(track.sourceId);
  song.name = song.name || track.title;
  song.artists = song.artists || song.ar || [];
  song.album = song.album || song.al || {};
  song.duration = song.duration || song.dt || track.durationMs || 0;
  song.privilege = song.privilege || track.extra?.privilege;
  return song;
}

// This function is serialized into the remote page. Keep it self-contained.
function pageBootstrap(name) {
  if (window[name]?.version === 1) return true;
  const bridge = {
    version: 1, track: null, platform: '', expectedId: '', generation: 0,
    media: new Set(), mediaIds: new WeakMap(), watched: new WeakSet(), events: [],
    lastError: '', endSent: false, requestedPlay: false, qq: null, qqConfigured: false,
    volume: 0.75, range: { startMs: 0, endMs: null }, pendingSeek: null,
  };
  window[name] = bridge;
  const push = (type, data = {}) => {
    bridge.events.push({ type, ...data });
    if (bridge.events.length > 30) bridge.events.shift();
  };
  const qqInterface = () => {
    try { return window.require('js/common/module/webplayer.js').interFace; } catch { return null; }
  };
  const currentId = () => {
    try {
      if (bridge.platform === 'qq') {
        const info = qqInterface()?.getSongInfoObj?.();
        return String(info?.songmid || info?.mid || '');
      }
      const info = window.player?.getPlaying?.();
      if (info?.track?.id) return String(info.track.id);
      const anchor = document.querySelector('.m-playbar .words a.name[href*="song?id="]');
      return anchor ? new URL(anchor.href).searchParams.get('id') || '' : '';
    } catch { return ''; }
  };
  const matches = () => Boolean(bridge.expectedId && currentId() === bridge.expectedId);
  const watch = media => {
    if (!(media instanceof HTMLMediaElement)) return;
    media.volume = bridge.volume;
    try { media.playbackRate = Math.max(0.5, Math.min(2, Number(bridge.rate) || 1)); } catch {}
    bridge.media.add(media);
    if (bridge.watched.has(media)) return;
    bridge.watched.add(media);
    media.addEventListener('playing', () => {
      if (matches()) bridge.mediaIds.set(media, bridge.expectedId);
    }, true);
    media.addEventListener('timeupdate',()=>{
      if(!matches()||bridge.mediaIds.get(media)!==bridge.expectedId||!bridge.requestedPlay||bridge.endSent)return;
      if(bridge.range.endMs!==null&&media.currentTime*1000>=bridge.range.endMs){
        bridge.endSent=true;bridge.requestedPlay=false;media.pause();push('ended');
      }
    },true);
    media.addEventListener('error', () => {
      if (matches() && bridge.mediaIds.get(media) === bridge.expectedId) {
        push('error', { message: '官方网页音频加载失败（媒体错误 ' + (media.error?.code || '?') + '）。' });
      }
    }, true);
    media.addEventListener('ended', event => {
      if (!matches() || bridge.mediaIds.get(media) !== bridge.expectedId || !media.ended) return;
      // Capture listeners precede the website's usual non-capture media listeners.
      // Prevent its private queue from advancing or looping before our queue does.
      event.stopImmediatePropagation();
      media.pause();
      if (bridge.endSent) return;
      bridge.endSent = true;
      bridge.requestedPlay = false;
      const actual = Number(media.duration) * 1000;
      const expected = Number(bridge.track?.durationMs || 0);
      if (expected > 45000 && actual > 0 && actual < expected - Math.max(15000, expected * 0.15)) {
        push('error', { message: '网页播放的是试听或不完整音频，请检查登录、会员权限和网页可播放范围。' });
      } else push('ended');
    }, true);
  };
  bridge.watch = watch;
  bridge.currentId = currentId;
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function (...args) {
    watch(this);
    if (matches()) bridge.mediaIds.set(this, bridge.expectedId);
    if(bridge.track){
      if(!bridge.requestedPlay){this.pause();return;}
      const generation=bridge.generation;
      await bridge.positionMedia(this);
      if(!bridge.requestedPlay||generation!==bridge.generation){this.pause();return;}
    }
    return originalPlay.apply(this, args);
  };
  for (const media of document.querySelectorAll('audio,video')) watch(media);
  const originalCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (...args) {
    const element = originalCreate.apply(this, args);
    if (/^(audio|video)$/i.test(String(args[0]))) watch(element);
    return element;
  };
  bridge.findMedia = () => {
    for (const media of document.querySelectorAll('audio,video')) watch(media);
    if (!matches()) return null;
    const candidates = [...bridge.media].filter(media => bridge.mediaIds.get(media) === bridge.expectedId);
    return candidates.find(media => !media.paused && !media.ended) || candidates.at(-1) || null;
  };
  bridge.positionMedia=async media=>{
    const generation=bridge.generation;
    const deadline=Date.now()+12000;
    while((media.readyState<1||!Number.isFinite(media.duration))&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,25));
      if(generation!==bridge.generation||!bridge.requestedPlay)return;
    }
    if(!Number.isFinite(media.duration))throw new Error('网页音频未能加载时长，无法应用播放范围。');
    let start=bridge.range.startMs;
    if(start>=media.duration*1000){bridge.range={startMs:0,endMs:null};bridge.pendingSeek=0;start=0;push('range-reset');}
    const end=Math.min(bridge.range.endMs??Infinity,media.duration*1000);
    let target=bridge.pendingSeek;
    if(target===null)target=media.ended||media.currentTime*1000<start||media.currentTime*1000>=end?start:media.currentTime*1000;
    target=Math.max(start,Math.min(end,target));bridge.pendingSeek=null;
    if(Math.abs(media.currentTime*1000-target)>50)media.currentTime=target/1000;
    while(media.seeking&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,20));
      if(generation!==bridge.generation||!bridge.requestedPlay)return;
    }
    if(media.seeking||Math.abs(media.currentTime*1000-target)>150)throw new Error('网页音频无法定位到指定播放起点。');
  };
  bridge.configure = config => {
    bridge.track = config.track;
    bridge.platform = config.track.platform;
    bridge.expectedId = String(config.expectedId);
    bridge.generation = config.generation;
    bridge.events.length = 0;
    bridge.endSent = false;
    bridge.lastError = '';
    bridge.requestedPlay = false;
    bridge.range={startMs:Math.max(0,Number(config.range?.startMs)||0),endMs:Number.isFinite(config.range?.endMs)?config.range.endMs:null};
    bridge.pendingSeek=bridge.range.startMs;
    bridge.qqConfigured = false;
    bridge.mediaIds = new WeakMap();
    for (const media of bridge.media) media.pause();
    if (bridge.platform === 'qq') {
      const api = qqInterface();
      if (!api?.setPlayerList || !api?.playAnyPos) throw new Error('QQ 官网播放器接口暂未加载或已变更。');
      bridge.qq = api;
      api.pausePlayer();
      api.setPlayerList(false, [config.qqSong], 2);
      // OnSongPlayEnd is deliberately NOT used: official manual-next calls it too.
      if (!api.__mixlinkQueueGuard) {
        api.__mixlinkQueueGuard = true;
        api.autoNextPlayer = function () {
          const media = bridge.findMedia();
          if (media && !media.paused) media.pause();
          return false;
        };
        const setVolume = api.setVolumn;
        if (typeof setVolume === 'function') {
          api.setVolumn = function (value) {
            return setVolume.call(this, bridge.track ? Math.round(bridge.volume * 100) : value);
          };
        }
        const previousError = api.OnPlayError;
        api.OnPlayError = function (...args) {
          if (matches()) {
            push('error', { message: 'QQ 官方网页播放失败，请在官网窗口检查登录或歌曲权限。' });
            api.pausePlayer();
            return; // The website's error handler may advance its own queue.
          }
          if (typeof previousError === 'function') {
            try { previousError.apply(this, args); } catch { /* website rendering only */ }
          }
        };
      }
      bridge.qqConfigured = true;
    }
    return { prepared: true, capability: 'page', mediaBuffered: false };
  };
  bridge.command = async (command, value) => {
    if (command === 'play') {
      bridge.endSent = false;
      bridge.requestedPlay = true;
      const media = bridge.findMedia();
      if (media && matches()) {
        if (media.ended) media.currentTime = bridge.range.startMs/1000;
        await media.play();
        return true;
      }
      if (bridge.platform === 'qq') {
        if (!bridge.qqConfigured) throw new Error('QQ 歌曲尚未准备。');
        bridge.qq.playAnyPos(0);
        return true;
      }
      if (bridge.track.extra?.neteaseRawSong && typeof window.player?.addTo === 'function') {
        window.player.addTo([bridge.track.extra.neteaseRawSong], true, true);
        return true;
      }
      const documents = [document];
      for (const frame of document.querySelectorAll('iframe')) {
        try { if (frame.contentDocument) documents.push(frame.contentDocument); } catch { /* cross origin login */ }
      }
      for (const doc of documents) {
        const id = CSS.escape(bridge.expectedId);
        const button = doc.querySelector('[data-res-action="play"][data-res-id="' + id + '"]') ||
          doc.querySelector('[data-res-action="play"][data-res-type="18"]');
        if (button) { button.click(); return true; }
      }
      throw new Error('未找到网易歌曲播放按钮，官网可能要求登录、打开客户端，或页面结构已经变化。');
    }
    if (command === 'pause') {
      bridge.requestedPlay = false;
      for (const media of bridge.media) media.pause();
      if (bridge.platform === 'qq') bridge.qq?.pausePlayer?.();
      else window.player?.pause?.();
      return true;
    }
    const media = bridge.findMedia();
    if (command === 'volume') {
      bridge.volume = value;
      for (const item of bridge.media) item.volume = value;
      if (bridge.platform === 'qq') bridge.qq?.setVolumn?.(Math.round(value * 100));
      return true;
    }
    if (command === 'rate') {
      bridge.rate = Math.max(0.5, Math.min(2, Number(value) || 1));
      for (const item of bridge.media) { try { item.playbackRate = bridge.rate; } catch {} }
      if (media) { try { media.playbackRate = bridge.rate; } catch {} }
      return true;
    }
    if (command === 'seek') {
      bridge.endSent = false;
      const target=Math.max(bridge.range.startMs,Math.min(bridge.range.endMs??Infinity,value));
      bridge.pendingSeek=target;
      if(media&&Number.isFinite(media.duration)){media.currentTime=Math.min(target/1000,media.duration);bridge.pendingSeek=null;}
      return true;
    }
    if(command==='range'){
      bridge.range={startMs:Math.max(0,Number(value?.startMs)||0),endMs:Number.isFinite(value?.endMs)?value.endMs:null};
      bridge.endSent=false;
      return true;
    }
    throw new Error('未知网页播放命令。');
  };
  bridge.snapshot = () => {
    const id = currentId();
    const media = bridge.findMedia();
    return {
      generation: bridge.generation, id, matches: matches(), media: Boolean(media),
      paused: media ? media.paused : true, ended: media ? media.ended : false,
      positionMs: media ? Math.max(0, Number(media.currentTime) * 1000 || 0) : 0,
      durationMs: media && Number.isFinite(media.duration) ? media.duration * 1000 : 0,
      events: bridge.events.splice(0),
    };
  };
  return true;
}

class WebPlayer {
  constructor({ electron, sessionFor, onEvent, parentWindow }) {
    this.electron = electron;
    this.sessionFor = sessionFor;
    this.onEvent = onEvent || (() => {});
    this.parentWindow = parentWindow;
    this.windows = new Map();
    this.current = null;
    this.destroyed = false;
    this.volume = 0.75;
    this.loadOrdinal = 0;
    this.polling = false;
    this.timer = setInterval(() => this._poll().catch(() => {}), 350);
    this.timer.unref?.();
  }

  _preferences(platform) {
    const session = this.sessionFor(platform);
    return {
      ...(typeof session === 'string' ? { partition: session } : { session }),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, backgroundThrottling: false,
    };
  }

  async _ensure(platform) {
    if (!HOME[platform]) throw new Error('网页备用播放器仅支持 QQ 音乐和网易云。');
    let record = this.windows.get(platform);
    if (record && !record.window.isDestroyed()) return record;
    const window = new this.electron.BrowserWindow({
      width: 1180, height: 800, show: false, autoHideMenuBar: true,
      title: platform === 'qq' ? 'QQ 音乐 · 官方网页' : '网易云 · 官方网页',
      webPreferences: this._preferences(platform),
    });
    record = { window, platform, ready: null, authDirty: false };
    record.cookieListener = (_event, cookie) => {
      if (platform === 'netease' && cookie.name === 'MUSIC_U') record.authDirty = true;
    };
    window.webContents.session.cookies.on('changed', record.cookieListener);
    this.windows.set(platform, record);
    const guardNavigation = (event, target) => {
      if (!allowedNavigation(platform, target)) event.preventDefault();
    };
    window.webContents.on('will-navigate', guardNavigation);
    window.webContents.on('will-redirect', guardNavigation);
    window.webContents.setWindowOpenHandler(({ url }) => allowedNavigation(platform, url) ? {
      action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: this._preferences(platform) },
    } : { action: 'deny' });
    window.webContents.on('did-create-window', popup => {
      popup.webContents.on('will-navigate', guardNavigation);
      popup.webContents.on('will-redirect', guardNavigation);
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
    window.webContents.on('dom-ready', () => {
      const url = window.webContents.getURL();
      if (allowedNavigation(platform, url)) this._bootstrap(record).catch(() => {});
    });
    window.on('close', event => {
      if (!this.destroyed) { event.preventDefault(); window.hide(); }
    });
    record.ready = window.loadURL(HOME[platform]);
    await record.ready;
    return record;
  }

  async _bootstrap(record) {
    return record.window.webContents.executeJavaScript(`(${pageBootstrap.toString()})(${JSON.stringify(BRIDGE)})`, false);
  }

  async _eval(record, expression) {
    if (this.destroyed || record.window.isDestroyed()) throw new Error('官方网页窗口已关闭。');
    const url = new URL(record.window.webContents.getURL());
    if ((record.platform === 'qq' && url.hostname !== 'y.qq.com') ||
        (record.platform === 'netease' && url.hostname !== 'music.163.com')) {
      throw new Error('请先在官方网页完成登录，并返回音乐播放页。');
    }
    return record.window.webContents.executeJavaScript(expression, false);
  }

  _emit(request, type, data = {}) {
    if (this.destroyed || this.current !== request) return;
    this.onEvent({ type, generation: request.generation, key: request.track.key, ...data });
  }

  async load(track, generation, range={startMs:0,endMs:null}) {
    const ordinal = ++this.loadOrdinal;
    await this.pause().catch(() => {});
    if (this.loadOrdinal !== ordinal || this.destroyed) throw new Error('网页加载已被新的播放请求取代。');
    const request = { track, generation, lastPosition: null, playingSent: false, pausedSent: false, started: false, errorSent: false };
    this.current = request;
    try {
      const record = await this._ensure(track.platform);
      request.record = record;
      if (this.current !== request) throw new Error('网页加载已被新的播放请求取代。');
      if (track.platform === 'netease') {
        if (record.authDirty) {
          // Refresh the website's in-memory GUser after a separate login window
          // changed its session. A new query forces a genuine document load.
          await record.window.loadURL(`${HOME.netease}?mixlink_refresh=${Date.now()}`);
          record.authDirty = false;
        }
        // Electron loadURL may reject same-document hash navigation with
        // ERR_FAILED even though the website handled it. Keep the outer player.
        await this._eval(record, `(() => { location.hash = ${JSON.stringify('/song?id=' + encodeURIComponent(track.sourceId))}; return true; })()`);
      }
      await this._bootstrap(record);
      const preparedTrack = JSON.parse(JSON.stringify(track));
      if (track.platform === 'netease') {
        const raw = neteaseSong(track);
        if (raw) preparedTrack.extra = { ...preparedTrack.extra, neteaseRawSong: raw };
      }
      const config = {
        track: preparedTrack, generation, range,
        expectedId: String(track.platform === 'qq' ? (track.extra?.songmid || track.sourceId) : track.sourceId),
        ...(track.platform === 'qq' ? { qqSong: qqSong(track) } : {}),
      };
      const deadline = Date.now() + 15000;
      let result;
      while (Date.now() < deadline) {
        if (this.current !== request) throw new Error('网页加载已被新的播放请求取代。');
        try {
          result = await this._eval(record, `window[${JSON.stringify(BRIDGE)}].configure(${JSON.stringify(config)})`);
          break;
        } catch (error) {
          if (Date.now() + 500 >= deadline) throw error;
          await delay(500);
        }
      }
      if (!result?.prepared) throw new Error('官方网页播放器未能准备指定歌曲。');
      await this.setVolume(this.volume);
      this._emit(request, 'ready', { message: '官网页面已准备；音频缓冲与会员播放能力需开始播放后确认。' });
      return result;
    } catch (error) {
      this._emit(request, 'error', { message: error.message });
      throw error;
    }
  }

  async _command(command, value, expectedGeneration) {
    const request = this.current;
    if (!request?.record) throw new Error('尚未加载网页歌曲。');
    if (expectedGeneration !== undefined && request.generation !== expectedGeneration) throw new Error('网页播放请求已失效。');
    if (this.current !== request || this.destroyed) throw new Error('网页播放请求已失效。');
    const result = await this._eval(request.record, `(() => { const bridge = window[${JSON.stringify(BRIDGE)}]; if (!bridge || bridge.generation !== ${JSON.stringify(request.generation)}) throw new Error('网页播放请求已失效。'); return bridge.command(${JSON.stringify(command)}, ${JSON.stringify(value ?? null)}); })()`);
    if (this.current !== request || this.destroyed) throw new Error('网页播放请求已失效。');
    return result;
  }

  async play(expectedGeneration) {
    const request = this.current;
    if (!request) throw new Error('尚未加载网页歌曲。');
    if (expectedGeneration !== undefined && request.generation !== expectedGeneration) throw new Error('网页播放请求已失效。');
    request.started = true;
    request.startedAt = Date.now();
    request.errorSent = false;
    request.pausedSent = false;
    try { return await this._command('play', null, expectedGeneration); }
    catch (error) { this._emit(request, 'error', { message: error.message }); throw error; }
  }

  async pause(expectedGeneration) {
    if (!this.current?.record) return;
    if (expectedGeneration !== undefined && this.current.generation !== expectedGeneration) throw new Error('网页播放请求已失效。');
    this.current.started = false;
    return this._command('pause', null, expectedGeneration);
  }

  async seek(positionMs) {
    if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error('无效的播放进度。');
    if (this.current) { this.current.playingSent = false; this.current.lastPosition = null; }
    return this._command('seek', positionMs);
  }
  async setRange(range){return this._command('range',range);}

  async setVolume(value) {
    if (!Number.isFinite(value)) throw new Error('无效的音量。');
    this.volume = Math.max(0, Math.min(1, value));
    if (this.current?.record) return this._command('volume', this.volume);
  }

  async setRate(value) {
    const rate = Math.max(0.5, Math.min(2, Number(value) || 1));
    this.rate = rate;
    if (this.current?.record) return this._command('rate', rate).catch(() => {});
  }

  async show(platform) {
    const record = await this._ensure(platform);
    record.window.show();
    record.window.focus();
  }

  async _poll() {
    if (this.polling || this.destroyed || !this.current?.record) return;
    this.polling = true;
    const request = this.current;
    try {
      const state = await this._eval(request.record, `window[${JSON.stringify(BRIDGE)}]?.snapshot()`);
      if (this.current !== request || !state || state.generation !== request.generation) return;
      for (const event of state.events || []) {
        if (event.type === 'ended') { request.started = false; this._emit(request, 'ended'); }
        else if (event.type === 'error' && !request.errorSent) {
          request.errorSent = true; request.started = false;
          this._emit(request, 'error', { message: event.message });
        }
        else if(event.type==='range-reset')this._emit(request,'metadata',{durationMs:Math.round(state.durationMs),positionMs:Math.round(state.positionMs),rangeReset:true});
      }
      if (state.matches && state.media) {
        const positionMs = Math.round(state.positionMs);
        const durationMs = Math.round(state.durationMs);
        if (request.started && !state.paused && request.lastPosition !== null && positionMs > request.lastPosition + 40) {
          if (!request.playingSent) this._emit(request, 'playing', { positionMs, durationMs });
          request.playingSent = true; request.pausedSent = false;
        }
        if (state.paused && request.playingSent && !state.ended && !request.pausedSent) {
          this._emit(request, 'paused', { positionMs, durationMs });
          request.pausedSent = true; request.playingSent = false;
        }
        request.lastPosition = positionMs;
        this._emit(request, 'progress', { positionMs, durationMs });
      }
      if (request.started && !request.playingSent && !request.errorSent && Date.now() - request.startedAt > 20000) {
        request.errorSent = true; request.started = false;
        await this._command('pause').catch(() => {});
        this._emit(request, 'error', { message: '20 秒内未确认指定歌曲的播放进度。请打开官方网页检查登录、自动播放提示、会员权限或官网适配状态。' });
      }
    } catch { /* navigation may briefly destroy the JavaScript context */ }
    finally { this.polling = false; }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.current = null;
    for (const record of this.windows.values()) if (!record.window.isDestroyed()) {
      record.window.webContents.session.cookies.removeListener('changed', record.cookieListener);
      record.window.destroy();
    }
    this.windows.clear();
  }
}

module.exports = { WebPlayer, allowedNavigation, qqSong, neteaseSong, pageBootstrap };
