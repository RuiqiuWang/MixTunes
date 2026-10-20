'use strict';

// Desktop-only helper: put a track's audio stream on disk so it can be dragged
// out of the window onto the desktop or into an Explorer folder, and so the
// "另存为" dialog has a real file to copy. Everything lands in one cache
// directory under userData and is reused across sessions.
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');

// Windows forbids these in file names, and a trailing dot/space is stripped by
// the shell, so both must go before the name is used.
const ILLEGAL_NAME = /[<>:"\/\\|?*\u0000-\u001f]/g;
const CODEC_EXTENSION = { flac: 'flac', mp3: 'mp3', m4a: 'm4a', aac: 'm4a', ogg: 'ogg', opus: 'ogg', wav: 'wav' };
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('已取消下载');
  error.name = 'AbortError';
  return error;
}

function sanitizeFileName(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(ILLEGAL_NAME, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!cleaned) return fallback;
  return cleaned.length > 110 ? cleaned.slice(0, 110).trim() : cleaned;
}

function baseFileName(track) {
  const artist = sanitizeFileName(track?.artist, '未知作者');
  const title = sanitizeFileName(track?.displayTitle || track?.title, '未命名');
  return `${artist} - ${title}`;
}

function extensionFor(resolved) {
  const codec = String(resolved?.codec || '').toLowerCase();
  if (CODEC_EXTENSION[codec]) return CODEC_EXTENSION[codec];
  try {
    const match = new URL(resolved.url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match && new Set(['flac','mp3','m4a','aac','ogg','opus','wav']).has(match[1].toLowerCase())) return match[1].toLowerCase();
  } catch {}
  return 'mp3';
}

class TrackExporter {
  constructor({ resolveTrack, fetchMedia, contextFor, directory, maxBytes = DEFAULT_MAX_BYTES, indexName = 'index.json', autoPrune = true, onProgress = null }) {
    this.resolveTrack = resolveTrack;
    this.fetchMedia = fetchMedia;
    this.contextFor = contextFor;
    this.directory = directory;
    this.maxBytes = maxBytes;
    // The drag cache keeps index.json and is pruned; the user-visible download
    // folder keeps its own index and never evicts what the user asked to keep.
    this.autoPrune = autoPrune;
    this.indexPath = path.join(directory, indexName);
    this.index = null;
    this.inflight = new Map();
    this.aborts = new Map();
    this.claimed = new Set();
    this.onProgress = typeof onProgress === 'function' ? onProgress : null;
    this.lastProgressAt = 0;
  }

  // Byte-level progress for the download badge; throttled so a fast stream does
  // not flood the renderer with messages.
  reportProgress(track, received, total) {
    if (!this.onProgress) return;
    const now = Date.now();
    if (now - this.lastProgressAt < 100) return;
    this.lastProgressAt = now;
    try { this.onProgress({ key: track?.key, received, total: Number(total) || 0 }); } catch {}
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true });
    return this.directory;
  }

  loadIndex() {
    if (this.index) return this.index;
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch {}
    const files = Object.create(null);
    if(parsed?.files && typeof parsed.files==='object' && !Array.isArray(parsed.files)) for(const [key,value] of Object.entries(parsed.files))files[key]=value;
    this.index = { files };
    return this.index;
  }

  saveIndex() {
    try {
      this.ensureDirectory();
      const temporary = `${this.indexPath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.index ?? { files: {} }), 'utf8');
      fs.renameSync(temporary, this.indexPath);
    } catch {}
  }

  recordedFile(key) {
    if (!key) return null;
    const entry = this.loadIndex().files[key];
    if (!entry || typeof entry.file !== 'string' || !entry.file) return null;
    return this.indexedPath(entry);
  }

  indexedPath(entry) {
    if(!entry || typeof entry.file!=='string' || !entry.file || entry.file!==path.basename(entry.file) || /[\\/]/.test(entry.file))return null;
    const full=path.resolve(this.directory,entry.file);
    if(path.dirname(full)!==path.resolve(this.directory))return null;
    try {const stat=fs.lstatSync(full);return stat.isFile() && !stat.isSymbolicLink() && stat.size>0 ? full:null;}catch{return null;}
  }

  // Returns an absolute path only when the file is already downloaded.
  cachedPath(track) {
    return this.recordedFile(track?.key);
  }

  claimFileName(track, extension) {
    const index = this.loadIndex();
    const base = baseFileName(track);
    const taken = new Set(Object.entries(index.files)
      .filter(([key]) => key !== track.key)
      .map(([, entry]) => String(entry.file).toLowerCase()));
    let candidate = `${base}.${extension}`;
    for (let suffix = 2; taken.has(candidate.toLowerCase()) || this.claimed.has(candidate.toLowerCase()) || fs.existsSync(path.join(this.directory,candidate)); suffix++) candidate = `${base} (${suffix}).${extension}`;
    this.claimed.add(candidate.toLowerCase());
    return candidate;
  }

  async streamToFile(url, track, headers, destination, signal) {
    if (!url) throw new Error('这首歌暂时没有可用的音频地址');
    const response = await this.fetchMedia(url, track.platform, this.contextFor(track.platform), { headers: { ...(headers || {}) }, signal });
    if (!response?.body) throw new Error('下载失败，请稍后再试');
    if (!response.ok && response.status !== 206) throw new Error(Number(response.status) === 404 ? '音频地址已失效，请重新播放一次再试' : `下载失败（HTTP ${response.status}）`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > this.maxBytes) {await response.body.cancel().catch(()=>{});throw new Error('音频文件过大，已放弃导出');}
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      let received = 0;
      const counter = new Transform({
        transform: (chunk, encoding, callback) => {
          if (signal?.aborted) { callback(abortError(signal)); return; }
          received += chunk.length;
          if(received>this.maxBytes){callback(new Error('音频文件过大，已放弃导出'));return;}
          this.reportProgress(track, received, declared);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(temporary,{flags:'wx'}), ...(signal?[{signal}]:[]));
      const size = fs.statSync(temporary).size;
      if (!size) throw new Error('下载到的文件是空的，请重新播放一次再试');
      if (size > this.maxBytes) throw new Error('音频文件过大，已放弃导出');
      fs.copyFileSync(temporary,destination,fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(temporary);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw signal?.aborted ? abortError(signal):error;
    }
  }

  async download(track, resolved, destination, signal) {
    const targets = [resolved?.url, ...(Array.isArray(resolved?.alternatives) ? resolved.alternatives : [])].filter(Boolean);
    if (!targets.length) throw new Error('这首歌暂时没有可用的音频地址');
    let lastError = null;
    for (const url of targets) {
      if (signal?.aborted) throw abortError(signal);
      try { return await this.streamToFile(url, track, resolved?.headers, destination, signal); } catch (error) {
        lastError = error;
        if (signal?.aborted) throw abortError(signal);
      }
    }
    throw lastError || new Error('这首歌暂时无法导出');
  }

  // Download once, then hand back the same path every later time.
  async ensure(track) {
    const existing = this.cachedPath(track);
    if (existing) return { path: existing, cached: true };
    if (!track?.key) throw new Error('歌曲不存在');
    if (this.inflight.has(track.key)) return this.inflight.get(track.key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('下载超时，已停止；可以稍后重试')), 180000);
    timer.unref?.();
    this.aborts.set(track.key, controller);
    let claimedName=null;
    const task = (async () => {
      this.ensureDirectory();
      const resolved = await this.resolveTrack(track, this.contextFor(track.platform));
      if (controller.signal.aborted) throw abortError(controller.signal);
      const name = this.claimFileName(track, extensionFor(resolved));
      claimedName=name;
      const destination = path.join(this.directory, name);
      await this.download(track, resolved, destination, controller.signal);
      const index = this.loadIndex();
      index.files[track.key] = { file: name, title: track.displayTitle || track.title || '', updatedAt: Date.now() };
      this.saveIndex();
      if (this.autoPrune) this.prune();
      return { path: destination, cached: false };
    })();
    this.inflight.set(track.key, task);
    try { return await task; }
    finally {
      clearTimeout(timer);
      this.inflight.delete(track.key);
      this.aborts.delete(track.key);
      if(claimedName)this.claimed.delete(claimedName.toLowerCase());
    }
  }

  // The renderer's "取消下载": stop the fetch, drop the partial file.
  cancel(key) {
    const controller = key ? this.aborts.get(key) : null;
    if (!controller) return false;
    controller.abort(new Error('已取消下载'));
    return true;
  }

  cancelAll(){for(const key of this.aborts.keys())this.cancel(key);}

  readyKeys(tracks) {
    const ready = [];
    for (const track of tracks || []) if (this.cachedPath(track)) ready.push(track.key);
    return ready;
  }

  // Keep the cache bounded: drop the least recently touched files first.
  prune() {
    try {
      const index = this.loadIndex();
      const items = [];
      let total = 0;
      for (const [key, entry] of Object.entries(index.files)) {
        if (!entry || typeof entry.file !== 'string') { delete index.files[key]; continue; }
        const full = this.indexedPath(entry);
        if(!full){delete index.files[key];continue;}
        try {
          const stat = fs.statSync(full);
          total += stat.size;
          items.push({ key, file: entry.file, size: stat.size, touched: typeof entry.updatedAt === 'number' ? entry.updatedAt : stat.mtimeMs });
        } catch { delete index.files[key]; }
      }
      if (total > this.maxBytes) {
        items.sort((a, b) => a.touched - b.touched);
        for (const item of items) {
          if (total <= this.maxBytes) break;
          try { fs.rmSync(path.join(this.directory, item.file), { force: true }); } catch {}
          total -= item.size;
          delete index.files[item.key];
        }
      }
      this.saveIndex();
    } catch {}
  }
}

module.exports = { TrackExporter, sanitizeFileName, baseFileName, extensionFor };
