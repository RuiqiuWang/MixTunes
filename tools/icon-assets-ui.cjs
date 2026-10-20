'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const data = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

test('icon pixels, adaptive safe area and optional packaged Android resources', async t => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    async function pixels(file) {
      return page.evaluate(async src => {
        const img = new Image(); img.src = src; await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return { width: img.width, height: img.height, rgba: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) };
      }, data(file));
    }
    await t.test('desktop and tray sizes retain transparent corners and visible centers', async () => {
      for (const [name, size] of [['app.png', 256], ...[16,20,24,32].map(n => [`tray-${n}.png`, n])]) {
        const p = await pixels(path.join(root, 'app/ui/icons', name));
        assert.equal(p.width, size); assert.equal(p.height, size);
        assert.equal(p.rgba[3], 0, name + ' corner');
        assert.equal(p.rgba[4 * (Math.floor(size / 2) * size + Math.floor(size / 2)) + 3], 255);
      }
    });
    await t.test('all Android densities fit the adaptive safe circle', async () => {
      for (const [density, size, adaptive] of [['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]]) {
        for (const [type, name, expected] of [['mipmap','ic_launcher',size],['mipmap','ic_launcher_round',size],['drawable','ic_launcher_foreground',adaptive],['drawable','ic_launcher_background',adaptive]]) {
          const relative = `${type}-${density}/${name}.png`;
          const p = await pixels(path.join(root, 'android/native/res', relative));
          assert.equal(p.width, expected); assert.equal(p.height, expected);
          if (name === 'ic_launcher_foreground') {
            let visible = 0;
            for (let y = 0; y < expected; y++) for (let x = 0; x < expected; x++) {
              if (p.rgba[4 * (y * expected + x) + 3]) {
                visible++;
                assert.ok(Math.hypot(x + .5 - expected / 2, y + .5 - expected / 2) <= expected * 33 / 108, relative);
              }
            }
            assert.ok(visible > 0);
          }
          if (name === 'ic_launcher_round') assert.equal(p.rgba[3], 0);
          if (process.env.MIXTUNES_ICON_APK_RES) {
            const packaged = relative.replace(`${density}/`, `${density}-v4/`);
            assert.deepEqual(await pixels(path.join(process.env.MIXTUNES_ICON_APK_RES, packaged)), p, relative + ' APK pixels');
          }
        }
      }
    });
    if (process.env.MIXTUNES_ICON_PREVIEW) {
      const desktop = data(path.join(root, 'app/ui/icons/app.png'));
      const fg = data(path.join(root, 'android/native/res/drawable-xxxhdpi/ic_launcher_foreground.png'));
      const bg = data(path.join(root, 'android/native/res/drawable-xxxhdpi/ic_launcher_background.png'));
      await page.setViewportSize({ width: 840, height: 390 });
      await page.setContent(`<style>body{margin:0;font:16px sans-serif}.theme{display:flex;align-items:center;gap:24px;padding:25px;height:140px}.dark{background:#202025;color:white}.icon{width:108px;height:108px;position:relative;overflow:hidden}.icon img{position:absolute;width:100%;height:100%}.circle{border-radius:50%}.rounded{border-radius:24%}</style>` +
        ['light','dark'].map(theme => `<div class="theme ${theme}"><span>${theme}</span>${[16,32,64,128].map(size => `<img src="${desktop}" width="${size}" height="${size}">`).join('')}${['circle','rounded'].map(shape => `<div class="icon ${shape}"><img src="${bg}"><img src="${fg}"></div>`).join('')}</div>`).join(''));
      await page.evaluate(async () => Promise.all(Array.from(document.images, i => i.decode())));
      await page.screenshot({ path: path.resolve(process.env.MIXTUNES_ICON_PREVIEW) });
    }
  } finally { await browser.close(); }
});
