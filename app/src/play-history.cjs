'use strict';

const { randomUUID } = require('node:crypto');
const { safeTrack } = require('./store.cjs');

const MAX_ENTRIES = 500;
const PLATFORM_IDS = {
  qq: /^[A-Za-z0-9]{1,100}$/,
  netease: /^\d{1,100}$/,
  bilibili: /^(?:BV[0-9A-Za-z]{10}|av\d{1,100})$/,
};

// History never stores resolved media URLs or cookies. Only stable page URLs
// are rebuilt from the platform id so playback resolves fresh through providers.
function canonicalUrl(platform, sourceId) {
  if (platform === 'qq') return `https://y.qq.com/n/ryqq/songDetail/${sourceId}`;
  if (platform === 'netease') return `https://music.163.com/song?id=${sourceId}`;
  if (platform === 'bilibili') return `https://www.bilibili.com/video/${sourceId}`;
  return null;
}

function pickExtra(extra) {
  if (!extra || typeof extra !== 'object') return undefined;
  const result = {};
  for (const key of ['cid', 'bvid', 'mediaMid']) {
    const value = extra[key];
    if ((typeof value === 'string' && value.trim() && value.trim().length <= 200) || Number.isSafeInteger(value)) {
      result[key] = String(value).trim().slice(0, 200);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function canonicalTrack(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const platform = entry.platform;
  const sourceId = typeof entry.sourceId === 'string' ? entry.sourceId.trim() : '';
  if (!PLATFORM_IDS[platform] || !PLATFORM_IDS[platform].test(sourceId)) return null;
  const url = canonicalUrl(platform, sourceId);
  if (!url) return null;
  const extra = pickExtra(entry.extra);
  return safeTrack({
    key: typeof entry.key === 'string' && entry.key.length < 200 ? entry.key : undefined,
    platform,
    sourceId,
    title: typeof entry.title === 'string' ? entry.title : sourceId,
    artist: typeof entry.artist === 'string' ? entry.artist : '',
    coverUrl: typeof entry.coverUrl === 'string' ? entry.coverUrl : '',
    durationMs: Number.isFinite(entry.durationMs) && entry.durationMs > 0 ? entry.durationMs : undefined,
    url,
    ...(extra ? { extra } : {}),
  });
}

function copyEntry(entry) {
  return { ...entry, ...(entry.extra ? { extra: { ...entry.extra } } : {}) };
}

function normaliseEntry(raw, { newId = randomUUID } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const playedAt = Number(raw.playedAt);
  if (!Number.isFinite(playedAt) || playedAt <= 0) return null;
  const track = canonicalTrack(raw);
  if (!track) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 100 ? raw.id.trim() : newId();
  return {
    id,
    key: track.key,
    platform: track.platform,
    sourceId: track.sourceId,
    title: track.title,
    artist: track.artist || '',
    coverUrl: track.coverUrl || '',
    durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0,
    ...(pickExtra(track.extra) ? { extra: pickExtra(track.extra) } : {}),
    playedAt: Math.floor(playedAt),
  };
}

function normaliseHistory(entries, { max = MAX_ENTRIES, newId = randomUUID } = {}) {
  const limit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(Number(max) || MAX_ENTRIES)));
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = normaliseEntry(raw, { newId });
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  result.sort((a, b) => b.playedAt - a.playedAt);
  return result.slice(0, limit);
}

function readHistory(data) {
  if (Array.isArray(data)) return normaliseHistory(data);
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)
      || (data.schemaVersion !== undefined && data.schemaVersion !== 1)) {
    throw new Error('播放历史格式无法读取');
  }
  return normaliseHistory(data.entries);
}

// Effective listening time, not the seek bar position. Very short tracks use
// half their duration so a 2-second song can still enter history after play.
function historyThreshold(durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) return 3000;
  return Math.max(250, Math.min(3000, Math.floor(duration * 0.5)));
}

class PlayHistory {
  constructor({ entries = [], max = MAX_ENTRIES, now = Date.now, newId = randomUUID } = {}) {
    this.max = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(Number(max) || MAX_ENTRIES)));
    this.now = now;
    this.newId = newId;
    this.entries = normaliseHistory(entries, { max: this.max, newId });
  }
  get count() { return this.entries.length; }
  list() { return this.entries.map(copyEntry); }
  get(id) {
    const entry = this.entries.find(item => item.id === id);
    return entry ? copyEntry(entry) : null;
  }
  record(track, { playedAt = this.now() } = {}) {
    const entry = normaliseEntry({ ...track, playedAt, id: undefined }, { newId: this.newId });
    if (!entry) return null;
    if (this.entries[0]?.key === entry.key) {
      // Consecutive replay of the same song refreshes its timestamp instead of
      // duplicating the row. Playing it again after another song is a new row.
      this.entries[0] = { ...entry, id: this.entries[0].id };
    } else {
      this.entries.unshift(entry);
    }
    if (this.entries.length > this.max) this.entries.splice(this.max);
    return copyEntry(this.entries[0].key === entry.key ? this.entries[0] : entry);
  }
  remove(id) {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index === -1) return false;
    this.entries.splice(index, 1);
    return true;
  }
  clear() {
    const count = this.entries.length;
    this.entries = [];
    return count;
  }
  serialize() {
    return { schemaVersion: 1, entries: this.list() };
  }
}

module.exports = {
  MAX_ENTRIES,
  PlayHistory,
  canonicalTrack,
  historyThreshold,
  normaliseEntry,
  normaliseHistory,
  readHistory,
  pickExtra,
};
