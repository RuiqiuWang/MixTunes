'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { MODES } = require('./queue.cjs');
const { normaliseQualitySettings } = require('./quality.cjs');
const { normalisePlayRange } = require('./play-range.cjs');
const PLATFORMS = new Set(['qq','netease','bilibili']);

function restoredCoverUrl(track) {
  if(track.platform!=='bilibili'||typeof track.coverUrl!=='string')return track.coverUrl;
  try{
    const url=new URL(track.coverUrl.startsWith('//')?'https:'+track.coverUrl:track.coverUrl);
    if(['http:','https:'].includes(url.protocol)&&/(^|\.)hdslb\.com$/.test(url.hostname)&&!url.username&&!url.password&&(!url.port||url.port==='80'||url.port==='443')){
      url.protocol='https:';url.port='';return url.href;
    }
  }catch{}
  return '';
}

function safeTrack(t) {
  if (!t || !PLATFORMS.has(t.platform) || typeof t.sourceId !== 'string' || !t.sourceId || t.sourceId.length > 100) return null;
  let u;
  try { u = new URL(t.url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname;
  const allowed = t.platform === 'qq' ? /(^|\.)y\.qq\.com$/.test(host)
    : t.platform === 'netease' ? host === 'music.163.com'
      : /(^|\.)bilibili\.com$/.test(host);
  if (!allowed) return null;
  const key = `${t.platform}:${t.sourceId}${t.platform === 'bilibili' && t.extra?.cid ? ':' + String(t.extra.cid) : ''}`;
  // Keep provider-generated keys, but bound them and never use them as filenames.
  const result = { ...t, key: typeof t.key === 'string' && t.key.length < 200 ? t.key : key,
    coverUrl: restoredCoverUrl(t),
    title: String(t.title || t.sourceId).slice(0, 500), artist: String(t.artist || '').slice(0, 300),
    playRange: normalisePlayRange(t.playRange, t.durationMs),
    durationMs: Number.isFinite(t.durationMs) && t.durationMs > 0 ? t.durationMs : undefined };
  if(typeof t.displayTitle==='string'&&t.displayTitle.trim()&&t.displayTitle.trim().length<=500&&t.displayTitle.trim()!==result.title)result.displayTitle=t.displayTitle.trim();
  else delete result.displayTitle;
  return result;
}
function normaliseLibrary(data) {
  const seen = new Set();
  const tracks = [];
  for (const candidate of Array.isArray(data?.tracks) ? data.tracks.slice(0, 20000) : []) {
    const track = safeTrack(candidate);
    if (track && !seen.has(track.key)) { seen.add(track.key); tracks.push(track); }
  }
  const byKey = new Set(tracks.map(t => t.key));
  const cleanQueue = keys => [...new Set(Array.isArray(keys) ? keys.filter(k => byKey.has(k)) : [])];
  const cleanMode = mode => MODES.has(mode) ? mode : 'sequential';
  const playlists = [];
  if (data?.schemaVersion === 2 || Array.isArray(data?.playlists)) {
    const ids = new Set();
    for (const [index, candidate] of (Array.isArray(data?.playlists) ? data.playlists.slice(0, 500) : []).entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const proposed = typeof candidate.id === 'string' && candidate.id.trim() && candidate.id.length <= 100
        ? candidate.id : `playlist-${index + 1}`;
      let id = proposed;
      for (let suffix = 2; ids.has(id); suffix++) id = `${proposed.slice(0, 90)}-${suffix}`;
      ids.add(id);
      const queue = cleanQueue(candidate.queue);
      playlists.push({ id, name: String(candidate.name || '我的歌单').trim().slice(0, 100) || '我的歌单', queue,
        mode: cleanMode(candidate.mode), currentKey: queue.includes(candidate.currentKey) ? candidate.currentKey : null });
    }
  } else {
    // The old library was a single playlist; retain its queue, including legacy
    // catalog entries that were not explicitly present in that queue.
    const queue = cleanQueue(data?.queue);
    const queued = new Set(queue);
    for (const track of tracks) if (!queued.has(track.key)) { queued.add(track.key); queue.push(track.key); }
    playlists.push({ id: 'default', name: '我的歌单', queue, mode: cleanMode(data?.mode),
      currentKey: queue.includes(data?.currentKey) ? data.currentKey : null });
  }
  if (!playlists.length) playlists.push({ id: 'default', name: '我的歌单', queue: [], mode: 'sequential', currentKey: null });
  const active = playlists.find(p => p.id === data?.activePlaylistId) || playlists[0];
  return { schemaVersion: 2, tracks, playlists, activePlaylistId: active.id,
    queue: [...active.queue], mode: active.mode, currentKey: active.currentKey,
    qualitySettings: normaliseQualitySettings(data?.qualitySettings),
    volume: Number.isFinite(data?.volume) ? Math.max(0, Math.min(1, data.volume)) : .7,
    muted: !!data?.muted };
}
class LibraryStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'library.json');
    this.backup = path.join(directory, 'library.backup.json');
    this.notice = null;
  }
  static parse(text) { try { const data = JSON.parse(text); return data && typeof data === 'object' ? data : null; } catch { return null; } }
  static hasContent(data) { return Boolean(data) && (Array.isArray(data.tracks) || Array.isArray(data.playlists) || data.schemaVersion === 1); }
  atomicWrite(file, text) {
    const temp = file + '.tmp';
    const handle = fs.openSync(temp, 'w');
    try { fs.writeFileSync(handle, text, 'utf8'); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    fs.renameSync(temp, file);
  }
  writeBackup(text) {
    try { fs.mkdirSync(this.directory, { recursive: true }); this.atomicWrite(this.backup, text); }
    catch { /* a failed backup must never break the real save */ }
  }
  readBackup() {
    try {
      const data = LibraryStore.parse(fs.readFileSync(this.backup, 'utf8'));
      if (!LibraryStore.hasContent(data)) return null;
      const library = normaliseLibrary(data);
      if (!library.tracks.length && !library.playlists.some((playlist) => playlist.queue.length)) return null;
      return library;
    } catch { return null; }
  }
  // Keep the damaged file, then try the automatic backup. Starting from an
  // empty library without either step would let the next save erase everything.
  recover(text, reason, error) {
    let broken = '';
    if (typeof text === 'string') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      broken = path.join(this.directory, `library.corrupt-${stamp}.json`);
      try { fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(broken, text, 'utf8'); }
      catch { broken = ''; }
    }
    const restored = this.readBackup();
    if (restored) {
      try { this.atomicWrite(this.file, JSON.stringify(restored, null, 2)); } catch {}
      this.notice = { type: 'restored', broken, backup: this.backup };
      return normaliseLibrary(restored);
    }
    this.notice = { type: reason === 'unreadable' ? 'unreadable' : 'corrupt', broken, message: error?.message || '' };
    return normaliseLibrary({});
  }
  load() {
    this.notice = null;
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); }
    catch (error) {
      // A missing file is a normal first run; anything else is damaged data.
      if (error.code === 'ENOENT') return normaliseLibrary({});
      return this.recover(null, 'unreadable', error);
    }
    const data = LibraryStore.parse(text);
    if (!LibraryStore.hasContent(data)) return this.recover(text, 'corrupt');
    if (data?.schemaVersion !== 2 && !Array.isArray(data?.playlists)) {
      try { fs.copyFileSync(this.file, path.join(this.directory, 'library-v1-before-migration.json'), fs.constants.COPYFILE_EXCL); }
      catch (error) {
        let existingBackup = false;
        if (error.code === 'EEXIST') {
          try { existingBackup = fs.lstatSync(path.join(this.directory, 'library-v1-before-migration.json')).isFile(); } catch {}
        }
        if (!existingBackup) throw new Error(`旧版歌单备份失败，已保留原文件：${error.message}`, { cause: error });
      }
    }
    const library = normaliseLibrary(data);
    if (Array.isArray(data.tracks) && data.tracks.length > 20000 || Array.isArray(data.playlists) && data.playlists.length > 500) {
      this.notice = { type: 'truncated' };
    }
    this.writeBackup(JSON.stringify(library, null, 2));
    return library;
  }
  save(data) {
    fs.mkdirSync(this.directory, { recursive: true });
    const text = JSON.stringify(normaliseLibrary(data), null, 2);
    this.atomicWrite(this.file, text);
    this.writeBackup(text);
  }
}
module.exports = { LibraryStore, normaliseLibrary, safeTrack };
