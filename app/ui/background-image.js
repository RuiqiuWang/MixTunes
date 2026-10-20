'use strict';
((root) => {
  const MAX_INPUT = 12 * 1024 * 1024, MAX_SAVED = 4 * 1024 * 1024;
  function inspect(bytes) {
    if (!bytes.length || bytes.length > MAX_INPUT) throw Error('图片须小于 12 MB');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (p, n) => String.fromCharCode(...bytes.subarray(p, p + n));
    let width = 0, height = 0, mime = '';
    if (bytes.length > 32 && text(1, 3) === 'PNG' && v.getUint32(0) === 0x89504e47) {
      mime = 'image/png'; width = v.getUint32(16); height = v.getUint32(20);
      for (let p = 8; p + 12 <= bytes.length;) { const n = v.getUint32(p); if (text(p + 4, 4) === 'acTL') throw Error('暂不支持动画图片'); p += n + 12; }
    } else if (bytes.length > 12 && v.getUint16(0) === 0xffd8) {
      mime = 'image/jpeg';
      for (let p = 2; p + 9 < bytes.length;) {
        if (bytes[p++] !== 255) break;
        while (bytes[p] === 255) p++;
        if (p + 3 >= bytes.length) break;
        const marker = bytes[p++]; if (marker === 0xda || marker === 0xd9) break;
        if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const n = v.getUint16(p); if (n < 2 || p + n > bytes.length) break;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { if (n < 8) break; height = v.getUint16(p + 3); width = v.getUint16(p + 5); break; } p += n;
      }
    } else if (bytes.length > 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
      mime = 'image/webp';
      for (let p = 12; p + 8 < bytes.length;) {
        const kind = text(p, 4), n = v.getUint32(p + 4, true), b = p + 8;
        if (b + n > bytes.length) break;
        if (kind === 'ANIM' || (kind === 'VP8X' && (bytes[b] & 2))) throw Error('暂不支持动画图片');
        if (kind === 'VP8X' && n >= 10) { width = 1 + bytes[b+4] + (bytes[b+5]<<8) + (bytes[b+6]<<16); height = 1 + bytes[b+7] + (bytes[b+8]<<8) + (bytes[b+9]<<16); }
        if (kind === 'VP8 ' && n >= 10 && !width) { width = v.getUint16(b + 6, true) & 0x3fff; height = v.getUint16(b + 8, true) & 0x3fff; }
        if (kind === 'VP8L' && n >= 5 && !width) { const bits = v.getUint32(b+1,true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
        p = b + n + (n % 2);
      }
    }
    if (!mime || !width || !height) throw Error('请选择有效的 JPEG、PNG 或静态 WebP 图片');
    if (width > 8192 || height > 8192 || width * height > 24000000) throw Error('图片尺寸过大，请先缩小至 2400 万像素以内（单边不超过 8192）');
    return { width, height, mime };
  }
  function crop(value = {}) {
    value = value && typeof value === 'object' ? value : {};
    return { x: Math.max(0, Math.min(1, Number.isFinite(value.x) ? value.x : .5)), y: Math.max(0, Math.min(1, Number.isFinite(value.y) ? value.y : .5)), zoom: Math.max(1, Math.min(4, Number.isFinite(value.zoom) ? value.zoom : 1)) };
  }
  function layout(iw, ih, w, h, value) {
    const c = crop(value), scale = Math.max(w / iw, h / ih) * c.zoom, width = iw * scale, height = ih * scale;
    return { width, height, left: Math.max(w - width, Math.min(0, w / 2 - c.x * width)), top: Math.max(h - height, Math.min(0, h / 2 - c.y * height)) };
  }
  function validate(saved) {
    if (!saved || saved.version !== 1 || typeof saved.image !== 'string' || saved.image.length > Math.ceil(MAX_SAVED * 4 / 3) + 32 || !/^data:image\/jpeg;base64,[a-z\d+/]+=*$/i.test(saved.image)) throw Error('保存的背景图片无效');
    return { version: 1, image: saved.image, crop: crop(saved.crop) };
  }
  const api = { MAX_INPUT, MAX_SAVED, inspect, crop, layout, validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixTunesBackgroundImage = api;
})(globalThis);
