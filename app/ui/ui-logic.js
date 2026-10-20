'use strict';

// Small, dependency-free decisions shared by the renderer and the Node test suite.
// The UI scripts are plain <script> files (no bundler), so this module exposes itself
// on window for the renderer and through module.exports for `node --test`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixlinkUiLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PLATFORM_NAMES = { qq: 'QQ 音乐', netease: '网易云', bilibili: 'Bilibili' };

  function platformLabel(platform) {
    return PLATFORM_NAMES[platform] || platform || '未知来源';
  }

  function trackName(track) {
    if (!track) return '';
    return track.displayTitle || track.title || '未命名歌曲';
  }

  /**
   * The video side panel only makes sense for Bilibili tracks. Everywhere else it
   * used to open an empty shell that told the user to "选择 B 站视频" while the
   * playing song had no video at all.
   */
  function videoPanelAvailability(track) {
    if (!track) {
      return { available: false, reason: '先播放一首 B 站歌曲，才能打开视频侧栏' };
    }
    if (track.platform !== 'bilibili') {
      return { available: false, reason: `《${trackName(track)}》来自${platformLabel(track.platform)}，没有视频可播` };
    }
    return { available: true, reason: '打开视频侧栏' };
  }

  /**
   * When playback moves on to a track without a video, an open panel would keep
   * showing the previous video. Returning true lets the UI close it once per track.
   */
  function shouldCloseVideoPanel(previousTrackKey, track) {
    if (!previousTrackKey || !track) return false;
    if (previousTrackKey === track.key) return false;
    return track.platform !== 'bilibili';
  }

  /** Filter row matching, shared by the list renderer and by "locate current". */
  function matchesTrackQuery(track, filter, query) {
    if (!track) return false;
    if (filter && filter !== 'all' && track.platform !== filter) return false;
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return true;
    const haystack = `${track.displayTitle || ''} ${track.title || ''} ${track.artist || ''}`.toLocaleLowerCase();
    return haystack.includes(needle);
  }

  /**
   * "Locate the playing track" has three outcomes: scroll to it, clear the active
   * filter first and then scroll, or tell the user it is not in this playlist.
   */
  function locateOutcome({ inPlaylist, hiddenByFilter }) {
    if (!inPlaylist) return 'missing';
    return hiddenByFilter ? 'clear' : 'scroll';
  }

  /** The key a per-playlist play button should start from. */
  function playlistPlayTarget(playlist) {
    if (!playlist || !Array.isArray(playlist.queue) || !playlist.queue.length) return null;
    if (playlist.currentKey && playlist.queue.includes(playlist.currentKey)) return playlist.currentKey;
    return playlist.queue[0];
  }

  return {
    platformLabel,
    trackName,
    videoPanelAvailability,
    shouldCloseVideoPanel,
    matchesTrackQuery,
    locateOutcome,
    playlistPlayTarget,
  };
});
