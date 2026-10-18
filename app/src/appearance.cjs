'use strict';
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_NAME = 'background.jpg';
const DEFAULT_DIM = 0.35;
const MAX_DIM = 0.8;

// Clamp the scrim opacity so a stored value can never make the UI unreadable or
// hide the picture completely.
function normaliseDim(value, fallback = DEFAULT_DIM) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, Math.min(MAX_DIM, number));
  const other = Number(fallback);
  return Number.isFinite(other) ? Math.max(0, Math.min(MAX_DIM, other)) : DEFAULT_DIM;
}

// Keeps the chosen background inside the app profile directory: the settings
// file only stores a bounded flag/name plus the scrim opacity, and the picture
// itself is always the normalised JPEG beside it.
class AppearanceStore {
  constructor(directory) {
    this.directory = directory;
    this.settings = path.join(directory, 'appearance.json');
    this.image = path.join(directory, IMAGE_NAME);
  }

  load() {
    let data;
    try { data = JSON.parse(fs.readFileSync(this.settings, 'utf8')); } catch { return {}; }
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  save(next = {}) {
    fs.mkdirSync(this.directory, { recursive: true });
    const payload = {
      image: next.image === IMAGE_NAME ? IMAGE_NAME : null,
      name: typeof next.name === 'string' ? next.name.slice(0, 160) : '',
      dim: normaliseDim(next.dim),
    };
    const temp = this.settings + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temp, this.settings);
    return payload;
  }

  hasImage() {
    try { return fs.statSync(this.image).isFile(); } catch { return false; }
  }

  readImage() {
    try { return fs.readFileSync(this.image); } catch { return null; }
  }

  writeImage(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('背景图片数据无效');
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.image + '.tmp';
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, this.image);
  }

  clearImage() {
    try { fs.rmSync(this.image, { force: true }); } catch {}
  }

  snapshot() {
    const data = this.load();
    const buffer = data.image === IMAGE_NAME && this.hasImage() ? this.readImage() : null;
    return {
      image: buffer && buffer.length ? {
        name: typeof data.name === 'string' && data.name ? data.name.slice(0, 160) : '背景图片',
        url: 'data:image/jpeg;base64,' + buffer.toString('base64'),
      } : null,
      dim: normaliseDim(data.dim),
    };
  }
}

module.exports = { AppearanceStore, normaliseDim, IMAGE_NAME, DEFAULT_DIM, MAX_DIM };
