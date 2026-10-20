'use strict';

((root) => {
  const STORAGE_KEY = 'mixtunes-background-mode';
  const OPACITY_KEY = 'mixtunes-background-opacity';
  const BLUR_KEYS = { cover: 'mixtunes-background-blur-cover', custom: 'mixtunes-background-blur-custom' };
  const MASK_KEYS = { light: 'mixtunes-background-mask-light', dark: 'mixtunes-background-mask-dark' };
  const MASK_DEFAULTS = { light: 88, dark: 90 };
  const BLUR_MAX = 40;
  const LEGACY_COVER_BLUR = 24;
  const LEGACY_SMALL_COVER_BLUR = 18;
  const playableStates = new Set(['loading', 'buffering', 'playing', 'paused', 'ended']);

  function sourceFor(state, allowDataImages = false) {
    if (!state?.currentKey || !playableStates.has(state.status)) return '';
    const track = state.currentTrack?.key === state.currentKey ? state.currentTrack
      : (state.tracks || []).find((item) => item.key === state.currentKey);
    if (!track || !['qq', 'netease', 'bilibili'].includes(track.platform)) return '';
    const source = track.coverUrl;
    if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) return '';
    try {
      const url = new URL(source);
      if (url.username || url.password) return '';
      if (url.protocol === 'https:') return url.href;
      if (allowDataImages && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(source)) return source;
    } catch {}
    return '';
  }

  function clampBlur(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(BLUR_MAX, Math.round(number)));
  }

  function create({ container, documentRoot = root.document.documentElement, storage,
    makeImage = () => new root.Image(), allowDataImages = false, onStorageError = () => {},
    schedule = root.setTimeout.bind(root), cancel = root.clearTimeout.bind(root),
    matchMedia = root.matchMedia }) {
    let enabled = false, mode = 'theme', custom = null, opacity = 100, latest = {}, source = '', serial = 0, pending = null, timer = null;
    // null means "the user never changed this mode": the legacy default stays in
    // effect. Blur is remembered per image mode so one mode cannot overwrite the other.
    let coverBlur = null, customBlur = null;
    const masks = { ...MASK_DEFAULTS };
    const removalTimers = new Map();
    function readBlur(key) {
      try {
        const raw = storage?.getItem(key);
        if (raw === null || raw === undefined || raw === '') return null;
        const number = Number(raw);
        if (!Number.isFinite(number) || number < 0 || number > BLUR_MAX) return null;
        return clampBlur(number);
      } catch { return null; }
    }
    try {
      if (storage === undefined) storage = root.localStorage;
      mode = storage?.getItem(STORAGE_KEY);
      if (!['theme', 'current-cover', 'custom'].includes(mode)) mode = 'theme';
      enabled = mode === 'current-cover';
      const savedOpacity = storage?.getItem(OPACITY_KEY);
      if (savedOpacity !== null && savedOpacity !== undefined && savedOpacity !== '' && Number.isFinite(Number(savedOpacity))) opacity = Math.max(0, Math.min(100, Number(savedOpacity)));
      coverBlur = readBlur(BLUR_KEYS.cover);
      customBlur = readBlur(BLUR_KEYS.custom);
      for (const theme of ['light', 'dark']) {
        const value = storage?.getItem(MASK_KEYS[theme]);
        if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) masks[theme] = Math.round(Number(value));
      }
    } catch { onStorageError(); }

    function theme() { return documentRoot.getAttribute?.('data-theme') === 'dark' ? 'dark' : 'light'; }
    function applyMask() {
      for (const name of ['light', 'dark']) documentRoot.style?.setProperty?.('--background-mask-' + name, String(masks[name] / 100));
    }
    applyMask();

    function legacyCoverBlur() {
      try { return matchMedia?.('(max-width: 600px)')?.matches ? LEGACY_SMALL_COVER_BLUR : LEGACY_COVER_BLUR; } catch { return LEGACY_COVER_BLUR; }
    }
    function blurFor(target) {
      if (target === 'custom') return customBlur === null ? 0 : customBlur;
      return coverBlur === null ? legacyCoverBlur() : coverBlur;
    }
    function blur() {
      if (mode === 'custom') return blurFor('custom');
      if (mode === 'current-cover') return blurFor('cover');
      return 0;
    }
    function applyEffects() {
      const value = blur();
      const explicit = mode === 'custom' ? customBlur !== null : coverBlur !== null;
      let scale = 0;
      if (explicit && value > 0) {
        let size = 0;
        try { const box = container.getBoundingClientRect?.(); size = Math.min(Number(box?.width) || 0, Number(box?.height) || 0); } catch {}
        // Extra scale hides the transparent fringe CSS blur creates at the viewport edge.
        // Legacy defaults keep their original framing because they are not "explicit".
        scale = Math.min(.25, (value * 2.5) / (size || 1200));
      }
      container.style?.setProperty?.('--background-blur', value + 'px');
      container.style?.setProperty?.('--background-blur-scale', String(Number(scale.toFixed(4))));
    }
    container.style?.setProperty?.('--background-opacity', String(opacity / 100));
    applyEffects();

    function layoutCustom() {
      if (mode !== 'custom' || !custom || !root.mixTunesBackgroundImage) return;
      const box = container.getBoundingClientRect();
      for (const image of container.children) {
        if (!image.naturalWidth || !image.naturalHeight) continue;
        const rect = root.mixTunesBackgroundImage.layout(image.naturalWidth, image.naturalHeight, box.width, box.height, custom.crop);
        for (const name of ['left', 'top', 'width', 'height']) image.style[name] = rect[name] + 'px';
      }
    }
    const observer = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(() => { layoutCustom(); applyEffects(); }) : null;
    observer?.observe(container);

    function clearPending() {
      if (timer !== null) cancel(timer);
      timer = null;
      if (pending) { pending.onload = null; pending.onerror = null; pending.removeAttribute('src'); pending = null; }
    }
    function remove(image) {
      if (removalTimers.has(image)) cancel(removalTimers.get(image));
      removalTimers.delete(image);
      image.remove();
      image.removeAttribute('src');
    }
    function reset() {
      serial++; clearPending();
      documentRoot.classList.remove('has-cover-background');
      for (const image of Array.from(container.children)) remove(image);
    }
    function update(snapshot) {
      latest = snapshot || {};
      const next = mode === 'custom' ? (custom?.image || '') : enabled ? sourceFor(latest, allowDataImages) : '';
      if (next === source) return;
      source = next;
      const request = ++serial;
      clearPending();
      if (!next) { reset(); return; }
      // Fade the previous content away while loading; never leave a different song's cover on screen.
      for (const image of container.children) image.style.opacity = '0';
      const image = makeImage();
      if (mode === 'custom') image.className = 'custom-background-image';
      pending = image;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      const failed = () => { if (request === serial) { reset(); if (mode === 'custom') { mode = 'theme'; try { storage?.setItem(STORAGE_KEY, mode); } catch { onStorageError(); } container.dispatchEvent?.(new root.Event('background-failed')); } } };
      image.onerror = failed;
      image.onload = () => {
        if (request !== serial) return;
        if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
        cancel(timer); timer = null; pending = null;
        image.onload = null; image.onerror = null;
        // Two visible buffers at most, including rapid cached transitions.
        while (container.children.length > 1) remove(container.children[0]);
        const previous = container.children[0];
        container.appendChild(image);
        if (opacity > 0) documentRoot.classList.add('has-cover-background');
        layoutCustom();
        void image.offsetWidth;
        image.style.opacity = '1';
        if (previous) removalTimers.set(previous, schedule(() => remove(previous), 240));
      };
      timer = schedule(failed, 12000);
      image.src = next;
    }
    return {
      update,
      enabled: () => enabled,
      mode: () => mode,
      opacity: () => opacity,
      blur,
      blurFor,
      mask: () => masks[theme()],
      setMask(value) {
        const name = theme();
        masks[name] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        applyMask();
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem(MASK_KEYS[name], String(masks[name])); return true; } catch { onStorageError(); return false; }
      },
      custom: () => custom,
      setMode(value) {
        const nextMode = ['theme', 'current-cover', 'custom'].includes(value) ? value : 'theme';
        const changed = nextMode !== mode;
        mode = nextMode;
        enabled = mode === 'current-cover';
        let saved = true;
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem(STORAGE_KEY, mode); } catch { saved = false; onStorageError(); }
        // A mode switch can reuse the same pixels, but must reset their layout.
        if (changed) { source = ''; reset(); }
        applyEffects();
        update(latest);
        return saved;
      },
      setCustom(value) { custom = value; if (mode === 'custom') { update(latest); layoutCustom(); } },
      setOpacity(value, { persist = true } = {}) {
        opacity = Math.max(0, Math.min(100, Number(value) || 0));
        container.style?.setProperty?.('--background-opacity', String(opacity / 100));
        if (!opacity) documentRoot.classList.remove('has-cover-background');
        else if (container.children.length) documentRoot.classList.add('has-cover-background');
        if (!persist) return true;
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem(OPACITY_KEY, String(opacity)); return true; } catch { onStorageError(); return false; }
      },
      setBlur(value, { persist = true } = {}) {
        const next = clampBlur(value);
        if (mode === 'custom') customBlur = next; else coverBlur = next;
        applyEffects();
        if (!persist) return true;
        const key = mode === 'custom' ? BLUR_KEYS.custom : BLUR_KEYS.cover;
        try { if (!storage) throw Error('Settings unavailable'); storage.setItem(key, String(next)); return true; } catch { onStorageError(); return false; }
      },
      setEnabled(value) {
        enabled = Boolean(value);
        mode = enabled ? 'current-cover' : 'theme';
        try {
          if (!storage) throw new Error('Settings storage unavailable');
          storage.setItem(STORAGE_KEY, enabled ? 'current-cover' : 'theme');
        } catch { onStorageError(); }
        applyEffects();
        update(latest);
      },
      destroy() { source = ''; reset(); observer?.disconnect(); },
    };
  }

  const api = { STORAGE_KEY, OPACITY_KEY, BLUR_KEYS, BLUR_MAX, MASK_KEYS, MASK_DEFAULTS, sourceFor, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixTunesCoverBackground = api;
})(globalThis);
