'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const policy = require('../ui/background-image.js');
class BackgroundStore {
  constructor(directory) { this.file = path.join(directory, 'custom-background.json'); this.queue = Promise.resolve(); }
  operation(fn) { const task = this.queue.catch(() => {}).then(fn); this.queue = task; return task; }
  load() { return this.operation(async () => {
    try {
      if ((await fs.stat(this.file)).size > 6 * 1024 * 1024) throw Error('背景文件过大');
      const value = policy.validate(JSON.parse(await fs.readFile(this.file, 'utf8')));
      const bytes = Buffer.from(value.image.split(',')[1], 'base64'); const info = policy.inspect(bytes);
      if (info.mime !== 'image/jpeg' || info.width > 2560 || info.height > 2560) throw Error('背景图片尺寸无效');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }); }
  save(value) { return this.operation(async () => {
    const safe = policy.validate(value), bytes = Buffer.from(safe.image.split(',')[1], 'base64'), info = policy.inspect(bytes);
    if (bytes.length > policy.MAX_SAVED || info.mime !== 'image/jpeg' || info.width > 2560 || info.height > 2560) throw Error('背景图片过大或格式无效');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.pending';
    const handle = await fs.open(temporary, 'w');
    try { await handle.writeFile(JSON.stringify(safe), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, this.file);
    return safe;
  }); }
  delete() { return this.operation(async () => { await fs.rm(this.file, { force: true }); return true; }); }
}
module.exports = { BackgroundStore };
