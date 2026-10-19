'use strict';

(() => {
  const api = window.playerAPI;
  const byId = (id) => document.getElementById(id);
  const platformNames = { qq: 'QQ 音乐', netease: '网易云', bilibili: 'Bilibili' };
  const DIALOG_IDS = ['playlist-dialog', 'quality-dialog', 'track-rename-dialog', 'track-range-dialog', 'online-search-dialog', 'search-add-dialog', 'lyrics-dialog', 'playlist-share-dialog'];
  const modeNames = { sequential: '顺序播放', 'repeat-all': '列表循环', 'repeat-one': '单曲循环', shuffle: '随机播放' };
  const modeIcons = { sequential: '→', 'repeat-all': '↻', 'repeat-one': '↻₁', shuffle: '⤨' };
  const modes = Object.keys(modeNames);
  const statusNames = { idle: '待播放', loading: '加载中…', playing: '播放中', paused: '已暂停', buffering: '缓冲中…', error: '播放失败', ended: '播放结束' };
  const qualityNames = { auto: '自动', high: '高品质', lossless: '无损', standard: '标准' };
  let state = { tracks: [], playlists: [], activePlaylistId: null, queue: [], currentKey: null, mode: 'sequential', status: 'idle', positionMs: 0, durationMs: 0, volume: 0.8, muted: false, qualitySettings: { qq: 'auto', netease: 'auto', bilibili: 'auto' }, playbackQuality: null, videoPanel: { open: false, expanded: false }, videoOpen: false };
  let filter = 'all';
  let query = '';
  let pendingVolume = null;
  let sendingVolume = false;
  let dragKey = null;
  let seeking = false;
  let changingVolume = false;
  let previousListSignature = '';
  let previousCoverKey = '';
  let lastError = '';
  let lastNotice = '';
  let previousPlaylistSignature = '';
  let playlistDialogAction = null;
  let playlistMenuTargetId = null;
  let searchAddTarget = null;
  let searchAddPlaylistSignature = '';
  let importing = false;
  let renameTrackKey = null;
  let rangeTrackKey = null;
  let rangeDraft = null;
  let rangeSaving = false;
  let videoLayoutFrame = null;
  let videoLayoutSignature = '';
  let nativeDialogDepth = 0;
  let noticeTimer = null;
  let lyrics = { serial: 0, key: null, status: 'idle', lines: [], activeIndex: -1, manualUntil: 0, manualRevision: 0, coverKey: '' };
  let lyricsFollowTimer = null;
  let lyricsSeeking = false;
  let shareSerial = 0;
  let shareLoading = false;
  let shareResult = null;
  let onlineSearch = { serial: 0, query: '', filter: 'all', playlistId: null, playlistName: '', platforms: emptySearchPlatforms() };

  function emptySearchPlatforms() {
    return Object.fromEntries(Object.keys(platformNames).map((platform) => [platform, { status: 'idle', entries: [], page: 0, total: 0, hasMore: false, moreLoading: false, error: '', failedPage: null, requestSequence: 0 }]));
  }

  function hasOpenDialog() {
    return DIALOG_IDS.some((id) => byId(id)?.open);
  }

  function renderThemeButton() {
    const button = byId('toggle-theme');
    if (!button) return;
    const dark = window.mixlinkTheme?.get() === 'dark';
    const label = dark ? '切换浅色模式' : '切换深色模式';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
    if (dark) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [name, value] of Object.entries({ cx: '12', cy: '12', r: '4' })) circle.setAttribute(name, value);
      svg.append(circle);
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dark ? 'M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42' : 'M20.9 13.2A9 9 0 0 1 10.8 3.1 9 9 0 1 0 20.9 13.2Z');
    svg.append(path);
    button.replaceChildren(svg);
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function syncNativeTheme() {
    if (!api?.command) return;
    try { Promise.resolve(api.command('theme', { theme: window.mixlinkTheme?.get() || 'light' })).catch(() => {}); } catch {}
  }

  const displayName = (track) => track?.displayTitle || track?.title || '未命名歌曲';
  const currentTrack = () => state.currentTrack?.key === state.currentKey ? state.currentTrack : (state.tracks || []).find((track) => track.key === state.currentKey);
  const playbackKeys = () => Array.isArray(state.playbackQueue) ? state.playbackQueue : state.queue || [];
  const isPlaying = () => ['playing', 'buffering', 'loading'].includes(state.status);
  const canPlay = () => Boolean(currentTrack() || playbackKeys().length || (state.queue || []).length);

  function videoLoggedIn() {
    const account = state.accounts?.bilibili;
    return account === true || Boolean(account?.loggedIn && account.status !== 'expired');
  }

  function syncVideoLayout(forceHidden = false) {
    if (!api) return Promise.resolve();
    const surface = byId('video-surface');
    const rect = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, Math.ceil(rect.left)));
    const y = Math.max(0, Math.min(innerHeight - 1, Math.ceil(rect.top)));
    const width = Math.max(1, Math.min(innerWidth - x, Math.floor(rect.right) - x));
    const height = Math.max(1, Math.min(innerHeight - y, Math.floor(rect.bottom) - y));
    const visible = Boolean(!forceHidden && !nativeDialogDepth && !hasOpenDialog() && !playlistMenuTargetId && state.videoPanel?.open && state.videoOpen && currentTrack()?.platform === 'bilibili' && rect.width > 1 && rect.height > 1);
    const payload = { visible, bounds: { x, y, width, height } };
    const signature = JSON.stringify(payload);
    if (signature === videoLayoutSignature) return Promise.resolve();
    videoLayoutSignature = signature;
    return Promise.resolve(api.command('video-layout', payload)).then((result) => {
      if (result?.ok === false) videoLayoutSignature = '';
    }).catch(() => { videoLayoutSignature = ''; });
  }

  function scheduleVideoLayout() {
    if (videoLayoutFrame !== null) return;
    videoLayoutFrame = requestAnimationFrame(() => {
      videoLayoutFrame = null;
      syncVideoLayout();
    });
  }

  function showDialog(id) {
    closePlaylistMenu(false);
    syncVideoLayout(true);
    byId(id).showModal();
    scheduleVideoLayout();
  }

  async function withVideoHidden(operation) {
    nativeDialogDepth++;
    await syncVideoLayout(true);
    try { return await operation(); }
    finally { nativeDialogDepth--; scheduleVideoLayout(); }
  }

  function renderVideoPanel() {
    const open = Boolean(state.videoPanel?.open);
    const expanded = open && Boolean(state.videoPanel?.expanded);
    document.querySelector('.app').classList.toggle('video-panel-open', open);
    document.querySelector('.app').classList.toggle('video-panel-expanded', expanded);
    byId('video-panel').hidden = !open;
    byId('toggle-video-panel').classList.toggle('active', open);
    byId('toggle-video-panel').setAttribute('aria-pressed', String(open));
    byId('toggle-video-panel').setAttribute('aria-label', open ? '关闭视频侧栏' : '打开视频侧栏');
    byId('toggle-video-panel').title = open ? '关闭视频侧栏' : '打开视频侧栏';
    byId('expand-video-panel').hidden = expanded;
    byId('shrink-video-panel').hidden = !expanded;
    const track = currentTrack();
    const bilibili = track?.platform === 'bilibili';
    const playingVideo = bilibili && state.videoOpen;
    byId('video-panel-title').textContent = bilibili ? displayName(track) : '视频侧栏';
    byId('video-panel-title').title = bilibili ? displayName(track) : '视频侧栏';
    byId('video-login-hint').hidden = videoLoggedIn();
    byId('video-placeholder').hidden = Boolean(playingVideo);
    byId('video-placeholder-title').textContent = bilibili ? '观看当前视频' : '选择 B 站视频';
    byId('video-placeholder-description').textContent = bilibili ? '点击“看视频”' : '选择歌曲后观看';
    byId('play-panel-video').hidden = !bilibili || Boolean(playingVideo);
    scheduleVideoLayout();
  }

  function durationFor(track) {
    const runtime = track?.key === state.currentKey ? Number(state.durationMs) : 0;
    return Math.max(0, Math.round(runtime > 0 ? runtime : Number(track?.durationMs) || 0));
  }

  function visibleRange(track, duration = durationFor(track)) {
    const source = rangeDraft && rangeDraft.key === track?.key ? rangeDraft : track?.playRange || {};
    let startMs = Math.max(0, Math.round(Number(source.startMs) || 0));
    const rawEnd = source.endMs === null || source.endMs === undefined ? null : Math.max(0, Math.round(Number(source.endMs) || 0));
    const end = duration > 0 ? Math.min(duration, rawEnd ?? duration) : rawEnd;
    if (duration > 0) startMs = Math.min(startMs, Math.max(0, end - Math.min(1000, duration)));
    return { startMs, endMs: rawEnd, endPosition: end };
  }

  function renderRange(track) {
    const duration = durationFor(track);
    const range = visibleRange(track, duration);
    const enabled = Boolean(track && duration >= 1000);
    const end = range.endPosition ?? duration;
    for (const [id, value] of [['range-start', range.startMs], ['range-end', end]]) {
      const input = byId(id);
      input.max = String(Math.max(1, duration));
      input.value = String(value || 0);
      input.disabled = !enabled || rangeSaving;
    }
    byId('range-start').title = `片段起点 ${time(range.startMs)}`;
    byId('range-end').title = `片段终点 ${duration ? time(end) : '播放后识别时长'}`;
    byId('clip-markers').classList.toggle('disabled', !enabled);
    byId('clip-selection').style.left = `${duration ? range.startMs / duration * 100 : 0}%`;
    byId('clip-selection').style.width = `${duration ? Math.max(0, end - range.startMs) / duration * 100 : 100}%`;
    byId('edit-current-range').disabled = !track;
    byId('edit-current-range').title = track ? `播放片段 ${time(range.startMs)} — ${duration ? time(end) : '完整结尾'}` : '先选择歌曲';
  }

  function editTrackName(track) {
    renameTrackKey = track.key;
    byId('track-original-name').textContent = `原名：${track.title || '未命名歌曲'}`;
    byId('track-original-name').title = '显示名称会用于所有歌单；原名保留用于去重。';
    byId('track-name-input').value = displayName(track);
    byId('track-rename-error').hidden = true;
    showDialog('track-rename-dialog');
    byId('track-name-input').focus();
    byId('track-name-input').select();
  }

  function editTrackRange(track) {
    rangeTrackKey = track.key;
    const duration = durationFor(track);
    const range = visibleRange(track, duration);
    const tooShort = duration > 0 && duration < 1000;
    byId('range-track-name').textContent = `${displayName(track)}${duration ? ` · 全长 ${time(duration)}` : ''}`;
    byId('range-start-seconds').value = String(range.startMs / 1000);
    byId('range-start-seconds').disabled = tooShort;
    byId('range-end-seconds').value = range.endMs === null ? '' : String(range.endMs / 1000);
    byId('range-end-seconds').placeholder = duration ? `完整结尾 ${time(duration)}` : '识别时长后可调整';
    byId('range-end-seconds').disabled = !duration || tooShort;
    for (const id of ['range-start-seconds', 'range-end-seconds']) {
      const input = byId(id);
      if (duration) input.max = String(duration / 1000); else input.removeAttribute('max');
    }
    byId('range-help').textContent = tooShort ? '不足 1 秒，可恢复整首。' : duration ? '至少保留 1 秒。' : '时长未知，可先设置起点。';
    byId('track-range-submit').disabled = tooShort;
    byId('track-range-error').hidden = true;
    showDialog('track-range-dialog');
    (tooShort ? byId('reset-track-range') : byId('range-start-seconds')).focus();
  }

  function openCurrentVideo() {
    const track = currentTrack();
    if (track?.platform === 'bilibili') return command('video-open', { key: track.key });
    showNotice('先选择 B 站视频。');
    return null;
  }

  function time(value) {
    const seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function conciseNotice(message) {
    const text = String(message);
    const known = {
      '歌曲显示名称已保存。': '名称已保存',
      '这首内容的播放起止时间已保存。': '片段已保存',
      '音质设置已保存。切歌后应用；当前曲目暂停后再播放会从头应用新音质。': '音质已保存，下次播放生效',
      '已更新账号状态；如需登录，请打开对应平台的官方登录窗口。': '账号状态已更新',
      '已导出全部混合歌单备份，不包含账号登录信息。': '歌单备份已导出',
      '请在官方页面完成登录，完成后关闭该窗口即可。': '请在官方窗口登录',
      '请在官方页面登录；应用会保存本机登录状态。': '请在官方窗口登录',
      '请先在 Bilibili 官方窗口登录；完成后会用这个账号打开视频。': '请先登录 Bilibili，完成后继续播放',
    };
    if (known[text]) return known[text];
    return text.replace(/，跳过同名同作者 (\d+) 首（保留已有歌曲）/g, '，同名同作者 $1 首已跳过');
  }

  function showNotice(message, error = false) {
    if (!message) return;
    clearTimeout(noticeTimer);
    byId('notice-text').textContent = error ? String(message) : conciseNotice(message);
    byId('notice-text').title = String(message);
    byId('notice').classList.toggle('error', error);
    byId('notice').hidden = false;
    if (!error) noticeTimer = setTimeout(() => { byId('notice').hidden = true; }, 4500);
  }

  function resultMessage(result) {
    if (typeof result === 'string') return result;
    return result && (result.message || result.notice);
  }

  async function run(operation, { success } = {}) {
    if (!api) {
      showNotice('请通过 MixTunes.exe 启动播放器。', true);
      return null;
    }
    try {
      const result = await operation();
      if (result && result.ok === false) throw new Error(result.error || result.message || '操作未完成');
      const message = resultMessage(result) || success;
      if (message) showNotice(message, Boolean(result?.errors?.length));
      return result;
    } catch (error) {
      showNotice(error && error.message ? error.message : String(error), true);
      return null;
    }
  }

  function command(name, payload) {
    return run(() => api.command(name, payload));
  }

  function orderedTracks() {
    const tracks = Array.isArray(state.tracks) ? state.tracks : [];
    const map = new Map(tracks.map((track) => [track.key, track]));
    const order = Array.isArray(state.queue) ? state.queue : [];
    const seen = new Set();
    const result = [];
    for (const key of order) {
      if (map.has(key) && !seen.has(key)) {
        seen.add(key);
        result.push(map.get(key));
      }
    }
    return result;
  }

  function activePlaylist() {
    return (state.playlists || []).find((playlist) => playlist.id === state.activePlaylistId);
  }

  function resetView() {
    filter = 'all';
    query = '';
    byId('search-input').value = '';
    document.querySelectorAll('[data-filter]').forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === 'all');
      button.setAttribute('aria-pressed', String(button.dataset.filter === 'all'));
    });
  }

  function renderPlaylists() {
    const playlists = Array.isArray(state.playlists) ? state.playlists : [];
    const active = activePlaylist();
    const name = active?.name || '统一歌单';
    byId('active-playlist-name').textContent = name;
    byId('active-playlist-name').title = name;
    byId('track-table').setAttribute('aria-label', `${name}的歌曲`);
    if (playlistMenuTargetId && (!playlists.some((playlist) => playlist.id === playlistMenuTargetId) || importing)) closePlaylistMenu(false);
    renderPlaylistMenuState();
    byId('import-button').title = `插入到“${name}”的最前面`;
    const signature = JSON.stringify([playlists.map((playlist) => [playlist.id, playlist.name, playlist.queue?.length || 0]), state.activePlaylistId, importing]);
    if (signature === previousPlaylistSignature) return;
    previousPlaylistSignature = signature;
    const fragment = document.createDocumentFragment();
    for (const playlist of playlists) {
      const button = document.createElement('button');
      button.className = 'playlist-item';
      button.type = 'button';
      button.dataset.playlistId = playlist.id;
      button.dataset.testid = 'playlist-item';
      button.classList.toggle('active', playlist.id === state.activePlaylistId);
      button.setAttribute('aria-pressed', String(playlist.id === state.activePlaylistId));
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', 'playlist-context-menu');
      button.title = playlist.name;
      const icon = document.createElement('span');
      icon.className = 'playlist-icon';
      icon.textContent = '♫';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'playlist-label';
      label.textContent = playlist.name;
      const count = document.createElement('span');
      count.className = 'playlist-count';
      count.textContent = String(playlist.queue?.length || 0);
      button.append(icon, label, count);
      button.disabled = importing;
      button.addEventListener('click', async () => {
        if (playlist.id === state.activePlaylistId) return;
        const result = await command('playlist-select', { id: playlist.id });
        if (result !== null) { resetView(); renderList(); }
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlaylistMenu(playlist.id, event.clientX, event.clientY);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = button.getBoundingClientRect();
        openPlaylistMenu(playlist.id, rect.left + 12, rect.bottom);
      });
      fragment.append(button);
    }
    byId('playlist-list').replaceChildren(fragment);
    byId('create-playlist').disabled = importing;
  }

  function renderPlaylistMenuState() {
    const playlists = state.playlists || [];
    const target = playlists.find((playlist) => playlist.id === playlistMenuTargetId);
    byId('rename-playlist').disabled = !target || importing;
    byId('delete-playlist').disabled = !target || importing || playlists.length <= 1;
    byId('delete-playlist').title = playlists.length <= 1 ? '至少保留一个歌单' : '删除歌单';
    byId('playlist-context-menu').setAttribute('aria-label', target ? `“${target.name}”的操作` : '歌单操作');
  }

  function closePlaylistMenu(restoreFocus = true) {
    const id = playlistMenuTargetId;
    playlistMenuTargetId = null;
    byId('playlist-context-menu').hidden = true;
    if (restoreFocus && id) [...document.querySelectorAll('.playlist-item')].find((button) => button.dataset.playlistId === id)?.focus();
    if (id) scheduleVideoLayout();
  }

  function openPlaylistMenu(id, x, y) {
    if (importing || hasOpenDialog() || !(state.playlists || []).some((playlist) => playlist.id === id)) return;
    closePlaylistMenu(false);
    playlistMenuTargetId = id;
    renderPlaylistMenuState();
    const menu = byId('playlist-context-menu');
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    syncVideoLayout(true);
    byId('rename-playlist').focus();
  }

  function openPlaylistDialog(action, playlistId = state.activePlaylistId) {
    const target = (state.playlists || []).find((playlist) => playlist.id === playlistId);
    if (action !== 'create' && !target) return;
    if (action === 'delete' && (state.playlists || []).length <= 1) { showNotice('至少保留一个歌单'); return; }
    playlistDialogAction = { action, id: target?.id };
    const deleting = action === 'delete';
    byId('playlist-dialog-title').textContent = ({ create: '新建歌单', rename: '重命名歌单', delete: '删除歌单' })[action];
    byId('playlist-dialog-description').textContent = deleting ? `删除“${target.name}”？` : '';
    byId('playlist-dialog-description').hidden = !deleting;
    byId('playlist-name-field').hidden = deleting;
    byId('playlist-name-input').required = !deleting;
    byId('playlist-name-input').value = action === 'rename' ? target.name : '';
    byId('playlist-dialog-submit').textContent = ({ create: '创建', rename: '保存', delete: '删除' })[action];
    byId('playlist-dialog-submit').classList.toggle('danger', deleting);
    byId('playlist-dialog-error').hidden = true;
    showDialog('playlist-dialog');
    if (deleting) byId('playlist-dialog-cancel').focus();
    else { byId('playlist-name-input').focus(); byId('playlist-name-input').select(); }
  }

  function safeCover(url) {
    if (typeof url !== 'string') return null;
    try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
  }

  function coverImage(container, track, fallback = '♫') {
    container.replaceChildren();
    container.textContent = fallback;
    const src = track && safeCover(track.coverUrl);
    if (!src) return;
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    img.dataset.testid = 'cover-image';
    img.addEventListener('error', () => { if (container.contains(img)) container.textContent = fallback; });
    img.src = src;
    container.replaceChildren(img);
  }

  function onlineMessage(message = '', error = false) {
    const element = byId('online-search-message');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = !message;
  }

  function searchError(error) {
    return String(typeof error === 'string' ? error : error?.message || '暂时无法完成请求').slice(0, 300);
  }

  function renderSearchTarget() {
    const text = onlineSearch.query ? `搜索「${onlineSearch.query}」` : '';
    byId('online-search-target').textContent = text;
    byId('online-search-target').title = text;
  }

  function resetOnlineSearch(message = '') {
    if (byId('search-add-dialog').open) byId('search-add-dialog').close();
    searchAddTarget = null;
    const playlist = (state.playlists || []).find((item) => item.id === state.activePlaylistId);
    onlineSearch = { serial: onlineSearch.serial + 1, query: '', filter: 'all', playlistId: playlist?.id || null, playlistName: playlist?.name || '', platforms: emptySearchPlatforms() };
    onlineMessage(message);
    renderOnlineSearch();
  }

  function openOnlineSearch() {
    resetOnlineSearch();
    const localQuery = byId('search-input').value.trim();
    if (localQuery) byId('online-search-query').value = localQuery;
    showDialog('online-search-dialog');
    byId('online-search-query').focus();
    byId('online-search-query').select();
  }

  async function openOriginalSearch(platform) {
    const serial = onlineSearch.serial;
    try {
      if (!api?.openSearch) throw new Error('请通过 MixTunes 打开搜索。');
      const result = await api.openSearch({ platform, query: onlineSearch.query });
      if (result?.ok === false) throw new Error(searchError(result.error || '未能打开原站搜索'));
    } catch (error) {
      if (serial === onlineSearch.serial && byId('online-search-dialog').open) onlineMessage(searchError(error), true);
    }
  }

  function renderSearchAddDialog() {
    if (!searchAddTarget || !byId('search-add-dialog').open) return;
    const { entry } = searchAddTarget;
    const playlists = state.playlists || [];
    const select = byId('search-add-playlist');
    const selectedId = select.value || state.activePlaylistId;
    const signature = JSON.stringify(playlists.map((playlist) => [playlist.id, playlist.name, entry.additions?.[playlist.id]?.status]));
    if (signature !== searchAddPlaylistSignature) {
      searchAddPlaylistSignature = signature;
      const fragment = document.createDocumentFragment();
      for (const playlist of playlists) {
        const option = document.createElement('option');
        option.value = playlist.id;
        const status = entry.additions?.[playlist.id]?.status;
        const suffix = ({ adding: '加入中…', added: '已加入', exists: '已存在', error: '添加失败' })[status];
        option.textContent = `${playlist.name}${suffix ? ` · ${suffix}` : ''}`;
        fragment.append(option);
      }
      select.replaceChildren(fragment);
      select.value = playlists.some((playlist) => playlist.id === selectedId) ? selectedId : playlists.some((playlist) => playlist.id === state.activePlaylistId) ? state.activePlaylistId : playlists[0]?.id || '';
    }
    const addition = entry.additions?.[select.value];
    const status = byId('search-add-status');
    status.textContent = addition?.error || ({ adding: '加入中…', added: '已加入这个歌单，可继续选择其他歌单', exists: '这个歌单中已存在' })[addition?.status] || (!playlists.length ? '请先创建歌单' : '');
    status.hidden = !status.textContent;
    status.classList.toggle('error', addition?.status === 'error');
    select.disabled = !playlists.length;
    byId('search-add-submit').disabled = !select.value || addition?.status === 'adding';
    byId('search-add-submit').textContent = addition?.status === 'adding' ? '加入中…' : '加入';
  }

  function openSearchAddDialog(platform, entry) {
    if (!byId('online-search-dialog').open) return;
    searchAddTarget = { serial: onlineSearch.serial, platform, entry };
    searchAddPlaylistSignature = '';
    byId('search-add-playlist').replaceChildren();
    byId('search-add-name').textContent = entry.item.title || '未命名歌曲';
    byId('search-add-name').title = `${entry.item.title || '未命名歌曲'} · ${entry.item.artist || '未知作者'}`;
    showDialog('search-add-dialog');
    renderSearchAddDialog();
    byId('search-add-playlist').focus();
  }

  async function addOnlineResult(platform, entry, playlistId) {
    const playlist = (state.playlists || []).find((item) => item.id === playlistId);
    if (!playlist || !byId('online-search-dialog').open) return;
    const serial = onlineSearch.serial;
    if (!entry.additions) entry.additions = Object.create(null);
    if (entry.additions[playlistId]?.status === 'adding') return;
    const addition = { status: 'adding', error: '', message: '' };
    entry.additions[playlistId] = addition;
    renderSearchAddDialog();
    try {
      if (!api?.addSearchResult) throw new Error('搜索连接尚未就绪');
      const result = await api.addSearchResult({ requestId: entry.requestId, platform, id: entry.item.id, playlistId });
      if (!result || result.ok === false) throw new Error(searchError(result?.error || '未能加入歌单'));
      if (serial !== onlineSearch.serial || !byId('online-search-dialog').open) return;
      addition.status = Number(result.added) > 0 ? 'added' : 'exists';
      addition.message = addition.status === 'added' ? `已加入「${playlist.name}」` : `「${playlist.name}」中已存在`;
      onlineMessage(addition.message);
      if (searchAddTarget?.entry === entry && searchAddTarget.serial === serial && byId('search-add-playlist').value === playlistId) byId('search-add-dialog').close();
    } catch (error) {
      if (serial !== onlineSearch.serial || !byId('online-search-dialog').open) return;
      addition.status = 'error';
      addition.error = searchError(error);
      if (!byId('search-add-dialog').open || searchAddTarget?.entry !== entry || byId('search-add-playlist').value !== playlistId) onlineMessage(`未能加入「${playlist.name}」：${addition.error}`, true);
    }
    if (serial === onlineSearch.serial && byId('online-search-dialog').open) renderSearchAddDialog();
  }

  async function playOnlineResult(platform, entry) {
    if (entry.previewing || !byId('online-search-dialog').open) return;
    const serial = onlineSearch.serial;
    entry.previewing = true;
    renderOnlineSearch();
    try {
      if (!api?.playSearchResult) throw new Error('搜索播放连接尚未就绪');
      const result = await api.playSearchResult({ requestId: entry.requestId, platform, id: entry.item.id });
      if (!result || result.ok === false) throw new Error(searchError(result?.error || '暂时无法播放'));
      if (serial === onlineSearch.serial && byId('online-search-dialog').open) onlineMessage(`正在播放「${entry.item.title || '歌曲'}」`);
    } catch (error) {
      if (serial === onlineSearch.serial && byId('online-search-dialog').open) onlineMessage(searchError(error), true);
    } finally {
      entry.previewing = false;
      if (serial === onlineSearch.serial && byId('online-search-dialog').open) renderOnlineSearch();
    }
  }

  function scrollCurrentLyric(smooth = true) {
    const viewport = byId('lyrics-viewport');
    const line = byId('lyrics-lines').children[lyrics.activeIndex];
    if (!line || !byId('lyrics-dialog').open) return;
    const row = line.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + row.top - box.top - (viewport.clientHeight - row.height) / 2), behavior: smooth ? 'smooth' : 'instant' });
  }

  function followLyrics() {
    clearTimeout(lyricsFollowTimer);
    lyrics.manualUntil = 0;
    byId('lyrics-follow').hidden = true;
    scrollCurrentLyric();
  }

  function pauseLyricsFollowing() {
    if (!byId('lyrics-dialog').open || lyrics.status !== 'synced') return;
    lyrics.manualRevision++;
    lyrics.manualUntil = Date.now() + 6000;
    byId('lyrics-follow').hidden = lyrics.activeIndex < 0;
    clearTimeout(lyricsFollowTimer);
    lyricsFollowTimer = setTimeout(() => { if (byId('lyrics-dialog').open) followLyrics(); }, 6000);
  }

  function renderLyricsProgress(force = false) {
    if (!byId('lyrics-dialog').open) return;
    const current = currentTrack();
    const duration = durationFor(current);
    if (!lyricsSeeking) {
      byId('lyrics-seek').max = String(Math.max(1, duration));
      byId('lyrics-seek').value = String(Math.min(duration, Number(state.positionMs) || 0));
      rangeProgress(byId('lyrics-seek'), state.positionMs, duration);
      byId('lyrics-position').textContent = time(state.positionMs);
    }
    byId('lyrics-duration').textContent = time(duration);
    byId('lyrics-seek').disabled = !current || duration <= 0;
    byId('lyrics-play-pause').textContent = isPlaying() ? 'Ⅱ' : '▶';
    byId('lyrics-play-pause').setAttribute('aria-label', isPlaying() ? '暂停' : '播放');
    byId('lyrics-play-pause').disabled = !canPlay();
    byId('lyrics-previous').disabled = !current && !playbackKeys().length;
    byId('lyrics-next').disabled = !current && !playbackKeys().length;
    let active = -1;
    if (lyrics.status === 'synced') {
      for (let index = 0; index < lyrics.lines.length; index++) {
        const stamp = lyrics.lines[index].timeMs;
        if (stamp !== null && stamp <= (Number(state.positionMs) || 0)) active = index;
      }
    }
    if (active !== lyrics.activeIndex || force) {
      lyrics.activeIndex = active;
      [...byId('lyrics-lines').children].forEach((line, index) => {
        line.classList.toggle('active', index === active);
        if (index === active) line.setAttribute('aria-current', 'true'); else line.removeAttribute('aria-current');
      });
      if (Date.now() >= lyrics.manualUntil) scrollCurrentLyric(!force);
    }
    byId('lyrics-follow').hidden = !(Date.now() < lyrics.manualUntil && active >= 0);
  }

  function renderLyricsDocument(message = '') {
    const fragment = document.createDocumentFragment();
    for (const [index, item] of lyrics.lines.entries()) {
      const timed = lyrics.status === 'synced' && item.timeMs !== null;
      const line = document.createElement(timed ? 'button' : 'div');
      line.className = 'lyric-line';
      line.dataset.testid = 'lyric-line';
      line.dataset.index = String(index);
      if (timed) {
        line.type = 'button';
        line.dataset.timeMs = String(item.timeMs);
        line.title = `跳转到 ${time(item.timeMs)}`;
        line.addEventListener('click', async () => {
          if (lyrics.key !== state.currentKey) return;
          const serial = lyrics.serial, key = lyrics.key, manualRevision = lyrics.manualRevision;
          await command('seek', { positionMs: item.timeMs });
          if (serial === lyrics.serial && key === state.currentKey && manualRevision === lyrics.manualRevision) followLyrics();
        });
      }
      const text = document.createElement('span');
      text.textContent = item.text;
      line.append(text);
      if (item.translation) {
        const translation = document.createElement('span');
        translation.className = 'lyric-translation';
        translation.textContent = item.translation;
        line.append(translation);
      }
      fragment.append(line);
    }
    byId('lyrics-lines').replaceChildren(fragment);
    byId('lyrics-message').textContent = message;
    byId('lyrics-message').hidden = !message;
    byId('lyrics-retry').hidden = lyrics.status !== 'error';
    byId('lyrics-viewport').scrollTop = 0;
    renderLyricsProgress(true);
  }

  async function loadLyrics(track = currentTrack()) {
    const serial = ++lyrics.serial;
    clearTimeout(lyricsFollowTimer);
    lyrics.key = track?.key || null;
    lyrics.status = track ? 'loading' : 'unavailable';
    lyrics.lines = [];
    lyrics.activeIndex = -1;
    lyrics.manualUntil = 0;
    byId('lyrics-source').textContent = '';
    renderLyricsDocument(track ? '加载歌词…' : '选择歌曲后查看歌词');
    if (!track) return;
    try {
      if (!api?.getLyrics) throw new Error('歌词连接尚未就绪');
      const result = await api.getLyrics(track.key);
      if (serial !== lyrics.serial || state.currentKey !== track.key || !byId('lyrics-dialog').open) return;
      if (!result || result.ok === false || result.key && result.key !== track.key) throw new Error(searchError(result?.error || '歌词暂时无法加载'));
      if (result.status === 'error') throw new Error(searchError(result.message || '歌词暂时无法加载，请重试'));
      lyrics.status = ['synced', 'plain'].includes(result.status) ? result.status : 'unavailable';
      lyrics.lines = Array.isArray(result.lines) ? result.lines.filter((line) => line && typeof line.text === 'string' && line.text.trim()).map((line) => ({ timeMs: typeof line.timeMs === 'number' && Number.isFinite(line.timeMs) && line.timeMs >= 0 ? line.timeMs : null, text: line.text, translation: typeof line.translation === 'string' ? line.translation : '' })) : [];
      if (!lyrics.lines.length || lyrics.status === 'unavailable') { lyrics.status = 'unavailable'; lyrics.lines = []; }
      byId('lyrics-source').textContent = typeof result.source === 'string' ? result.source : '';
      renderLyricsDocument(lyrics.status === 'unavailable' ? result.message || '暂无歌词' : '');
    } catch (error) {
      if (serial !== lyrics.serial || state.currentKey !== track.key || !byId('lyrics-dialog').open) return;
      lyrics.status = 'error';
      renderLyricsDocument('歌词暂时无法加载');
      byId('lyrics-message').title = searchError(error);
    }
  }

  function renderLyrics(track = currentTrack()) {
    if (!byId('lyrics-dialog').open) return;
    byId('lyrics-track-title').textContent = track ? displayName(track) : '选择歌曲播放';
    byId('lyrics-track-artist').textContent = track?.artist || '';
    const platform = byId('lyrics-track-platform');
    platform.className = `source-tag ${track?.platform || ''}`;
    platform.textContent = platformNames[track?.platform] || '';
    platform.hidden = !track;
    const coverKey = track ? `${track.key}|${track.coverUrl || ''}` : '';
    if (coverKey !== lyrics.coverKey) { coverImage(byId('lyrics-cover'), track); lyrics.coverKey = coverKey; }
    if (lyrics.key !== (track?.key || null) || lyrics.status === 'idle') loadLyrics(track);
    else renderLyricsProgress();
  }

  function openLyrics() {
    if (!currentTrack()) return;
    lyrics.key = null;
    lyrics.status = 'idle';
    showDialog('lyrics-dialog');
    renderLyrics();
  }

  function shareMessage(message = '', error = false) {
    byId('playlist-share-status').textContent = message;
    byId('playlist-share-status').classList.toggle('error', error);
    byId('playlist-share-status').hidden = !message;
  }

  function shareUrl(value) {
    try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
  }

  async function startPlaylistShare() {
    if (shareLoading) return;
    const serial = ++shareSerial;
    shareLoading = true;
    byId('open-playlist-share').disabled = true;
    byId('refresh-playlist-share').disabled = true;
    byId('stop-playlist-share').disabled = true;
    byId('playlist-share-details').hidden = true;
    shareMessage('正在生成链接…');
    try {
      if (!api?.startPlaylistShare) throw new Error('分享连接尚未就绪');
      const result = await api.startPlaylistShare();
      if (!result || result.ok === false) throw new Error(searchError(result?.error || '无法生成链接'));
      const urls = (Array.isArray(result.urls) ? result.urls : []).map((item) => ({ url: shareUrl(item.url), label: String(item.label || '') })).filter((item) => item.url);
      const primary = shareUrl(result.url);
      if (primary && !urls.some((item) => item.url === primary)) urls.unshift({ url: primary, label: '本机地址' });
      if (!urls.length) throw new Error('未找到可用的局域网地址');
      shareResult = { ...result, urls, url: primary || urls[0].url };
      if (serial !== shareSerial || !byId('playlist-share-dialog').open) return;
      const select = byId('playlist-share-address');
      select.replaceChildren();
      for (const item of urls) { const option = document.createElement('option'); option.value = item.url; option.textContent = item.label || new URL(item.url).hostname; select.append(option); }
      select.value = shareResult.url;
      byId('playlist-share-address-choice').hidden = urls.length < 2;
      byId('playlist-share-url').value = shareResult.url;
      byId('playlist-share-counts').textContent = `${Number(result.playlistCount) || 0} 个歌单 · ${Number(result.trackCount) || 0} 首歌曲`;
      const expires = typeof result.expiresAt === 'number' ? result.expiresAt : Date.parse(result.expiresAt);
      byId('playlist-share-expiry').textContent = Number.isFinite(expires) ? `有效至 ${new Date(expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · 保持 MixTunes 打开` : '保持 MixTunes 打开';
      byId('playlist-share-details').hidden = false;
      byId('stop-playlist-share').disabled = false;
      shareMessage();
    } catch (error) {
      if (serial === shareSerial && byId('playlist-share-dialog').open) shareMessage(searchError(error), true);
    } finally {
      shareLoading = false;
      byId('open-playlist-share').disabled = false;
      byId('refresh-playlist-share').disabled = false;
    }
  }

  async function copyPlaylistShare() {
    const input = byId('playlist-share-url');
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(input.value); copied = true; } } catch {}
    if (!copied) { input.focus(); input.select(); try { copied = document.execCommand('copy'); } catch {} }
    shareMessage(copied ? '链接已复制' : '请选中链接复制', !copied);
  }

  async function stopPlaylistShare() {
    if (shareLoading) return;
    const serial = shareSerial;
    shareLoading = true;
    byId('open-playlist-share').disabled = true;
    byId('stop-playlist-share').disabled = true;
    byId('refresh-playlist-share').disabled = true;
    try {
      if (!api?.stopPlaylistShare) throw new Error('分享连接尚未就绪');
      const result = await api.stopPlaylistShare();
      if (result?.ok === false) throw new Error(searchError(result.error || '暂时无法停止分享'));
      shareResult = null;
      if (serial === shareSerial && byId('playlist-share-dialog').open) { byId('playlist-share-details').hidden = true; shareMessage('分享已停止'); }
    } catch (error) {
      if (serial === shareSerial && byId('playlist-share-dialog').open) shareMessage(searchError(error), true);
    } finally {
      shareLoading = false;
      byId('open-playlist-share').disabled = false;
      byId('refresh-playlist-share').disabled = false;
      byId('stop-playlist-share').disabled = !shareResult;
    }
  }

  function renderOnlineSearch() {
    renderSearchTarget();
    const total = Object.values(onlineSearch.platforms).reduce((sum, platform) => sum + platform.entries.length, 0);
    document.querySelectorAll('[data-online-filter]').forEach((button) => {
      const platform = button.dataset.onlineFilter;
      const selected = onlineSearch.filter === platform;
      const record = onlineSearch.platforms[platform];
      let suffix = '';
      if (platform === 'all') suffix = total ? ` ${total}` : '';
      else if (record.status === 'loading' || record.moreLoading) suffix = ' · …';
      else if (record.error) suffix = ' · 失败';
      else if (record.entries.length) suffix = ` ${record.entries.length}`;
      button.textContent = `${platform === 'all' ? '全部' : platformNames[platform]}${suffix}`;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.title = record?.error || (platform === 'all' ? '全部平台' : platformNames[platform]);
    });
    const fragment = document.createDocumentFragment();
    if (!onlineSearch.query) {
      const empty = document.createElement('div');
      empty.className = 'online-search-empty';
      empty.textContent = '输入歌名或作者';
      fragment.append(empty);
      byId('online-search-results').replaceChildren(fragment);
      return;
    }
    for (const platform of Object.keys(platformNames)) {
      if (onlineSearch.filter !== 'all' && onlineSearch.filter !== platform) continue;
      const record = onlineSearch.platforms[platform];
      const section = document.createElement('section');
      section.className = 'online-platform';
      section.dataset.platform = platform;
      section.dataset.testid = `online-platform-${platform}`;
      const heading = document.createElement('div');
      heading.className = 'online-platform-heading';
      const title = document.createElement('h3');
      title.textContent = platformNames[platform];
      const count = document.createElement('span');
      count.className = 'online-platform-count';
      count.textContent = record.entries.length ? `${record.entries.length}${record.total > 0 ? ` / ${record.total}` : ''}` : '';
      heading.append(title, count);
      section.append(heading);
      if (record.entries.length) {
        const items = document.createElement('div');
        items.className = 'online-platform-items';
        for (const entry of record.entries) {
          const item = entry.item;
          const row = document.createElement('div');
          row.className = 'online-result';
          row.dataset.testid = 'online-search-result';
          row.dataset.platform = platform;
          row.dataset.resultId = String(item.id);
          const cover = createButton('', `播放 ${item.title || '歌曲'}`, 'online-result-cover', () => playOnlineResult(platform, entry));
          cover.className = 'online-result-cover';
          cover.dataset.testid = 'online-result-cover';
          cover.disabled = Boolean(entry.previewing);
          coverImage(cover, item, platform === 'bilibili' ? '▷' : '♫');
          const meta = document.createElement('div');
          meta.className = 'online-result-meta';
          const name = createButton('', `播放 ${item.title || '歌曲'}`, 'online-result-title', () => playOnlineResult(platform, entry));
          name.className = 'online-result-title';
          name.textContent = item.title || '未命名歌曲';
          name.title = name.textContent;
          name.disabled = Boolean(entry.previewing);
          name.dataset.testid = 'online-result-title';
          const artist = document.createElement('div');
          artist.className = 'online-result-artist';
          artist.textContent = item.artist || '未知作者';
          artist.title = item.artist || '';
          meta.append(name, artist);
          const source = document.createElement('span');
          source.className = `source-tag ${platform}`;
          source.textContent = platformNames[platform];
          const duration = document.createElement('span');
          duration.className = 'online-result-duration';
          duration.textContent = Number(item.durationMs) > 0 ? time(item.durationMs) : '—';
          const add = createButton('＋', `选择歌单添加 ${item.title || '歌曲'}`, 'online-result-add', () => openSearchAddDialog(platform, entry));
          add.dataset.testid = 'online-result-add';
          const play = createButton(entry.previewing ? '…' : '▶', `播放 ${item.title || '歌曲'}`, 'online-result-play', () => playOnlineResult(platform, entry));
          play.dataset.testid = 'online-result-play';
          play.disabled = Boolean(entry.previewing);
          row.append(cover, meta, source, duration, play, add);
          items.append(row);
        }
        section.append(items);
      }
      if (record.status === 'loading' || record.error || (!record.entries.length && record.status === 'ready')) {
        const status = document.createElement('div');
        status.className = 'online-platform-state';
        status.classList.toggle('error', Boolean(record.error));
        const message = document.createElement('span');
        message.setAttribute('role', 'status');
        message.textContent = record.status === 'loading' ? '加载中…' : record.error ? '暂时无法搜索' : '没有找到结果';
        message.title = record.error || '';
        status.append(message);
        if (record.error || record.status === 'ready' && !record.entries.length) {
          const actions = document.createElement('div');
          actions.className = 'online-platform-state-actions';
          if (record.error) {
            const retryPage = record.failedPage || 1;
            const retry = createButton('重试', `重试${platformNames[platform]}搜索`, '', () => loadOnlinePlatform(platform, retryPage, retryPage > 1));
            retry.dataset.testid = 'online-search-retry';
            actions.append(retry);
          }
          const original = createButton('原站搜索', `在${platformNames[platform]}搜索`, '', () => openOriginalSearch(platform));
          original.dataset.testid = 'online-search-original';
          actions.append(original);
          status.append(actions);
        }
        section.append(status);
      }
      if (record.entries.length && (record.hasMore || record.moreLoading)) {
        const footer = document.createElement('div');
        footer.className = 'online-platform-footer';
        const more = createButton(record.moreLoading ? '加载中…' : '更多', `加载${platformNames[platform]}更多结果`, '', () => loadOnlinePlatform(platform, record.page + 1, true));
        more.dataset.testid = 'online-search-more';
        more.disabled = record.moreLoading || record.page >= 10;
        footer.append(more);
        section.append(footer);
      }
      fragment.append(section);
    }
    byId('online-search-results').replaceChildren(fragment);
  }

  async function loadOnlinePlatform(platform, page, append = false) {
    if (!onlineSearch.query || !byId('online-search-dialog').open || page < 1 || page > 10) return;
    const serial = onlineSearch.serial;
    const record = onlineSearch.platforms[platform];
    if (!record || record.moreLoading) return;
    const requestSequence = ++record.requestSequence;
    const searchQuery = onlineSearch.query;
    record.error = '';
    record.failedPage = null;
    if (append) record.moreLoading = true;
    else { record.status = 'loading'; record.entries = []; record.page = 0; record.hasMore = false; }
    renderOnlineSearch();
    try {
      if (!api?.search) throw new Error('搜索连接尚未就绪');
      const response = await api.search({ query: searchQuery, platform, page });
      if (serial !== onlineSearch.serial || record !== onlineSearch.platforms[platform] || requestSequence !== record.requestSequence || !byId('online-search-dialog').open) return;
      if (!response || response.ok === false) throw new Error(searchError(response?.error || '暂时无法搜索'));
      const result = Array.isArray(response.results) ? response.results.find((value) => value.platform === platform) : null;
      if (!result || result.ok === false) throw new Error(searchError(result?.error || '该平台未返回结果'));
      const requestId = response.requestId === undefined || response.requestId === null ? '' : String(response.requestId);
      const items = Array.isArray(result.items) ? result.items.filter((item) => item && item.platform === platform && item.id !== undefined && item.id !== null && String(item.id) !== '') : [];
      if (items.length && !requestId) throw new Error('搜索结果已失效，请重新搜索');
      const retained = append ? record.entries : [];
      const seenIds = new Set(retained.map((entry) => String(entry.item.id)));
      const entries = [];
      for (const item of items) {
        const id = String(item.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        entries.push({ item, requestId, additions: Object.create(null) });
      }
      record.entries = [...retained, ...entries];
      record.page = page;
      record.total = Math.max(0, Number(result.total) || 0);
      record.hasMore = Boolean(result.hasMore) && page < 10;
      record.status = 'ready';
      record.moreLoading = false;
    } catch (error) {
      if (serial !== onlineSearch.serial || record !== onlineSearch.platforms[platform] || requestSequence !== record.requestSequence || !byId('online-search-dialog').open) return;
      record.error = searchError(error);
      record.failedPage = page;
      record.status = record.entries.length ? 'ready' : 'error';
      record.moreLoading = false;
    }
    if (serial === onlineSearch.serial && byId('online-search-dialog').open) renderOnlineSearch();
  }

  function submitOnlineSearch() {
    const searchQuery = byId('online-search-query').value.trim();
    if (!searchQuery) { onlineMessage('请输入歌名或作者', true); byId('online-search-query').focus(); return; }
    resetOnlineSearch();
    if (!onlineSearch.playlistId) { onlineMessage('请先创建歌单', true); return; }
    onlineSearch.query = searchQuery;
    for (const record of Object.values(onlineSearch.platforms)) record.status = 'loading';
    renderOnlineSearch();
    for (const platform of Object.keys(platformNames)) loadOnlinePlatform(platform, 1);
  }

  function createButton(text, label, className, handler) {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = className;
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', (event) => { event.stopPropagation(); handler(); });
    return button;
  }

  function renderList() {
    const ordered = orderedTracks();
    const positions = new Map((state.queue || []).map((key, index) => [key, index + 1]));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visible = ordered.filter((track) => (filter === 'all' || track.platform === filter) && (!normalizedQuery || `${track.displayTitle || ''} ${track.title || ''} ${track.artist || ''}`.toLocaleLowerCase().includes(normalizedQuery)));
    const signature = JSON.stringify([state.activePlaylistId, visible.map((t) => [t.key, positions.get(t.key), t.title, t.displayTitle, t.artist, t.platform, t.durationMs, t.coverUrl, t.playRange]), state.currentKey, state.status === 'playing', filter, normalizedQuery]);
    byId('track-count').textContent = String(ordered.length);
    byId('queue-summary').textContent = visible.length === ordered.length ? `${ordered.length} 首歌曲` : `${visible.length} / ${ordered.length} 首歌曲`;
    byId('play-all').disabled = !ordered.length;
    byId('clear-library').disabled = !ordered.length;
    byId('track-table').hidden = visible.length === 0;
    byId('empty-state').hidden = visible.length > 0;
    if (!visible.length) {
      byId('empty-title').textContent = ordered.length ? '没有匹配的歌曲' : '还没有歌曲';
      byId('empty-description').replaceChildren();
      byId('empty-description').textContent = ordered.length ? '换个关键词，或查看全部' : '粘贴链接导入';
      byId('focus-import').hidden = ordered.length > 0;
    }
    if (signature === previousListSignature) return;
    previousListSignature = signature;
    const fragment = document.createDocumentFragment();
    visible.forEach((track) => {
      const row = document.createElement('tr');
      row.dataset.key = track.key;
      row.dataset.testid = 'track-row';
      row.draggable = !normalizedQuery && filter === 'all';
      row.classList.toggle('current', state.currentKey === track.key);
      row.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) command('play', { key: track.key, playlistId: state.activePlaylistId }); });
      row.addEventListener('dragstart', (event) => {
        dragKey = track.key;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.key);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        dragKey = null;
        document.querySelectorAll('.dragging, .drop-target').forEach((item) => item.classList.remove('dragging', 'drop-target'));
      });
      row.addEventListener('dragover', (event) => { if (dragKey && dragKey !== track.key) { event.preventDefault(); row.classList.add('drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('drop-target');
        if (!dragKey || dragKey === track.key) return;
        const keys = orderedTracks().map((item) => item.key);
        const from = keys.indexOf(dragKey);
        const to = keys.indexOf(track.key);
        if (from < 0 || to < 0) return;
        keys.splice(from, 1);
        keys.splice(to, 0, dragKey);
        command('reorder', { keys });
        dragKey = null;
      });
      const indexCell = document.createElement('td');
      indexCell.className = 'track-index';
      indexCell.dataset.testid = 'track-index';
      indexCell.textContent = String(positions.get(track.key));
      indexCell.title = `第 ${positions.get(track.key)} 首`;
      const playing = track.key === state.currentKey && state.status === 'playing';
      const rowPlay = createButton(playing ? 'Ⅱ' : '▶', `${playing ? '暂停' : '播放'} ${displayName(track)}`, 'row-play', () => playing ? command('pause') : command('play', { key: track.key, playlistId: state.activePlaylistId }));
      rowPlay.dataset.testid = 'track-play';
      const nameCell = document.createElement('td');
      const song = document.createElement('div');
      song.className = 'song-cell';
      const thumb = document.createElement('div');
      thumb.className = 'song-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      coverImage(thumb, track, track.platform === 'bilibili' ? '▷' : '♫');
      const meta = document.createElement('div');
      meta.className = 'song-meta';
      const title = document.createElement('div');
      title.className = 'song-title';
      title.textContent = displayName(track);
      title.title = track.displayTitle ? `${track.displayTitle}（原名：${track.title}）` : title.textContent;
      const artist = document.createElement('div');
      artist.className = 'song-artist';
      artist.textContent = track.artist || '未知作者';
      meta.append(title, artist);
      song.append(thumb, meta);
      nameCell.append(song);
      const sourceCell = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = `source-tag ${Object.hasOwn(platformNames, track.platform) ? track.platform : ''}`;
      tag.textContent = platformNames[track.platform] || track.platform || '未知来源';
      sourceCell.append(tag);
      const duration = document.createElement('td');
      duration.className = 'track-duration';
      duration.textContent = track.durationMs ? time(track.durationMs) : '—';
      const actions = document.createElement('td');
      const actionGroup = document.createElement('div');
      actionGroup.className = 'row-actions';
      if (track.platform === 'bilibili') {
        const video = createButton('看视频', `观看 ${displayName(track)} 的 B 站视频`, 'row-video', () => command('video-open', { key: track.key, playlistId: state.activePlaylistId }));
        video.dataset.testid = 'track-video';
        actionGroup.append(video);
      }
      const rename = createButton('✎', `修改 ${displayName(track)} 的显示名称`, 'icon-button', () => editTrackName(track));
      rename.dataset.testid = 'track-rename';
      const range = createButton('↔', `编辑 ${displayName(track)} 的播放片段`, 'icon-button row-range', () => editTrackRange(track));
      range.dataset.testid = 'track-range';
      const sourceButton = createButton('↗', `打开 ${track.title || '歌曲'} 原站`, 'icon-button', () => run(() => api.openSource(track.key)));
      sourceButton.dataset.testid = 'track-source';
      const remove = createButton('×', `从歌单移除 ${track.title || '歌曲'}`, 'icon-button remove-track', () => command('remove', { key: track.key }));
      remove.dataset.testid = 'track-remove';
      actionGroup.prepend(rowPlay);
      actionGroup.append(rename, range, sourceButton, remove);
      actions.append(actionGroup);
      row.append(indexCell, nameCell, sourceCell, duration, actions);
      fragment.append(row);
    });
    byId('track-list').replaceChildren(fragment);
  }

  function rangeProgress(element, value, max) {
    element.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, (Number(value) || 0) / (Number(max) || 1) * 100))}%`);
  }

  function accountLabel(value) {
    if (value === true) return '已登录';
    if (value === false) return '未登录';
    if (typeof value === 'string') return ({ loggedIn: '已登录', connected: '已登录', 'session-restored': '已登录', unknown: '未登录', loggedOut: '未登录', expired: '登录已过期', checking: '检查中…' })[value] || value;
    if (value && typeof value === 'object') {
      if (value.status === 'expired') return '登录已过期';
      if (value.loggedIn === false) return '未登录';
      if (value.loggedIn || value.authenticated) return `已登录${value.nickname || value.name ? ` · ${value.nickname || value.name}` : ''}`;
      return ({ checking: '检查中…', loggedOut: '未登录', unknown: '未登录', error: '检查未完成' })[value.status] || '未登录';
    }
    return '未登录';
  }

  function renderQuality(current) {
    for (const platform of Object.keys(platformNames)) {
      const select = byId(`quality-${platform}`);
      const value = state.qualitySettings?.[platform] || 'auto';
      if (!select.disabled) select.value = [...select.options].some((option) => option.value === value) ? value : 'auto';
    }
    byId('quality-playback').hidden = !current;
    const quality = state.playbackQuality;
    const actual = quality && typeof quality.actual === 'string' && quality.actual !== 'unknown' ? quality.actual : '';
    byId('current-quality').textContent = current ? `实际音质：${actual ? quality.label || qualityNames[actual] || actual : '待确认'}` : '';
    byId('current-quality').title = actual ? `当前播放：${quality.label || qualityNames[actual] || actual}` : '播放后确认音质';
    const reason = current && typeof quality?.fallbackReason === 'string' ? quality.fallbackReason : '';
    byId('quality-fallback').hidden = !reason;
    const shortReason = reason.replace(/^平台没有返回(无损|高品质)音源，已使用(.+?)；可检查账号权限和这首歌的可用音质。$/, '$1不可用，已使用$2').replace(/^音频直连不可用，使用官方网页设置$/, '直连不可用，已转原站').replace(/^音频解码或连接失败，使用官方网页设置$/, '连接失败，已转原站');
    byId('quality-fallback').textContent = shortReason;
    byId('quality-fallback').title = reason;
    byId('quality-fallback').setAttribute('aria-label', reason);
  }

  function render(nextState) {
    const previousPlaylistId = state.activePlaylistId;
    if (nextState && typeof nextState === 'object') state = { ...state, ...nextState };
    if (previousPlaylistId !== state.activePlaylistId) {
      resetView();
      if (byId('online-search-dialog').open) resetOnlineSearch('歌单已切换，请重新搜索');
    }
    if (byId('online-search-dialog').open && onlineSearch.playlistId) {
      const target = (state.playlists || []).find((playlist) => playlist.id === onlineSearch.playlistId);
      if (target && target.name !== onlineSearch.playlistName) { onlineSearch.playlistName = target.name; renderSearchTarget(); }
    }
    renderVideoPanel();
    renderPlaylists();
    renderSearchAddDialog();
    renderList();
    const current = currentTrack();
    renderQuality(current);
    byId('current-title').textContent = current ? displayName(current) : '选择歌曲播放';
    byId('current-title').title = current ? displayName(current) : '';
    byId('current-artist').textContent = current ? current.artist || '未知作者' : '';
    byId('current-platform').textContent = current ? platformNames[current.platform] || current.platform : '';
    byId('playback-status').textContent = statusNames[state.status] || state.status || '待播放';
    byId('current-backend').textContent = '';
    byId('current-backend').title = current ? ({ audio: '音频播放', web: '原站播放', video: 'B 站视频' })[state.backend] || '' : '';
    byId('current-backend').hidden = true;
    byId('current-video').hidden = current?.platform !== 'bilibili';
    byId('open-source').disabled = !current;
    byId('current-cover').disabled = !current;
    const coverKey = current ? `${current.key}|${current.coverUrl || ''}` : '';
    if (coverKey !== previousCoverKey) {
      coverImage(byId('current-cover'), current);
      previousCoverKey = coverKey;
    }
    const playing = state.status === 'playing' || state.status === 'buffering' || state.status === 'loading';
    byId('play-pause').textContent = playing ? 'Ⅱ' : '▶';
    byId('play-pause').setAttribute('aria-label', playing ? '暂停' : '播放');
    byId('play-pause').title = playing ? '暂停' : '播放';
    const hasQueue = Boolean(playbackKeys().length || current);
    byId('play-pause').disabled = !canPlay();
    byId('previous').disabled = !hasQueue;
    byId('next').disabled = !hasQueue;
    byId('play-mode').disabled = !canPlay();
    byId('cycle-mode').disabled = !canPlay();
    const duration = durationFor(current);
    renderRange(current);
    if (!seeking) {
      byId('position').textContent = time(state.positionMs);
      byId('seek').max = String(Math.max(1, duration));
      byId('seek').value = String(Math.min(duration, Number(state.positionMs) || 0));
      rangeProgress(byId('seek'), state.positionMs, duration);
    }
    byId('duration').textContent = time(duration);
    byId('seek').disabled = !current || duration <= 0;
    byId('play-mode').value = state.mode;
    byId('cycle-mode').textContent = modeIcons[state.mode] || '→';
    byId('cycle-mode').title = modeNames[state.mode] || '顺序播放';
    byId('cycle-mode').setAttribute('aria-label', `播放模式：${modeNames[state.mode] || '顺序播放'}`);
    renderLyrics(current);
    if (!changingVolume) {
      byId('volume').value = String(state.volume ?? 0.8);
      rangeProgress(byId('volume'), state.muted ? 0 : state.volume, 1);
      byId('volume-value').textContent = state.muted ? '静音' : `${Math.round((state.volume ?? 0.8) * 100)}%`;
    }
    byId('mute').textContent = state.muted ? '◖×' : '◖))';
    byId('mute').title = state.muted ? '取消静音' : '静音';
    byId('mute').setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    for (const platform of Object.keys(platformNames)) {
      const account = state.accounts && state.accounts[platform];
      const label = accountLabel(account);
      const loggedIn = (account === true || ['loggedIn', 'connected', 'session-restored'].includes(account) || Boolean(account?.loggedIn || (account?.loggedIn !== false && account?.authenticated))) && account?.status !== 'expired';
      byId(`account-${platform}`).textContent = label;
      byId(`account-${platform}`).title = account?.status === 'session-restored' ? `已恢复本机音乐会话${account?.message ? `。${account.message}` : ''}` : account?.message || label;
      byId(`account-${platform}`).classList.toggle('verified', loggedIn);
      byId(`login-${platform}`).textContent = loggedIn ? '账号' : '登录';
      byId(`login-${platform}`).title = loggedIn ? '打开官方账号页面' : '打开官方登录页面，可使用平台提供的快捷登录';
    }
    if (state.error && state.error !== lastError) showNotice(state.error, true);
    lastError = state.error || '';
    if (state.notice && state.notice !== lastNotice) showNotice(state.notice);
    lastNotice = state.notice || '';
  }

  byId('import-button').addEventListener('click', async () => {
    const text = byId('import-text').value.trim();
    if (!text) { showNotice('请先粘贴链接'); byId('import-text').focus(); return; }
    const button = byId('import-button');
    importing = true;
    renderPlaylists();
    button.disabled = true;
    button.textContent = '导入中…';
    const result = await run(() => api.importLinks(text));
    if (result !== null) {
      if (!resultMessage(result)) {
        const count = result && (result.added ?? result.imported ?? result.count);
        showNotice(typeof count === 'number' ? `已导入 ${count} 首` : '导入完成');
      }
      byId('import-text').value = '';
      if ((result?.added ?? result?.imported ?? result?.count ?? 0) > 0) {
        resetView();
        renderList();
        byId('track-region').scrollTop = 0;
      }
    }
    importing = false;
    renderPlaylists();
    button.disabled = false;
    button.textContent = '导入';
  });
  byId('import-text').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') byId('import-button').click(); });
  byId('focus-import').addEventListener('click', () => byId('import-text').focus());
  byId('dismiss-notice').addEventListener('click', () => { clearTimeout(noticeTimer); byId('notice').hidden = true; });
  byId('create-playlist').addEventListener('click', () => openPlaylistDialog('create'));
  for (const action of ['rename', 'delete']) byId(`${action}-playlist`).addEventListener('click', () => {
    const id = playlistMenuTargetId;
    closePlaylistMenu(false);
    if (id) openPlaylistDialog(action, id);
  });
  document.addEventListener('pointerdown', (event) => { if (playlistMenuTargetId && !byId('playlist-context-menu').contains(event.target)) closePlaylistMenu(false); });
  document.addEventListener('contextmenu', (event) => { if (playlistMenuTargetId && !byId('playlist-context-menu').contains(event.target)) closePlaylistMenu(false); });
  byId('playlist-list').addEventListener('scroll', () => closePlaylistMenu(false));
  byId('playlist-context-menu').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePlaylistMenu(); return; }
    if (event.key === 'Tab') { closePlaylistMenu(false); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...byId('playlist-context-menu').querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  byId('open-online-search').addEventListener('click', openOnlineSearch);
  byId('close-online-search').addEventListener('click', () => byId('online-search-dialog').close());
  byId('online-search-dialog').addEventListener('close', () => {
    if (byId('search-add-dialog').open) byId('search-add-dialog').close();
    searchAddTarget = null;
    onlineSearch.serial++;
    onlineSearch.playlistId = null;
    onlineSearch.query = '';
    onlineSearch.platforms = emptySearchPlatforms();
  });
  byId('search-add-cancel').addEventListener('click', () => byId('search-add-dialog').close());
  byId('search-add-dialog').addEventListener('close', () => { searchAddTarget = null; searchAddPlaylistSignature = ''; });
  byId('search-add-playlist').addEventListener('change', renderSearchAddDialog);
  byId('search-add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!searchAddTarget || searchAddTarget.serial !== onlineSearch.serial) return;
    addOnlineResult(searchAddTarget.platform, searchAddTarget.entry, byId('search-add-playlist').value);
  });
  byId('current-cover').addEventListener('click', openLyrics);
  byId('close-lyrics').addEventListener('click', () => byId('lyrics-dialog').close());
  byId('lyrics-dialog').addEventListener('close', () => { lyrics.serial++; lyrics.key = null; lyrics.status = 'idle'; clearTimeout(lyricsFollowTimer); lyricsSeeking = false; });
  byId('lyrics-retry').addEventListener('click', () => loadLyrics());
  byId('lyrics-follow').addEventListener('click', followLyrics);
  for (const name of ['wheel', 'touchstart', 'pointerdown']) byId('lyrics-viewport').addEventListener(name, pauseLyricsFollowing, { passive: true });
  byId('lyrics-viewport').addEventListener('keydown', (event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pauseLyricsFollowing(); });
  byId('lyrics-previous').addEventListener('click', () => command('previous'));
  byId('lyrics-next').addEventListener('click', () => command('next'));
  byId('lyrics-play-pause').addEventListener('click', () => isPlaying() ? command('pause') : command('play'));
  byId('lyrics-seek').addEventListener('input', (event) => { lyricsSeeking = true; byId('lyrics-position').textContent = time(event.target.value); rangeProgress(event.target, event.target.value, event.target.max); });
  byId('lyrics-seek').addEventListener('change', (event) => { lyricsSeeking = false; command('seek', { positionMs: Number(event.target.value) }); });
  byId('lyrics-seek').addEventListener('blur', () => { lyricsSeeking = false; renderLyricsProgress(); });
  byId('open-playlist-share').addEventListener('click', () => { showDialog('playlist-share-dialog'); startPlaylistShare(); });
  byId('close-playlist-share').addEventListener('click', () => byId('playlist-share-dialog').close());
  byId('playlist-share-dialog').addEventListener('close', () => { shareSerial++; });
  byId('refresh-playlist-share').addEventListener('click', startPlaylistShare);
  byId('stop-playlist-share').addEventListener('click', stopPlaylistShare);
  byId('copy-playlist-share').addEventListener('click', copyPlaylistShare);
  byId('playlist-share-address').addEventListener('change', (event) => { byId('playlist-share-url').value = event.target.value; shareMessage(); });
  byId('online-search-form').addEventListener('submit', (event) => { event.preventDefault(); submitOnlineSearch(); });
  document.querySelectorAll('[data-online-filter]').forEach((button) => {
    button.addEventListener('click', () => { onlineSearch.filter = button.dataset.onlineFilter; renderOnlineSearch(); });
    button.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll('[data-online-filter]')];
      const index = buttons.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click();
      buttons[next].focus();
    });
  });
  byId('playlist-dialog-cancel').addEventListener('click', () => byId('playlist-dialog').close());
  byId('playlist-dialog').addEventListener('close', () => { playlistDialogAction = null; });
  byId('playlist-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!playlistDialogAction) return;
    const { action, id } = playlistDialogAction;
    const name = byId('playlist-name-input').value.trim();
    if (action !== 'delete' && !name) {
      byId('playlist-dialog-error').textContent = '请输入歌单名称。';
      byId('playlist-dialog-error').hidden = false;
      byId('playlist-name-input').focus();
      return;
    }
    const submit = byId('playlist-dialog-submit');
    submit.disabled = true;
    const result = await command(`playlist-${action}`, action === 'create' ? { name } : action === 'rename' ? { id, name } : { id });
    submit.disabled = false;
    if (result !== null) {
      byId('playlist-dialog').close();
      if (action === 'create') { resetView(); renderList(); byId('import-text').focus(); }
    } else {
      byId('playlist-dialog-error').textContent = byId('notice-text').textContent || '操作未完成，请重试。';
      byId('playlist-dialog-error').hidden = false;
    }
  });
  byId('track-rename-cancel').addEventListener('click', () => byId('track-rename-dialog').close());
  byId('track-rename-dialog').addEventListener('close', () => { renameTrackKey = null; });
  byId('track-rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = renameTrackKey;
    const title = byId('track-name-input').value.trim();
    if (!key) return;
    if (!title || title.length > 500) {
      byId('track-rename-error').textContent = '请输入 1 到 500 个字的显示名称。';
      byId('track-rename-error').hidden = false;
      return;
    }
    const button = byId('track-rename-submit');
    button.disabled = true;
    const result = await command('track-rename', { key, title });
    button.disabled = false;
    if (result !== null) byId('track-rename-dialog').close();
    else { byId('track-rename-error').textContent = '名称未保存，请重试。'; byId('track-rename-error').hidden = false; }
  });
  byId('edit-current-range').addEventListener('click', () => { const track = currentTrack(); if (track) editTrackRange(track); });
  byId('track-range-cancel').addEventListener('click', () => byId('track-range-dialog').close());
  byId('track-range-dialog').addEventListener('close', () => { rangeTrackKey = null; });
  byId('reset-track-range').addEventListener('click', async () => {
    if (!rangeTrackKey) return;
    const result = await command('track-range', { key: rangeTrackKey, startMs: 0, endMs: null });
    if (result !== null) byId('track-range-dialog').close();
  });
  byId('track-range-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const track = (state.tracks || []).find((item) => item.key === rangeTrackKey) || (currentTrack()?.key === rangeTrackKey ? currentTrack() : null);
    if (!track) return;
    const duration = durationFor(track);
    const startMs = Math.round(Number(byId('range-start-seconds').value) * 1000);
    const endValue = byId('range-end-seconds').value.trim();
    let endMs = endValue ? Math.round(Number(endValue) * 1000) : null;
    const actualEnd = endMs ?? (duration || null);
    let error = '';
    if (!Number.isFinite(startMs) || startMs < 0 || (endMs !== null && (!Number.isFinite(endMs) || endMs < 0))) error = '请输入有效的秒数。';
    else if (duration > 0 && (startMs >= duration || (endMs !== null && endMs > duration))) error = '开始和结束位置不能超过原曲时长。';
    else if (actualEnd !== null && actualEnd - startMs < 1000) error = '播放片段至少需要 1 秒。';
    if (error) { byId('track-range-error').textContent = error; byId('track-range-error').hidden = false; return; }
    if (duration && endMs === duration) endMs = null;
    const button = byId('track-range-submit');
    button.disabled = true;
    const result = await command('track-range', { key: track.key, startMs, endMs });
    button.disabled = false;
    if (result !== null) byId('track-range-dialog').close();
    else { byId('track-range-error').textContent = '片段未保存，请重试。'; byId('track-range-error').hidden = false; }
  });
  const commitRange = async () => {
    if (!rangeDraft || rangeSaving) return;
    const draft = { ...rangeDraft };
    rangeSaving = true;
    renderRange(currentTrack());
    await command('track-range', draft);
    rangeDraft = null;
    rangeSaving = false;
    renderRange(currentTrack());
  };
  for (const id of ['range-start', 'range-end']) {
    const input = byId(id);
    input.addEventListener('input', () => {
      const track = currentTrack();
      const duration = durationFor(track);
      if (!track || duration < 1000 || rangeSaving) return;
      let startMs = Math.round(Number(byId('range-start').value));
      let endMs = Math.round(Number(byId('range-end').value));
      if (id === 'range-start') startMs = Math.max(0, Math.min(startMs, endMs - 1000));
      else endMs = Math.min(duration, Math.max(endMs, startMs + 1000));
      rangeDraft = { key: track.key, startMs, endMs: endMs >= duration ? null : endMs };
      renderRange(track);
    });
    input.addEventListener('change', commitRange);
    input.addEventListener('pointerup', commitRange);
  }
  byId('current-video').addEventListener('click', openCurrentVideo);
  byId('toggle-video-panel').addEventListener('click', () => command('video-panel', { open: !state.videoPanel?.open, expanded: false }));
  byId('expand-video-panel').addEventListener('click', () => command('video-panel', { open: true, expanded: true }));
  byId('shrink-video-panel').addEventListener('click', () => command('video-panel', { open: true, expanded: false }));
  byId('close-video-panel').addEventListener('click', () => command('video-panel', { open: false, expanded: false }));
  byId('play-panel-video').addEventListener('click', openCurrentVideo);
  byId('video-login-bilibili').addEventListener('click', () => run(() => api.login('bilibili')));
  for (const platform of Object.keys(platformNames)) byId(`login-${platform}`).addEventListener('click', () => run(() => api.login(platform)));
  byId('refresh-accounts').addEventListener('click', async () => {
    const button = byId('refresh-accounts');
    button.disabled = true;
    button.textContent = '检查中…';
    await command('accounts-refresh');
    button.disabled = false;
    button.textContent = '刷新';
  });
  byId('quit-app').addEventListener('click', () => command('quit'));
  byId('open-quality-settings').addEventListener('click', () => {
    byId('quality-save-status').textContent = '设置自动保存';
    renderQuality((state.tracks || []).find((track) => track.key === state.currentKey));
    showDialog('quality-dialog');
  });
  byId('close-quality-settings').addEventListener('click', () => byId('quality-dialog').close());
  for (const platform of Object.keys(platformNames)) byId(`quality-${platform}`).addEventListener('change', async (event) => {
    const select = event.target;
    const quality = select.value;
    select.disabled = true;
    byId('quality-save-status').textContent = '保存中…';
    const result = await command('quality', { platform, quality });
    select.disabled = false;
    if (result !== null) {
      state.qualitySettings = { ...state.qualitySettings, [platform]: quality };
      byId('quality-save-status').textContent = `${qualityNames[quality]} · 已保存，下次播放生效`;
      byId('quality-save-status').title = '切歌后应用；当前曲目暂停后再播放会从头应用新音质。';
    } else {
      select.value = state.qualitySettings?.[platform] || 'auto';
      byId('quality-save-status').textContent = '保存未完成，请重试。';
    }
  });
  byId('import-file').addEventListener('click', () => withVideoHidden(() => run(() => api.importFile())));
  byId('export-library').addEventListener('click', () => withVideoHidden(() => run(() => api.exportLibrary())));
  byId('play-all').addEventListener('click', () => command('play', { key: orderedTracks()[0]?.key, playlistId: state.activePlaylistId }));
  byId('clear-library').addEventListener('click', () => withVideoHidden(async () => {
    if (window.confirm('清空当前歌单？')) await command('clear');
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    renderList();
  }));
  byId('search-input').addEventListener('input', (event) => { query = event.target.value; renderList(); });
  byId('play-pause').addEventListener('click', () => ['playing', 'buffering', 'loading'].includes(state.status) ? command('pause') : command('play'));
  byId('previous').addEventListener('click', () => command('previous'));
  byId('next').addEventListener('click', () => command('next'));
  byId('open-source').addEventListener('click', () => state.currentKey && run(() => api.openSource(state.currentKey)));
  byId('play-mode').addEventListener('change', (event) => command('mode', { mode: event.target.value }));
  byId('cycle-mode').addEventListener('click', () => command('mode', { mode: modes[(modes.indexOf(state.mode) + 1) % modes.length] }));
  byId('seek').addEventListener('input', (event) => { seeking = true; byId('position').textContent = time(event.target.value); rangeProgress(event.target, event.target.value, event.target.max); });
  byId('seek').addEventListener('change', (event) => { seeking = false; command('seek', { positionMs: Number(event.target.value) }); });
  byId('seek').addEventListener('blur', () => { seeking = false; });
  async function queueVolume(volume, save = false) {
    pendingVolume = { volume, save };
    if (sendingVolume) return;
    sendingVolume = true;
    try {
      while (pendingVolume !== null) {
        const value = pendingVolume; pendingVolume = null;
        await command('volume', value);
      }
    } finally { sendingVolume = false; changingVolume = false; }
  }
  byId('volume').addEventListener('input', (event) => { changingVolume = true; const volume = Number(event.target.value); rangeProgress(event.target, volume, 1); byId('volume-value').textContent = `${Math.round(volume * 100)}%`; queueVolume(volume); });
  byId('volume').addEventListener('change', (event) => { queueVolume(Number(event.target.value), true); });
  byId('volume').addEventListener('blur', event => { queueVolume(Number(event.target.value), true); });
  byId('mute').addEventListener('click', () => command('mute', { muted: !state.muted }));
  document.addEventListener('keydown', (event) => {
    if (playlistMenuTargetId && event.key === 'Escape') { event.preventDefault(); closePlaylistMenu(); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable || hasOpenDialog() || playlistMenuTargetId || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space') { event.preventDefault(); byId('play-pause').click(); }
    if (event.code === 'KeyV' && !event.repeat) { event.preventDefault(); openCurrentVideo(); }
  });

  const videoResizeObserver = new ResizeObserver(scheduleVideoLayout);
  videoResizeObserver.observe(byId('video-surface'));
  videoResizeObserver.observe(byId('workspace'));
  const videoModalObserver = new MutationObserver(scheduleVideoLayout);
  DIALOG_IDS.map(byId).filter(Boolean).forEach((dialog) => {
    videoModalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    dialog.addEventListener('close', scheduleVideoLayout);
    dialog.addEventListener('cancel', scheduleVideoLayout);
  });
  window.addEventListener('resize', () => { closePlaylistMenu(false); scheduleVideoLayout(); });
  byId('toggle-theme')?.addEventListener('click', () => window.mixlinkTheme?.toggle());
  window.addEventListener('mixlink-theme-change', () => { renderThemeButton(); syncNativeTheme(); });
  renderThemeButton();
  syncNativeTheme();
  render();
  if (api) {
    api.onState((newState) => render(newState));
    api.onNotice((notice) => {
      if (typeof notice === 'string') showNotice(notice);
      else if (notice) showNotice(notice.message || notice.error || notice.notice || '', notice.type === 'error' || Boolean(notice.error));
    });
    run(async () => {
      render(await api.getState());
      byId('connection-status').textContent = '已就绪';
      return null;
    });
  } else {
    byId('connection-status').textContent = '请打开 MixTunes.exe';
  }
})();
