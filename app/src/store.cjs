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
// Validate only the disk envelope. Keep the existing item normalisation and
// legacy defaults, including omitted fields and an empty legacy object.
function validateLibraryFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('歌单根节点必须是对象');
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error('不支持的歌单版本');
  for (const field of ['tracks', 'playlists', 'queue']) {
    if (data[field] !== undefined && !Array.isArray(data[field])) throw new Error(`歌单 ${field} 必须是数组`);
  }
  for (const playlist of data.playlists || []) {
    if (!playlist || typeof playlist !== 'object' || Array.isArray(playlist)) throw new Error('歌单条目必须是对象');
    if (playlist.queue !== undefined && !Array.isArray(playlist.queue)) throw new Error('歌单条目的 queue 必须是数组');
  }
}
class LibraryStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'library.json'); this.loadError = null; }
  load() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      validateLibraryFile(data);
    }
    catch (error) {
      if (error.code === 'ENOENT' && !this.loadError) return normaliseLibrary({});
      this.loadError = new Error('歌单读取失败，已保留原文件并禁止保存。请备份 library.json 后检查文件内容或访问权限。', { cause: error });
      throw this.loadError;
    }
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
    return normaliseLibrary(data);
  }
  save(data) {
    if (this.loadError) throw this.loadError;
    fs.mkdirSync(this.directory, { recursive: true });
    const safe = normaliseLibrary(data);
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(safe, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }
}
module.exports = { LibraryStore, normaliseLibrary, safeTrack };
