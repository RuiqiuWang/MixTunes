'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ALLOWED_EXTENSIONS, normaliseBackground } = require('../ui/background-math.js');

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Keeps the chosen picture next to the library so moving the original is harmless. */
class BackgroundStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'background.json');
    this.settings = this.load();
  }

  load() {
    try {
      return normaliseBackground(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return normaliseBackground({});
    }
  }

  save(settings) {
    this.settings = normaliseBackground(settings);
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
    return this.settings;
  }

  imagePath() {
    return this.settings.file ? path.join(this.directory, this.settings.file) : null;
  }

  adopt(sourcePath) {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) throw new Error('请选择 JPG、PNG、WebP 或 BMP 图片');
    if (fs.statSync(sourcePath).size > MAX_IMAGE_BYTES) throw new Error('图片大于 24 MB，请先压缩后再选择');
    fs.mkdirSync(this.directory, { recursive: true });
    this.clearImage();
    const target = path.join(this.directory, `background${extension === '.jpeg' ? '.jpg' : extension}`);
    fs.copyFileSync(sourcePath, target);
    return path.basename(target);
  }

  clearImage() {
    const current = this.imagePath();
    if (current && fs.existsSync(current)) {
      try { fs.rmSync(current); } catch {}
    }
  }

  clear() {
    this.clearImage();
    return this.save({ file: null, dim: 0.72, blur: 0, luminance: 0.5 });
  }
}

/** Average luminance (0-1) of a nativeImage, used to pick a readable default scrim. */
function averageLuminance(image) {
  try {
    const small = image.resize({ width: 8, height: 8, quality: 'good' });
    const bitmap = small.toBitmap();
    let total = 0;
    let count = 0;
    for (let index = 0; index + 3 < bitmap.length; index += 4) {
      const blue = bitmap[index] / 255;
      const green = bitmap[index + 1] / 255;
      const red = bitmap[index + 2] / 255;
      total += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      count += 1;
    }
    return count ? Math.round((total / count) * 1000) / 1000 : 0.5;
  } catch {
    return 0.5;
  }
}

module.exports = { BackgroundStore, averageLuminance, MAX_IMAGE_BYTES };
