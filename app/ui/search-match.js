'use strict';

// Resolve whether a search result already exists in the local library without
// any network request. Matching is by platform-scoped source identity (and the
// canonical item URL as a fallback); titles and artists are never used, so a
// same-name recording from another source cannot look "already added".
((root) => {
  const PLATFORMS = new Set(['qq', 'netease', 'bilibili']);

  function platformId(platform, value) {
    if (!PLATFORMS.has(platform) || typeof value !== 'string') return '';
    const id = value.trim();
    if (!id || id.length > 100) return '';
    if (platform === 'netease') return /^\d+$/.test(id) ? id : '';
    if (platform === 'bilibili') return /^(?:BV[a-zA-Z0-9]{10}|av\d+)$/.test(id) ? id : '';
    return /^[A-Za-z0-9]+$/.test(id) ? id : '';
  }

  function canonicalUrl(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      url.hash = '';
      return url.href;
    } catch { return ''; }
  }

  function trackIdentity(track) {
    const ids = new Set(), urls = new Set();
    if (!track || !PLATFORMS.has(track.platform)) return { ids, urls };
    const add = (value) => { const id = platformId(track.platform, value); if (id) ids.add(id); };
    add(track.sourceId);
    if (typeof track.key === 'string') {
      const prefix = track.platform + ':';
      if (track.key.startsWith(prefix)) add(track.key.slice(prefix.length).split(':')[0]);
    }
    add(track.extra?.bvid);
    add(track.extra?.songmid);
    if (track.platform === 'bilibili') add(track.extra?.bv_id);
    const url = canonicalUrl(track.url);
    if (url) urls.add(url);
    return { ids, urls };
  }

  function itemIdentity(item) {
    const ids = new Set(), urls = new Set();
    if (!item || !PLATFORMS.has(item.platform)) return { ids, urls };
    const id = platformId(item.platform, item.id);
    if (id) ids.add(id);
    const url = canonicalUrl(item.url);
    if (url) urls.add(url);
    return { ids, urls };
  }

  function bilibiliPart(value, searchResult = false) {
    const page = value?.extra?.page;
    if (page !== undefined && (!Number.isSafeInteger(Number(page)) || Number(page) < 1)) return null;
    let urlPage = null;
    if (value?.url) {
      try {
        const url = new URL(value.url);
        if (!['www.bilibili.com', 'bilibili.com'].includes(url.hostname) || !/^\/video\/(?:BV[a-zA-Z0-9]{10}|av\d+)\/?$/.test(url.pathname)) return null;
        urlPage = Number(url.searchParams.get('p') || 1);
        if (!Number.isSafeInteger(urlPage) || urlPage < 1) return null;
      } catch { return null; }
    }
    if (page !== undefined && urlPage !== null && Number(page) !== urlPage) return null;
    return page !== undefined ? Number(page) : urlPage ?? (searchResult ? 1 : null);
  }

  function isSameSong(track, item) {
    if (!track || !item || track.platform !== item.platform) return false;
    // A search result defaults to P1; another part of that BV is not the same
    // playable item. Unknown or contradictory local part metadata is not proof.
    if (track.platform === 'bilibili') {
      const part = bilibiliPart(track);
      if (part === null || part !== bilibiliPart(item, true)) return false;
    }
    const trackIds = trackIdentity(track), itemIds = itemIdentity(item);
    for (const id of itemIds.ids) if (trackIds.ids.has(id)) return true;
    for (const url of itemIds.urls) if (trackIds.urls.has(url)) return true;
    return false;
  }

  function playlistsContaining(playlists, tracks, item) {
    const found = [];
    if (!Array.isArray(playlists) || !Array.isArray(tracks) || !item) return found;
    const byKey = new Map(tracks.map((track) => [track.key, track]));
    const seen = new Set();
    for (const playlist of playlists) {
      if (!playlist || typeof playlist.id !== 'string' || seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      if ((playlist.queue || []).some((key) => isSameSong(byKey.get(key), item))) found.push(playlist.id);
    }
    return found;
  }

  const api = { platformId, canonicalUrl, trackIdentity, itemIdentity, isSameSong, playlistsContaining };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixTunesSearchMatch = api;
})(globalThis);
