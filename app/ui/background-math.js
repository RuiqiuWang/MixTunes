'use strict';

// Background-image maths shared by the main process (which stores the picture) and
// the renderer (which paints the scrim), so both agree on the readability floor.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixlinkBackground = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_SCRIM = 0.45;
  const MAX_SCRIM = 0.94;
  const MAX_BLUR = 30;
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function isImageFileName(name) {
    if (typeof name !== 'string' || !name || name.includes('..') || name.includes('/') || name.includes('\\')) return false;
    const lower = name.toLowerCase();
    return ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
  }

  /**
   * Scrim opacity that keeps the theme's text colour readable over an image with the
   * given average luminance (0 = black, 1 = white).
   *
   * The light theme paints a white scrim under dark text, so a dark photo needs more
   * white; the dark theme paints a dark scrim under light text, so a bright photo
   * needs more dark. A mid-grey photo lands on the same value for both themes.
   */
  function suggestedScrim(luminance, theme) {
    const value = clamp(luminance, 0, 1, 0.5);
    const dark = theme === 'dark';
    const needed = dark ? MIN_SCRIM + value * 0.5 : MIN_SCRIM + (1 - value) * 0.5;
    return Math.round(clamp(needed, MIN_SCRIM, MAX_SCRIM, 0.7) * 100) / 100;
  }

  function normaliseBackground(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      file: isImageFileName(source.file) ? source.file : null,
      // Never below MIN_SCRIM: a photo must not be able to make the UI unreadable.
      dim: clamp(source.dim, MIN_SCRIM, MAX_SCRIM, 0.72),
      blur: Math.round(clamp(source.blur, 0, MAX_BLUR, 0)),
      luminance: clamp(source.luminance, 0, 1, 0.5),
    };
  }

  return { MIN_SCRIM, MAX_SCRIM, MAX_BLUR, ALLOWED_EXTENSIONS, clamp, isImageFileName, suggestedScrim, normaliseBackground };
});
