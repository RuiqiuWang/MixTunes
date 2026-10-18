'use strict';

// Optional solid background colour. This script runs in <head> before the
// stylesheet, so a saved colour is already applied on the first painted frame.
// The palette is derived from the chosen colour so text stays readable on both
// light and dark choices; theme variables stay untouched when no colour is set.
(() => {
  const key = 'mixlink-background';
  const variables = ['--bg', '--surface', '--raised', '--text', '--muted', '--border', '--selected', '--primary', '--on-primary', '--track', '--progress', '--scrim'];
  const parse = (value) => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
    if (!match) return null;
    const number = parseInt(match[1], 16);
    return [number >> 16 & 255, number >> 8 & 255, number & 255];
  };
  const rgb = (channels) => `rgb(${channels.join(',')})`;
  const rgba = (channels, alpha) => `rgba(${channels.join(',')},${alpha})`;
  const mix = (channels, target, ratio) => channels.map((channel) => Math.round(channel + (target - channel) * ratio));
  const apply = (value) => {
    const color = parse(value);
    const root = document.documentElement;
    if (!color) {
      variables.forEach((name) => root.style.removeProperty(name));
      root.removeAttribute('data-background');
      return '';
    }
    const luminance = (color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722) / 255;
    const dark = luminance < 0.52;
    const text = dark ? [242, 242, 245] : [27, 27, 32];
    const palette = {
      '--bg': rgb(color),
      '--surface': rgb(dark ? mix(color, 0, 0.28) : mix(color, 0, 0.05)),
      '--raised': rgb(dark ? mix(color, 255, 0.08) : mix(color, 255, 0.55)),
      '--text': rgb(text),
      '--muted': rgba(text, dark ? 0.72 : 0.64),
      '--border': rgba(text, dark ? 0.2 : 0.14),
      '--selected': rgba(text, dark ? 0.16 : 0.1),
      '--primary': rgb(dark ? [235, 235, 240] : [32, 32, 36]),
      '--on-primary': rgb(dark ? [32, 32, 36] : [255, 255, 255]),
      '--track': rgba(text, 0.22),
      '--progress': rgb(text),
      '--scrim': `rgba(0,0,0,${dark ? 0.55 : 0.32})`,
    };
    for (const [name, value] of Object.entries(palette)) root.style.setProperty(name, value);
    root.setAttribute('data-background', 'solid');
    return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  };
  let current = '';
  try { current = String(localStorage.getItem(key) || ''); } catch {}
  current = apply(current);
  window.mixlinkBackground = Object.freeze({
    get: () => current,
    set: (value) => {
      const previous = current;
      current = apply(value);
      try {
        if (current) localStorage.setItem(key, current);
        else localStorage.removeItem(key);
      } catch {}
      if (previous !== current) window.dispatchEvent(new CustomEvent('mixlink-background-change', { detail: { color: current } }));
      return current;
    },
  });
})();
