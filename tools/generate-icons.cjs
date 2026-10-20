'use strict';
// All pixels derive from icon-source.svg. No downloaded artwork or native tools.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/icon-source.svg'), 'utf8');
function svg(content) { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${content}</svg>`; }
function write(relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
}
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map(i => i.bytes)]);
}
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route(/^https?:/, route => route.abort());
    const { background, foreground, bounds } = await page.evaluate(source => {
      const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.getAttribute('viewBox') !== '0 0 256 256') throw new Error('Source must be valid SVG with viewBox="0 0 256 256"');
      const background = doc.getElementById('icon-background'), foreground = doc.getElementById('icon-foreground');
      if (!background || !foreground) throw new Error('Source needs icon-background and icon-foreground groups');
      document.body.appendChild(document.importNode(doc.documentElement, true));
      const box = document.getElementById('icon-foreground').getBBox();
      if (!box.width || !box.height) throw new Error('Foreground must contain visible shapes');
      return { background: background.outerHTML, foreground: foreground.outerHTML,
        bounds: { x: box.x, y: box.y, width: box.width, height: box.height } };
    }, source);
    async function render(content, size) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(content)}`);
      return page.screenshot({ omitBackground: true, animations: 'disabled' });
    }
    const desktop = `<defs><clipPath id="shape"><rect width="256" height="256" rx="58"/></clipPath></defs><g clip-path="url(#shape)">${background}${foreground}</g>`;
    const images = [];
    for (const size of [16, 20, 24, 32, 48, 64, 128, 256]) images.push({ size, bytes: await render(desktop, size) });
    write('app/ui/icons/app.ico', ico(images));
    write('app/ui/icons/app.png', await render(desktop, 256));
    // Border keeps the light tile distinguishable on both light and dark taskbars.
    const tray = desktop + '<rect x="3" y="3" width="250" height="250" rx="56" fill="none" stroke="#A7A69E" stroke-width="6"/>';
    for (const size of [16, 20, 24, 32]) write(`app/ui/icons/tray-${size}.png`, await render(tray, size));
    write('app/ui/tray.png', await render(tray, 32));
    // Scale around the optical center, leaving every corner inside the 66dp safe circle.
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
    const radius = Math.hypot(bounds.width, bounds.height) / 2;
    const center = scale => `<g transform="translate(128 128) scale(${scale}) translate(${-cx} ${-cy})">${foreground}</g>`;
    const safe = center((256 * 31 / 108) / radius);
    const legacy = center(Math.min(1, 108 / radius));
    const res = 'android/native/res';
    for (const [density, size, adaptive] of [['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]]) {
      write(`${res}/mipmap-${density}/ic_launcher.png`, await render(background + legacy, size));
      write(`${res}/mipmap-${density}/ic_launcher_round.png`, await render(`<defs><clipPath id="circle"><circle cx="128" cy="128" r="128"/></clipPath></defs><g clip-path="url(#circle)">${background}${legacy}</g>`, size));
      write(`${res}/drawable-${density}/ic_launcher_foreground.png`, await render(safe, adaptive));
      write(`${res}/drawable-${density}/ic_launcher_background.png`, await render(background, adaptive));
    }
    const xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@drawable/ic_launcher_background"/>\n  <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n</adaptive-icon>\n';
    for (const name of ['ic_launcher', 'ic_launcher_round']) write(`${res}/mipmap-anydpi-v26/${name}.xml`, xml);
    console.log('Generated Windows ICO/tray PNGs and Android launcher/adaptive resources from icon-source.svg.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
