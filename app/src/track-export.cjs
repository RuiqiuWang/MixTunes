'use strict';

// Desktop-only helper: put a track's audio stream on disk so it can be dragged
// out of the window onto the desktop or into an Explorer folder, and so the
// "另存为" dialog has a real file to copy. Everything lands in one cache
// directory under userData and is reused across sessions.
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Windows forbids these in file names, and a trailing dot/space is stripped by
// the shell, so both must go before the name is used.
const ILLEGAL_NAME = /[<>:"\/\\|?*\u0000-\u001f]/g;
const CODEC_EXTENSION = { flac: 'flac', mp3: 'mp3', m4a: 'm4a', aac: 'm4a', ogg: 'ogg', opus: 'ogg', wav: 'wav' };
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

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
    if (match) return match[1].toLowerCase();
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
    const files = parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object' ? parsed.files : {};
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
    const full = path.join(this.directory, entry.file);
    try { return fs.statSync(full).size > 0 ? full : null; } catch { return null; }
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
    for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix++) candidate = `${base} (${suffix}).${extension}`;
    return candidate;
  }

  async streamToFile(url, track, headers, destination) {
    if (!url) throw new Error('这首歌暂时没有可用的音频地址');
    const response = await this.fetchMedia(url, track.platform, this.contextFor(track.platform), { headers: { ...(headers || {}) } });
    if (!response?.body) throw new Error('下载失败，请稍后再试');
    if (!response.ok && response.status !== 206) throw new Error(Number(response.status) === 404 ? '音频地址已失效，请重新播放一次再试' : `下载失败（HTTP ${response.status}）`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > this.maxBytes) throw new Error('音频文件过大，已放弃导出');
    const temporary = `${destination}.part`;
    try {
      let received = 0;
      const counter = new Transform({
        transform: (chunk, encoding, callback) => {
          received += chunk.length;
          this.reportProgress(track, received, declared);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(temporary));
      const size = fs.statSync(temporary).size;
      if (!size) throw new Error('下载到的文件是空的，请重新播放一次再试');
      if (size > this.maxBytes) throw new Error('音频文件过大，已放弃导出');
      fs.rmSync(destination, { force: true });
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
  }

  async download(track, resolved, destination) {
    const targets = [resolved?.url, ...(Array.isArray(resolved?.alternatives) ? resolved.alternatives : [])].filter(Boolean);
    if (!targets.length) throw new Error('这首歌暂时没有可用的音频地址');
    let lastError = null;
    for (const url of targets) {
      try { return await this.streamToFile(url, track, resolved?.headers, destination); } catch (error) { lastError = error; }
    }
    throw lastError || new Error('这首歌暂时无法导出');
  }

  // Download once, then hand back the same path every later time.
  async ensure(track) {
    const existing = this.cachedPath(track);
    if (existing) return { path: existing, cached: true };
    if (!track?.key) throw new Error('歌曲不存在');
    if (this.inflight.has(track.key)) return this.inflight.get(track.key);
    const task = (async () => {
      this.ensureDirectory();
      const resolved = await this.resolveTrack(track, this.contextFor(track.platform));
      const name = this.claimFileName(track, extensionFor(resolved));
      const destination = path.join(this.directory, name);
      await this.download(track, resolved, destination);
      const index = this.loadIndex();
      index.files[track.key] = { file: name, title: track.displayTitle || track.title || '', updatedAt: Date.now() };
      this.saveIndex();
      if (this.autoPrune) this.prune();
      return { path: destination, cached: false };
    })();
    this.inflight.set(track.key, task);
    try { return await task; } finally { this.inflight.delete(track.key); }
  }

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
        const full = path.join(this.directory, entry.file);
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
