'use strict';

// Snapshot-only policy, independent of the desktop bridge for future clients.
((root) => {
  function target(state) {
    if (!state.currentKey) return { message: '暂无正在播放的歌曲。' };
    if (!state.playbackPlaylistId) return { message: '当前歌曲为搜索试听，没有来源歌单。' };
    const playlist = (state.playlists || []).find((item) => item.id === state.playbackPlaylistId);
    if (!playlist) return { message: '当前歌曲的来源歌单已删除。' };
    if (!playlist.queue?.includes(state.currentKey) || !(state.tracks || []).some((track) => track.key === state.currentKey)) {
      return { message: '当前歌曲已移出来源歌单。' };
    }
    return { key: state.currentKey, playlistId: playlist.id, generation: state.generation };
  }

  const policy = { target };
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.mixTunesLocatePlaying = policy;
})(globalThis);
