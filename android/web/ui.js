'use strict';
(function () {
  var themeKey = 'mixlink-theme';
  if (!window.mixlinkTheme) {
    var savedTheme = 'light';
    try { if (localStorage.getItem(themeKey) === 'dark') savedTheme = 'dark'; } catch (ignore) {}
    var applyTheme = function (value) { savedTheme = value === 'dark' ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', savedTheme); return savedTheme; };
    applyTheme(savedTheme);
    window.mixlinkTheme = Object.freeze({ get: function () { return savedTheme; }, set: function (value) { var previous = savedTheme; applyTheme(value); try { localStorage.setItem(themeKey, savedTheme); } catch (ignore) {} if (previous !== savedTheme) window.dispatchEvent(new CustomEvent('mixlink-theme-change')); return savedTheme; }, toggle: function () { return this.set(savedTheme === 'dark' ? 'light' : 'dark'); } });
  }
  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var platforms = ['qq', 'netease', 'bilibili'];
    var sleepTimerSettings = window.mixTunesSleepTimer?.mount({ api: window.playerAPI, anchor: $('account-list'), card: true });
    var names = { qq: 'QQ 音乐', netease: '网易云', bilibili: 'B 站' };
    var modes = ['sequential', 'repeat-all', 'repeat-one', 'shuffle'];
    var modeNames = { sequential: '顺序播放', 'repeat-all': '列表循环', 'repeat-one': '单曲循环', shuffle: '随机播放' };
    var modeLabels = { sequential: '→ 顺序', 'repeat-all': '↻ 列表', 'repeat-one': '↻ 单曲', shuffle: '⤨ 随机' };
    var state = { tracks: [], playlists: [], queue: [], activePlaylistId: null, currentKey: null, status: 'idle', mode: 'sequential', positionMs: 0, durationMs: 0, volume: .7, muted: false, accounts: {}, qualitySettings: {} };
    var ready = false, screen = 'library', stack = [], focusBeforeSheet = null, noticeTimer = null;
    var filter = '', librarySignature = '', accountSignature = '', sheetSignature = '', searchExistingSignature = '', subscribedApi = null;
    var seeking = false, changingVolume = false, retryCount = 0, retryTimer = null;
    var pendingLocate = null;
    var search = { serial: 0, query: '', filter: 'all', records: {} };
    var lyrics = { serial: 0, key: null, status: 'idle', lines: [], follow: true, activeTime: null, failed: false };
    var pendingVolume = null, sendingVolume = false;
    var selecting = false, selectedKeys = new Set(), visibleKeys = [];
    var lyricsReturnScreen = 'library';
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function element(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
    function button(text, label, action, className) { var node = element('button', className || '', text); node.type = 'button'; node.setAttribute('aria-label', label || text); if (action) node.addEventListener('click', action); return node; }
    function replace(node, children) { clear(node); children.forEach(function (child) { node.appendChild(child); }); }
    function title(track) { return track ? track.displayTitle || track.title || '未命名歌曲' : ''; }
    function findTrack(key) { if (state.currentTrack && state.currentTrack.key === key) return state.currentTrack; return state.tracks.find(function (track) { return track.key === key; }); }
    function current() { return findTrack(state.currentKey); }
    function active() { return state.playlists.find(function (playlist) { return playlist.id === state.activePlaylistId; }) || state.playlists[0]; }
    function duration(track) { return Math.max(0, Number(track && track.key === state.currentKey ? state.durationMs || track.durationMs : track && track.durationMs) || 0); }
    function playing() { return ['playing', 'buffering', 'loading'].indexOf(state.status) !== -1; }
    function time(ms) { var seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); var minutes = Math.floor(seconds / 60); return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + ('0' + minutes % 60).slice(-2) : String(minutes)) + ':' + ('0' + seconds % 60).slice(-2); }
    function toast(message, error) { clearTimeout(noticeTimer); $('notice-text').textContent = String(message || '操作未完成').slice(0, 500); $('notice').classList.toggle('error', Boolean(error)); $('notice').hidden = false; if (!error) noticeTimer = setTimeout(function () { $('notice').hidden = true; }, 3500); }
    async function invoke(method, payload) { var api = window.playerAPI; if (!api || typeof api[method] !== 'function') throw new Error('尚未连接，请稍后重试'); var value = await api[method](payload); if (value && value.ok === false) throw new Error(value.error || '操作未完成'); return value; }
    function command(name, payload) { var api = window.playerAPI; if (!api || typeof api.command !== 'function') return Promise.reject(new Error('尚未连接，请稍后重试')); return Promise.resolve(api.command(name, payload || {})).then(function (value) { if (value && value.ok === false) throw new Error(value.error || '操作未完成'); return value; }); }
    async function run(action, node, message) { var wasDisabled = node && node.disabled; if (node) node.disabled = true; try { var value = await action(); if (message) toast(value && value.message || message); return true; } catch (error) { toast(error.message || error, true); return false; } finally { if (node && document.documentElement.contains(node)) node.disabled = Boolean(wasDisabled); } }
    function cover(node, track, fallback) { clear(node); node.appendChild(document.createTextNode(fallback || '♫')); var source = track && track.coverUrl; if (typeof source !== 'string') return; try { var url = new URL(source); if (url.protocol !== 'https:' && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(source)) return; } catch (ignore) { return; } var img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = source; img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); }); clear(node); node.appendChild(img); }
    function changeScreen(value) { if (screen === 'lyrics' && value !== 'lyrics') { lyrics.serial++; if (lyrics.status === 'loading') lyrics.status = 'idle'; } screen = ['library', 'search', 'settings', 'lyrics'].indexOf(value) !== -1 ? value : 'library'; closeAll(); ['library', 'search', 'settings', 'lyrics'].forEach(function (name) { $('screen-' + name).hidden = name !== screen; }); document.querySelectorAll('[data-screen]').forEach(function (node) { var selected = node.dataset.screen === (screen === 'lyrics' ? lyricsReturnScreen : screen); node.classList.toggle('active', selected); if (selected) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }); $('main-content').scrollTop = 0; if (screen === 'settings') sleepTimerSettings?.refresh(); }
    function finishLocate() {
      var request = pendingLocate;
      if (!request) return;
      var target = window.mixTunesLocatePlaying.target(state);
      if (target.message || target.key !== request.key || target.playlistId !== request.playlistId || target.generation !== request.generation) {
        clearTimeout(request.timer); pendingLocate = null;
        toast(target.message || '播放歌曲已变化，请重新定位。'); return;
      }
      if (!request.ready || state.activePlaylistId !== target.playlistId) return;
      clearTimeout(request.timer); pendingLocate = null;
      filter = ''; $('library-filter').value = '';
      changeScreen('library'); renderLibrary();
      var row = Array.from($('song-list').children).find(function (item) { return item.dataset.key === target.key; });
      if (!row) { toast('当前歌曲已不在歌单中，请重新定位。'); return; }
      $('song-list').querySelectorAll('.located').forEach(function (item) { item.classList.remove('located'); });
      row.tabIndex = -1;
      void row.offsetWidth;
      row.classList.add('located');
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      row.focus({ preventScroll: true });
      toast('已定位到“' + active().name + '”中的当前歌曲。');
    }
    async function locatePlaying() {
      if (pendingLocate) return;
      var target = window.mixTunesLocatePlaying.target(state);
      if (target.message) { toast(target.message); return; }
      var request = Object.assign({}, target, { ready: state.activePlaylistId === target.playlistId });
      pendingLocate = request;
      request.timer = setTimeout(function () {
        if (pendingLocate !== request) return;
        pendingLocate = null; toast('歌单状态尚未更新，请重新定位。');
      }, 5000);
      if (!request.ready) {
        try { await command('playlist-select', { id: target.playlistId }); }
        catch (error) {
          if (pendingLocate === request) { clearTimeout(request.timer); pendingLocate = null; toast(error.message || error, true); }
          return;
        }
        if (pendingLocate !== request) return;
        request.ready = true;
      }
      finishLocate();
    }
    function renderLibrary() {
      var playlist = active(), ordered = (state.queue || []).map(function (key, index) { return { track: state.tracks.find(function (track) { return track.key === key; }), index: index + 1 }; }).filter(function (entry) { return entry.track; });
      $('playlist-title').textContent = playlist ? playlist.name : '我的歌单'; $('queue-count').textContent = ordered.length + ' 首';
      var normalized = filter.trim().toLocaleLowerCase();
      var visible = ordered.filter(function (entry) { var track = entry.track; return !normalized || (title(track) + ' ' + track.title + ' ' + track.artist).toLocaleLowerCase().indexOf(normalized) !== -1; });
      $('library-empty').hidden = visible.length > 0; $('empty-label').textContent = ordered.length ? '当前歌单中没有匹配的歌曲' : '当前歌单还没有歌曲'; $('empty-import').hidden = ordered.length > 0;
      $('empty-description').textContent = ordered.length ? '试试其他关键词。查找未添加的歌曲，请前往“在线搜索”。' : '可导入歌曲，或前往“在线搜索”查找 QQ 音乐、网易云和 Bilibili 的歌曲。';
      visibleKeys = visible.map(function(entry) { return entry.track.key; });
      selectedKeys.forEach(function(key) { if (!ordered.some(function(entry) { return entry.track.key === key; })) selectedKeys.delete(key); });
      $('batch-actions').hidden = !selecting;
      $('batch-manage').textContent = selecting ? '完成选择' : '批量管理';
      $('selected-count').textContent = '已选' + selectedKeys.size + '首';
      $('remove-selected').disabled = !selectedKeys.size;
      $('copy-selected').disabled = !selectedKeys.size;
      $('select-visible').checked = visibleKeys.length > 0 && visibleKeys.every(function(key) { return selectedKeys.has(key); });
      $('select-visible').indeterminate = !$('select-visible').checked && visibleKeys.some(function(key) { return selectedKeys.has(key); });
      $('select-visible').disabled = !visibleKeys.length;
      var signature = JSON.stringify([selecting, Array.from(selectedKeys), state.status, state.activePlaylistId, ordered.map(function (entry) { var t = entry.track; return [t.key, t.title, t.displayTitle, t.artist, t.coverUrl, t.platform]; }), normalized, state.currentKey, playing()]);
      if (signature === librarySignature) return; librarySignature = signature;
      var playlistId = state.activePlaylistId;
      var rows = visible.map(function (entry) {
        var track = entry.track, row = element('div', 'song-row'); row.dataset.key = track.key; row.classList.toggle('current', track.key === state.currentKey);
        var index = element('span', 'song-index', String(entry.index)); index.setAttribute('aria-label', '第 ' + entry.index + ' 首');
        if (selecting) {
          var check = element('input'); check.type = 'checkbox'; check.checked = selectedKeys.has(track.key); check.setAttribute('aria-label', '选择 ' + title(track));
          check.addEventListener('change', function() { check.checked ? selectedKeys.add(track.key) : selectedKeys.delete(track.key); renderLibrary(); }); clear(index); index.appendChild(check);
        }
        if (!selecting && track.key === state.currentKey) {
          clear(index); var bars = element('span', 'playing-bars' + (state.status === 'playing' ? ' animated' : '')); bars.setAttribute('aria-label', state.status === 'playing' ? '正在播放' : '当前歌曲');
          for (var i = 0; i < 3; i++) bars.appendChild(element('i')); index.appendChild(bars);
        }
        var toggle = function () { if (selecting) { selectedKeys.has(track.key) ? selectedKeys.delete(track.key) : selectedKeys.add(track.key); renderLibrary(); return; } run(function () { return command(track.key === state.currentKey && playing() ? 'pause' : 'play', { key: track.key, playlistId: playlistId }); }); };
        var art = button('', '播放 ' + title(track), toggle, 'cover'); art.dataset.trackPlay = track.key; cover(art, track, track.platform === 'bilibili' ? '▷' : '♫'); art.appendChild(element('span', 'play-indicator', track.key === state.currentKey && playing() ? 'Ⅱ' : '▶'));
        var meta = button('', '播放 ' + title(track), toggle, 'song-meta'); meta.dataset.trackPlay = track.key; meta.appendChild(element('span', 'song-title', title(track))); meta.appendChild(element('span', 'song-subtitle', (names[track.platform] || '') + ' · ' + (track.artist || '未知作者')));
        var more = button('⋯', title(track) + ' 的操作', function () { openSheet('track', { key: track.key, playlistId: playlistId }); }, 'icon'); more.dataset.trackMenu = track.key;
        [index, art, meta, more].forEach(function (node) { row.appendChild(node); }); return row;
      }); replace($('song-list'), rows);
    }
    function renderPlayer() {
      var track = current(), max = duration(track), enabled = ready && Boolean(track || (state.playbackQueue || state.queue).length);
      $('current-title').textContent = track ? title(track) : '选择歌曲播放';
      var quality = state.playbackQuality, qualityLabel = quality && quality.actual && quality.actual !== 'unknown' ? quality.label || quality.actual : '';
      $('current-detail').textContent = track ? (track.artist || names[track.platform] || '') + (qualityLabel ? ' · ' + qualityLabel : '') : ' '; $('current-more').disabled = !track;
      var artSignature = track ? track.key + '|' + (track.coverUrl || '') : ''; if ($('current-cover').dataset.signature !== artSignature) { $('current-cover').dataset.signature = artSignature; cover($('current-cover'), track, track && track.platform === 'bilibili' ? '▷' : '♫'); }
      $('current-video').hidden = !track || track.platform !== 'bilibili'; $('current-video').disabled = !ready;
      $('open-lyrics').disabled = !ready || !track;
      $('locate-playing').disabled = !ready;
      $('locate-playing').title = window.mixTunesLocatePlaying.target(state).message || '返回来源歌单并定位当前歌曲';
      $('seek').disabled = !ready || !track || max <= 0; if (!seeking) { $('seek').max = String(Math.max(1, max)); $('seek').value = String(Math.min(max, Number(state.positionMs) || 0)); $('position').textContent = time(state.positionMs); } $('duration').textContent = time(max);
      ['previous', 'play-pause', 'next', 'cycle-mode'].forEach(function (id) { $(id).disabled = !enabled; }); $('edit-range').disabled = !ready || !track;
      var playbackMode = state.playbackMode || state.mode; $('play-pause').textContent = playing() ? 'Ⅱ' : '▶'; $('play-pause').setAttribute('aria-label', playing() ? '暂停' : '播放'); $('cycle-mode').textContent = modeLabels[playbackMode] || modeLabels.sequential; $('cycle-mode').setAttribute('aria-label', '播放模式：' + (modeNames[playbackMode] || modeNames.sequential));
      $('volume').disabled = !ready; $('mute').disabled = !ready; if (!changingVolume) { $('volume').value = String(state.volume); $('volume-value').textContent = state.muted ? '静音' : Math.round(state.volume * 100) + '%'; } $('mute').textContent = state.muted ? '◖×' : '◖))'; $('mute').setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    }
    function accountLabel(account) { if (account === true) return '已登录'; if (account && account.status === 'expired') return '登录已过期'; if (account && account.status === 'checking') return '检查中…'; if (account && (account.status === 'session-restored' || account.verified === false && (account.loggedIn || account.authenticated))) return '会话待验证'; if (account && (account.loggedIn || account.authenticated)) return '已登录' + (account.nickname ? ' · ' + account.nickname : ''); return '未登录'; }
    function renderAccounts() {
      var signature = JSON.stringify([state.accounts, state.qualitySettings, ready]); if (signature === accountSignature) return; accountSignature = signature;
      replace($('account-list'), platforms.map(function (platform) {
        var card = element('section', 'account-card'), heading = element('div', 'account-heading'), meta = element('div', 'account-meta'); meta.appendChild(element('h2', '', names[platform])); var status = element('span', 'account-status', accountLabel(state.accounts[platform])); status.id = 'account-' + platform; meta.appendChild(status);
        var login = button(accountLabel(state.accounts[platform]).indexOf('已登录') === 0 ? '账号' : '登录', names[platform] + ' 官方登录', function () { run(async function () { var value = await invoke('login', platform); toast(value && value.message || (value && value.method === 'official-app' ? '已打开官方应用，请按提示授权' : '请在官方页面登录')); }, login); }); login.id = 'login-' + platform; login.disabled = !ready; heading.appendChild(meta); heading.appendChild(login); card.appendChild(heading);
        var row = element('label', 'quality-row'); row.appendChild(element('span', '', '音质')); var select = element('select'); select.id = 'quality-' + platform; select.setAttribute('aria-label', names[platform] + ' 音质'); var options = platform === 'bilibili' ? ['auto', 'standard'] : ['auto', 'high', 'lossless', 'standard']; var labels = { auto: '自动', high: '高品质', lossless: '无损', standard: '标准' }; options.forEach(function (quality) { var option = element('option', '', labels[quality]); option.value = quality; select.appendChild(option); }); select.value = state.qualitySettings[platform] || 'auto'; select.disabled = !ready; select.addEventListener('change', function () { run(function () { return command('quality', { platform: platform, quality: select.value }); }, select); }); row.appendChild(select); card.appendChild(row); return card;
      }));
    }
    function render(next) {
      var previousId = state.activePlaylistId; if (next && typeof next === 'object') state = Object.assign({}, state, next);
      var recovery = $('library-recovery');
      if (!recovery) { recovery = element('section', 'account-card'); recovery.id = 'library-recovery'; recovery.setAttribute('role', 'alert'); recovery.appendChild(element('p', '', '歌单读取异常，当前为只读。')); recovery.appendChild(button('恢复备份', '恢复歌单备份', function () { run(function () { return invoke('recoverLibrary'); }); })); $('main-content').prepend(recovery); }
      recovery.hidden = !state.libraryRecovery?.locked;
      if (previousId !== state.activePlaylistId) { selecting = false; selectedKeys.clear(); filter = ''; $('library-filter').value = ''; librarySignature = ''; }
      renderLibrary(); renderPlayer(); renderAccounts(); reconcileSearchTargets();
      if (screen === 'lyrics') { var track = current(); if (track && (track.key !== lyrics.key || lyrics.status === 'idle')) loadLyrics(track); else if (!track && lyrics.key !== null) { lyrics.serial++; lyrics.key = null; lyrics.status = 'unavailable'; lyrics.lines = []; lyrics.source = ''; lyrics.message = '选择歌曲播放'; renderLyrics(); } else updateLyricsPosition(false); }
      var top = stack[stack.length - 1]; if (top && (top.type === 'playlists' || top.type === 'target')) { var signature = JSON.stringify([state.playlists, state.activePlaylistId]); if (signature !== sheetSignature) { sheetSignature = signature; renderSheet(); } }
      finishLocate();
    }
    function openLyrics() {
      var track = current(); if (!track) return;
      if (screen !== 'lyrics') lyricsReturnScreen = screen;
      changeScreen('lyrics'); lyrics.follow = true;
      if (lyrics.key !== track.key || lyrics.status === 'idle') loadLyrics(track);
      else { renderLyrics(); updateLyricsPosition(true); }
    }
    async function loadLyrics(track) {
      var key = track.key, serial = ++lyrics.serial;
      lyrics.key = key; lyrics.status = 'loading'; lyrics.lines = []; lyrics.activeTime = null; lyrics.follow = true; lyrics.failed = false; lyrics.message = '读取歌词…'; lyrics.source = ''; renderLyrics();
      try {
        var value = await invoke('getLyrics', key);
        if (serial !== lyrics.serial || !current() || current().key !== key || screen !== 'lyrics') return;
        if (value && value.status === 'error') throw new Error(value.message || '歌词暂时无法加载，请重试');
        if (!value || value.key !== key || ['synced', 'plain', 'unavailable'].indexOf(value.status) === -1) throw new Error('歌词暂时无法读取');
        lyrics.lines = value.status === 'unavailable' ? [] : (Array.isArray(value.lines) ? value.lines : []).slice(0, 10000).filter(function (line) { return line && typeof line.text === 'string'; }).map(function (line) { return { timeMs: value.status === 'synced' && typeof line.timeMs === 'number' && Number.isFinite(line.timeMs) && line.timeMs >= 0 ? line.timeMs : null, text: line.text.slice(0, 5000), translation: typeof line.translation === 'string' ? line.translation.slice(0, 5000) : '' }; });
        lyrics.status = lyrics.lines.length ? value.status : 'unavailable'; lyrics.source = typeof value.source === 'string' ? value.source : '';
        lyrics.message = lyrics.status === 'unavailable' ? value.message || '暂无歌词' : '';
      } catch (error) {
        if (serial !== lyrics.serial || !current() || current().key !== key || screen !== 'lyrics') return;
        lyrics.status = 'unavailable'; lyrics.lines = []; lyrics.message = String(error.message || error).slice(0, 300); lyrics.failed = true;
      }
      renderLyrics(); updateLyricsPosition(true);
    }
    function renderLyrics() {
      var track = current(); $('lyrics-title').textContent = title(track); $('lyrics-artist').textContent = track && track.artist || '';
      var source = lyrics.source; if (!source || platforms.indexOf(source) !== -1 || /^https?:/i.test(source) || source.length > 60) source = track ? names[track.platform] || '' : '';
      $('lyrics-source').textContent = source ? '来自 ' + source : '';
      $('lyrics-message').textContent = lyrics.message || ''; $('lyrics-message').hidden = !lyrics.message; $('lyrics-retry').hidden = lyrics.status !== 'unavailable'; clear($('lyrics-lines'));
      lyrics.lines.forEach(function (line, index) {
        var timed = line.timeMs !== null;
        var node = timed ? button('', '跳转到 ' + time(line.timeMs) + '：' + line.text, function () {
          if (!current() || current().key !== lyrics.key) return;
          lyrics.follow = true; run(async function () { await command('seek', { positionMs: line.timeMs }); updateLyricsPosition(true); });
        }, 'lyric-line') : element('p', 'lyric-line plain');
        node.dataset.lyricIndex = String(index); if (timed) node.dataset.timeMs = String(line.timeMs);
        node.appendChild(element('span', 'lyric-text', line.text)); if (line.translation) node.appendChild(element('span', 'lyric-translation', line.translation)); $('lyrics-lines').appendChild(node);
      });
      updateFollowButton();
    }
    function updateFollowButton() { $('lyrics-follow').hidden = lyrics.follow || !lyrics.lines.some(function (line) { return line.timeMs !== null; }); }
    function updateLyricsPosition(force) {
      if (screen !== 'lyrics' || lyrics.status === 'loading') return;
      var position = Number(state.positionMs) || 0, activeTime = null, first = -1;
      lyrics.lines.forEach(function (line, index) { if (line.timeMs !== null && line.timeMs <= position && (activeTime === null || line.timeMs > activeTime)) { activeTime = line.timeMs; first = index; } });
      var changed = lyrics.activeTime !== activeTime; lyrics.activeTime = activeTime;
      if (changed || force) document.querySelectorAll('[data-lyric-index]').forEach(function (node) { var line = lyrics.lines[Number(node.dataset.lyricIndex)], selected = activeTime !== null && line.timeMs === activeTime; node.classList.toggle('active', selected); if (selected) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current'); });
      updateFollowButton();
      if (lyrics.follow && first >= 0 && (changed || force)) { var key = lyrics.key; requestAnimationFrame(function () { if (screen !== 'lyrics' || !lyrics.follow || lyrics.key !== key) return; var node = $('lyrics-lines').children[first]; if (!node) return; var main = $('main-content'), rect = main.getBoundingClientRect(); main.scrollTop = Math.max(0, main.scrollTop + node.getBoundingClientRect().top - rect.top - rect.height * .38); }); }
    }
    function themeChanged() { var dark = window.mixlinkTheme.get() === 'dark'; $('toggle-theme').textContent = dark ? '☀' : '☾'; $('toggle-theme').setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式'); document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#19191b' : '#f7f7f8'); if (window.playerAPI && typeof window.playerAPI.command === 'function') Promise.resolve(window.playerAPI.command('theme', { theme: dark ? 'dark' : 'light' })).catch(function () {}); }
    async function connect() {
      clearTimeout(retryTimer);
      try {
        var value = await invoke('getState'); if (!value || !Array.isArray(value.tracks)) throw new Error('播放器正在启动'); ready = true; retryCount = 0; $('retry-connect').hidden = true; sleepTimerSettings?.refresh();
        var api = window.playerAPI; if (api !== subscribedApi) { subscribedApi = api; if (typeof api.onState === 'function') api.onState(render); if (typeof api.onNotice === 'function') api.onNotice(function (notice) { toast(typeof notice === 'string' ? notice : notice.message || notice.error || '操作未完成', Boolean(notice && (notice.error || notice.type === 'error'))); }); }
        render(value); themeChanged();
      } catch (error) { ready = false; $('retry-connect').hidden = false; render(); if (retryCount++ < 12) retryTimer = setTimeout(connect, 500); }
    }
    function openSheet(type, data, nested) { if (!stack.length) focusBeforeSheet = document.activeElement; if (!nested) stack = []; stack.push({ type: type, data: data || {} }); sheetSignature = ''; $('sheet-layer').hidden = false; document.querySelector('.app').setAttribute('aria-hidden', 'true'); renderSheet(); }
    function closeSheet() { if (stack.length > 1) { stack.pop(); renderSheet(); } else closeAll(); }
    function closeAll() { stack = []; $('sheet-layer').hidden = true; document.querySelector('.app').removeAttribute('aria-hidden'); if (focusBeforeSheet && document.documentElement.contains(focusBeforeSheet)) focusBeforeSheet.focus(); focusBeforeSheet = null; }
    function sheetAction(text, id, action, danger) { var node = button(text, text, action, 'sheet-action' + (danger ? ' danger' : '')); if (id) node.id = id; $('sheet-body').appendChild(node); return node; }
    function description(text) { $('sheet-body').appendChild(element('p', 'sheet-description', text)); }
    function nameForm(value, max, save, resetValue) {
      var form = element('form', 'sheet-form'), input = element('input'); input.id = 'name-input'; input.type = 'text'; input.maxLength = max; input.value = value; input.required = true; input.setAttribute('aria-label', '名称'); var submit = button('保存', '保存名称', null, 'primary sheet-submit'); submit.id = 'name-submit'; submit.type = 'submit'; form.appendChild(input); form.appendChild(submit); form.addEventListener('submit', async function (event) { event.preventDefault(); if (!input.value.trim()) return; if (await run(function () { return save(input.value.trim()); }, submit)) closeAll(); }); $('sheet-body').appendChild(form); if (resetValue !== undefined) sheetAction('恢复原名', 'restore-track-name', function () { input.value = resetValue; input.focus(); }); input.focus(); input.select();
    }
    function renderSheet() {
      var top = stack[stack.length - 1]; if (!top) return; $('sheet-layer').dataset.sheet = top.type; clear($('sheet-body')); var data = top.data, track, playlist;
      if (top.type === 'playlists') {
        $('sheet-title').textContent = '选择歌单'; state.playlists.forEach(function (entry) { var row = element('div', 'playlist-row'); var select = button('', '打开 ' + entry.name, async function () { if (await run(function () { return command('playlist-select', { id: entry.id }); }, select)) { closeAll(); changeScreen('library'); } }, 'playlist-select'); select.dataset.playlistId = entry.id; select.classList.toggle('active', entry.id === state.activePlaylistId); select.appendChild(element('span', '', entry.name)); select.appendChild(element('small', '', entry.queue.length + ' 首')); var menu = button('⋯', entry.name + ' 的操作', function () { openSheet('playlist-actions', { id: entry.id }, true); }, 'icon playlist-menu'); menu.dataset.playlistId = entry.id; row.appendChild(select); row.appendChild(menu); $('sheet-body').appendChild(row); }); sheetAction('＋ 新建歌单', 'create-playlist', function () { openSheet('playlist-create', {}, true); });
      } else if (top.type === 'playlist-create') { $('sheet-title').textContent = '新建歌单'; nameForm('', 100, function (name) { return command('playlist-create', { name: name }); });
      } else if (top.type === 'playlist-actions' || top.type === 'playlist-rename' || top.type === 'playlist-delete') {
        playlist = state.playlists.find(function (entry) { return entry.id === data.id; }); if (!playlist) { closeAll(); toast('歌单已不存在', true); return; }
        if (top.type === 'playlist-actions') { $('sheet-title').textContent = playlist.name; sheetAction('重命名', 'rename-playlist', function () { openSheet('playlist-rename', data, true); }); var remove = sheetAction('删除歌单', 'delete-playlist', function () { openSheet('playlist-delete', data, true); }, true); remove.disabled = state.playlists.length < 2; }
        else if (top.type === 'playlist-rename') { $('sheet-title').textContent = '重命名歌单'; nameForm(playlist.name, 100, function (name) { return command('playlist-rename', { id: playlist.id, name: name }); }); }
        else { $('sheet-title').textContent = '删除歌单？'; description('将移除「' + playlist.name + '」这份本地歌单。'); sheetAction('取消', 'cancel-delete-playlist', closeSheet); var confirm = sheetAction('删除', 'confirm-delete-playlist', async function () { if (await run(function () { return command('playlist-delete', { id: playlist.id }); }, confirm)) closeAll(); }, true); }
      } else if (top.type === 'track' || top.type === 'track-rename' || top.type === 'range') {
        track = findTrack(data.key); if (!track) { closeAll(); return; }
        if (top.type === 'track') {
          $('sheet-title').textContent = title(track);
          var collected = state.tracks.some(function (entry) { return entry.key === track.key; });
          function actualUnchanged() { if (!data.fromPlayback || state.currentKey === data.key) return true; toast('当前歌曲已切换', true); return false; }
          sheetAction(track.key === state.currentKey && playing() ? '暂停' : '播放', 'action-track-play', function () { closeAll(); if (!actualUnchanged()) return; run(function () { return command(track.key === state.currentKey && playing() ? 'pause' : 'play', data.fromPlayback ? {} : { key: track.key, playlistId: data.playlistId }); }); });
          if (collected) sheetAction('改名', 'action-track-rename', function () { openSheet('track-rename', data, true); });
          sheetAction('播放片段', 'action-track-range', function () { openSheet('range', data, true); });
          if (track.platform === 'bilibili') sheetAction('看视频', 'action-track-video', function () { closeAll(); if (!actualUnchanged()) return; run(function () { return command('video-open', data.fromPlayback ? { key: track.key } : { key: track.key, playlistId: data.playlistId }); }); });
          sheetAction('打开原站', 'action-track-source', function () { run(function () { return invoke('openSource', track.key); }); });
          if (collected && state.queue.indexOf(track.key) !== -1) sheetAction('移出歌单', 'action-track-remove', function () { closeAll(); if (data.playlistId && data.playlistId !== state.activePlaylistId) { toast('歌单已切换', true); return; } run(function () { return command('remove', { key: track.key }); }); }, true);
        }
        else if (top.type === 'track-rename') { $('sheet-title').textContent = '歌曲改名'; description('原名：' + track.title); nameForm(title(track), 500, function (name) { return command('track-rename', { key: track.key, title: name }); }, track.title); }
        else renderRange(track);
      } else if (top.type === 'import') {
        $('sheet-title').textContent = '导入链接'; description('QQ / 网易云歌单、歌曲，B 站视频或收藏夹。可粘贴多条链接。'); var form = element('form', 'sheet-form'), input = element('textarea'); input.id = 'import-links'; input.placeholder = '粘贴链接'; input.setAttribute('aria-label', '导入链接'); input.required = true; var submit = button('导入到当前歌单', '导入到当前歌单', null, 'primary sheet-submit'); submit.id = 'import-submit'; submit.type = 'submit'; form.appendChild(input); form.appendChild(submit); form.addEventListener('submit', async function (event) { event.preventDefault(); if (!input.value.trim()) return; if (await run(function () { return invoke('importLinks', input.value.trim()); }, submit, '导入完成')) closeAll(); }); $('sheet-body').appendChild(form);
      } else if (top.type === 'batch-delete') {
        $('sheet-title').textContent = '移除所选歌曲？'; description('将从当前歌单移除 ' + data.keys.length + ' 首，其他歌单不受影响。已开始的播放队列继续播放。');
        sheetAction('取消', 'cancel-batch-delete', closeSheet);
        var removeBatch = sheetAction('确认移除', 'confirm-batch-delete', async function() {
          if (await run(function() { return command('remove-many', {keys:data.keys, playlistId:data.playlistId}); }, removeBatch)) { selectedKeys.clear(); closeAll(); renderLibrary(); toast('已移除 ' + data.keys.length + ' 首歌曲'); }
        }, true);
      } else if (top.type === 'batch-copy') {
        var source = state.playlists.find(function(p) { return p.id === data.sourceId; });
        if (!source) { closeAll(); toast('来源歌单已不存在', true); return; }
        $('sheet-title').textContent = '选择目标歌单'; description('将「' + source.name + '」中选中的 ' + data.keys.length + ' 首歌曲添加到目标，来源歌单保留。新增歌曲按来源顺序放在目标歌单前部，原有顺序不变。');
        state.playlists.filter(function(p) { return p.id !== source.id; }).forEach(function(target) {
          var add = sheetAction(target.name + ' · ' + target.queue.length + ' 首', null, function() { openSheet('copy-confirm', {sourceId:source.id, targetId:target.id, keys:data.keys}, true); }); add.dataset.copyTarget = target.id;
        });
        if (state.playlists.length < 2) description('请先创建另一张歌单。');
      } else if (top.type === 'copy-confirm') {
        var from = state.playlists.find(function(p) { return p.id === data.sourceId; }), to = state.playlists.find(function(p) { return p.id === data.targetId; });
        if (!from || !to) { closeAll(); toast('歌单已不存在', true); return; }
        $('sheet-title').textContent = '确认添加歌曲'; description('将「' + from.name + '」中选中的 ' + data.keys.length + ' 首添加到「' + to.name + '」，已有歌曲会跳过，来源歌单保留。');
        sheetAction('取消', 'cancel-copy', closeSheet);
        var confirmCopy = sheetAction('添加到目标歌单', 'confirm-copy', async function() { if (await run(function() { return command('copy-many', data); }, confirmCopy, '添加完成')) { selectedKeys.clear(); closeAll(); renderLibrary(); } });
      } else if (top.type === 'target') renderTargets(data.entry);
      if (!$('sheet').contains(document.activeElement)) $('sheet').focus();
    }
    function renderRange(track) {
      $('sheet-title').textContent = '播放片段'; description(title(track) + (duration(track) ? ' · 全长 ' + time(duration(track)) : ' · 时长未知'));
      var max = duration(track), range = track.playRange || { startMs: 0, endMs: null }, form = element('form', 'sheet-form');
      var preview = element('div', 'range-preview'), selection = element('div', 'range-selection'); preview.appendChild(selection); form.appendChild(preview);
      var sliders = {}; ['start', 'end'].forEach(function (kind) { var row = element('label', 'range-slider-row'); row.appendChild(element('span', '', kind === 'start' ? '开始' : '结束')); var input = element('input'); input.type = 'range'; input.id = 'range-' + kind; input.min = '0'; input.max = String(Math.max(max, 1)); input.step = '100'; input.disabled = max < 1000; input.setAttribute('aria-label', kind === 'start' ? '黄色开始指针' : '黄色结束指针'); row.appendChild(input); sliders[kind] = input; form.appendChild(row); });
      var fields = element('div', 'range-values'), inputs = {}; ['start', 'end'].forEach(function (kind) { var label = element('label', '', kind === 'start' ? '开始（秒）' : '结束（秒）'); var input = element('input'); input.type = 'number'; input.min = '0'; input.step = '0.001'; input.id = 'range-' + kind + '-seconds'; input.setAttribute('aria-label', kind === 'start' ? '开始秒数' : '结束秒数，留空到结尾'); if (kind === 'start') input.required = true; else input.placeholder = '留空到结尾'; label.appendChild(input); fields.appendChild(label); inputs[kind] = input; }); form.appendChild(fields);
      var help = element('p', 'range-help', max && max < 1000 ? '不足 1 秒，只能完整播放。' : max ? '至少保留 1 秒。黄色指针也可调整。' : '填写秒数；结束留空将播放到结尾。'); form.appendChild(help); var error = element('p', 'range-error'); error.id = 'range-error'; error.setAttribute('role', 'alert'); form.appendChild(error); var submit = button('保存片段', '保存片段', null, 'primary sheet-submit'); submit.id = 'range-submit'; submit.type = 'submit'; form.appendChild(submit);
      inputs.start.value = String((range.startMs || 0) / 1000); inputs.end.value = range.endMs === null || range.endMs === undefined ? '' : String(range.endMs / 1000);
      function value() { return { startMs: Math.round(Number(inputs.start.value) * 1000), endMs: inputs.end.value.trim() ? Math.round(Number(inputs.end.value) * 1000) : null }; }
      function validate() { var v = value(), end = v.endMs === null ? max || null : v.endMs, message = ''; if (!inputs.start.value.trim() || !Number.isFinite(v.startMs) || v.startMs < 0 || v.endMs !== null && (!Number.isFinite(v.endMs) || v.endMs < 0)) message = '请输入有效的秒数'; else if (!(v.startMs === 0 && v.endMs === null)) { if (max && (v.startMs >= max || v.endMs !== null && v.endMs > max)) message = '不能超过歌曲时长'; else if (end !== null && end - v.startMs < 1000) message = '至少保留 1 秒'; } error.textContent = message; submit.disabled = Boolean(message); sliders.start.value = String(v.startMs || 0); sliders.end.value = String(v.endMs === null ? max || 1 : v.endMs); selection.style.left = (max ? Math.min(100, v.startMs / max * 100) : 0) + '%'; selection.style.width = (max ? Math.max(0, Math.min(100, (end - v.startMs) / max * 100)) : 100) + '%'; return !message; }
      inputs.start.addEventListener('input', validate); inputs.end.addEventListener('input', validate);
      sliders.start.addEventListener('input', function () { var end = value().endMs; if (end === null) end = max; inputs.start.value = String(Math.max(0, Math.min(Number(sliders.start.value), end - 1000)) / 1000); validate(); });
      sliders.end.addEventListener('input', function () { inputs.end.value = String(Math.min(max, Math.max(Number(sliders.end.value), value().startMs + 1000)) / 1000); validate(); });
      form.addEventListener('submit', async function (event) { event.preventDefault(); if (!validate()) return; if (await run(function () { return command('track-range', Object.assign({ key: track.key }, value())); }, submit)) closeAll(); }); $('sheet-body').appendChild(form);
      var reset = sheetAction('完整播放', 'range-reset', async function () { if (await run(function () { return command('track-range', { key: track.key, startMs: 0, endMs: null }); }, reset)) closeAll(); }); validate();
    }
    function newRecords() { var records = {}; platforms.forEach(function (platform) { records[platform] = { entries: [], page: 0, total: 0, hasMore: false, busy: false, error: '', failedPage: 1, sequence: 0 }; }); return records; }
    function normaliseSearchText(value) { return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : ''; }
    function playlistHasSearchMetadata(playlist, item) {
      var name = normaliseSearchText(item.title), artist = normaliseSearchText(item.artist);
      if (!name || !artist) return false;
      var tracks = {};
      (state.tracks || []).forEach(function (track) { tracks[track.key] = track; });
      return (playlist.queue || []).some(function (key) { var track = tracks[key]; return track && normaliseSearchText(track.title) === name && normaliseSearchText(track.artist) === artist; });
    }
    function reconcileSearchTargets() {
      var changed = false;
      platforms.forEach(function (platform) {
        var record = search.records[platform]; if (!record || !record.entries) return;
        record.entries.forEach(function (entry) {
          Object.keys(entry.targets || {}).forEach(function (playlistId) {
            var addition = entry.targets[playlistId];
            var playlist = state.playlists.filter(function (item) { return item.id === playlistId; })[0];
            var stale = !playlist;
            if (!stale && (addition.status === 'added' || addition.status === 'exists')) stale = !addition.key || playlist.queue.indexOf(addition.key) === -1;
            if (!stale && addition.status === 'duplicate') stale = !playlistHasSearchMetadata(playlist, entry.item);
            if (stale) { delete entry.targets[playlistId]; changed = true; }
          });
        });
      });
      var signature = JSON.stringify(platforms.map(function (platform) {
        var record = search.records[platform];
        return (record && record.entries || []).map(function (entry) {
          return [entry.requestId, entry.item.platform, String(entry.item.id), window.mixTunesSearchMatch ? window.mixTunesSearchMatch.playlistsContaining(state.playlists || [], state.tracks || [], entry.item) : []];
        });
      }));
      if (signature !== searchExistingSignature) { searchExistingSignature = signature; changed = true; }
      if (changed && screen === 'search') renderSearch();
    }
    function renderSearch() {
      document.querySelectorAll('[data-search-platform]').forEach(function (node) { var selected = node.dataset.searchPlatform === search.filter; node.classList.toggle('active', selected); node.setAttribute('aria-pressed', String(selected)); });
      clear($('search-results')); if (!search.query) { $('search-results').appendChild(element('div', 'empty', '输入歌名或作者，在线查找 QQ 音乐、网易云和 Bilibili 的歌曲')); return; }
      platforms.forEach(function (platform) {
        if (search.filter !== 'all' && search.filter !== platform) return;
        var record = search.records[platform], section = element('section', 'search-platform'); section.dataset.platform = platform; var heading = element('div', 'search-platform-heading'); heading.appendChild(element('h2', '', names[platform])); heading.appendChild(element('span', '', record.entries.length ? record.entries.length + ' / ' + record.total : '')); section.appendChild(heading);
        record.entries.forEach(function (entry) { var item = entry.item, row = element('div', 'search-result'); row.dataset.platform = platform; row.dataset.resultId = item.id; var art = button('', '播放 ' + (item.title || '歌曲'), function () { playSearchEntry(entry); }, 'cover result-play'); art.dataset.resultPlay = item.id; art.dataset.platform = platform; art.disabled = Boolean(entry.playBusy); art.setAttribute('aria-busy', entry.playBusy ? 'true' : 'false'); cover(art, item, platform === 'bilibili' ? '▷' : '♫'); art.appendChild(element('span', 'play-indicator', entry.playBusy ? '…' : '▶')); var meta = element('div', 'result-meta'); meta.appendChild(element('span', 'result-title', item.title || '未命名歌曲')); meta.appendChild(element('span', 'result-subtitle', (item.artist || '未知作者') + ' · ' + (item.durationMs ? time(item.durationMs) : names[platform]))); var targets = Object.keys(entry.targets || {}).map(function (key) { return entry.targets[key]; });
        var derived = window.mixTunesSearchMatch ? window.mixTunesSearchMatch.playlistsContaining(state.playlists || [], state.tracks || [], item) : [];
        var joinedIds = derived.slice();
        Object.keys(entry.targets || {}).forEach(function (playlistId) {
          var value = entry.targets[playlistId];
          if ((value.status === 'added' || value.status === 'exists') && joinedIds.indexOf(playlistId) === -1) joinedIds.push(playlistId);
        });
        var adding = targets.some(function (value) { return value.status === 'adding'; });
        var joined = joinedIds.length;
        var duplicate = targets.some(function (value) { return value.status === 'duplicate'; });
        var failed = targets.some(function (value) { return value.status === 'error'; });
        var detail = [joined ? '已加入 ' + joined + ' 个歌单' : '', duplicate ? '同名同作者已存在' : '', failed ? '上次添加失败，可重试' : ''].filter(Boolean).join('；');
        var add = button(adding ? '…' : joined ? '✓' : '＋', '为 ' + (item.title || '歌曲') + ' 选择歌单' + (detail ? '（' + detail + '）' : ''), function () { openSheet('target', { entry: entry }); }, 'result-add' + (joined ? ' added-search-result' : ''));
        add.dataset.resultId = item.id; add.dataset.platform = platform; add.dataset.added = String(joined); add.dataset.duplicate = duplicate ? 'true' : 'false'; add.dataset.failed = failed ? 'true' : 'false'; row.appendChild(art); row.appendChild(meta); row.appendChild(add); section.appendChild(row); });
        if (record.busy || record.error || !record.entries.length) { var status = element('div', 'platform-state' + (record.error ? ' error' : ''), record.busy ? '搜索中…' : record.error ? '暂时无法搜索' : '该平台暂无匹配结果，可换关键词或查看原站'); if (record.error) status.title = record.error; if (!record.busy) { var actions = element('div', 'state-actions'); if (record.error) actions.appendChild(button('重试', '重试 ' + names[platform], function () { loadSearch(platform, record.failedPage, record.failedPage > 1); }, 'retry-search')); actions.appendChild(button('原站搜索', '打开 ' + names[platform] + ' 原站搜索', function () { run(function () { return invoke('openSearch', { platform: platform, query: search.query }); }); }, 'original-search')); status.appendChild(actions); } section.appendChild(status); }
        if (record.entries.length && record.hasMore) { var more = button(record.busy ? '搜索中…' : '更多', '加载 ' + names[platform] + ' 更多结果', function () { loadSearch(platform, record.page + 1, true); }, 'more-results'); more.disabled = record.busy || record.page >= 10; section.appendChild(more); } $('search-results').appendChild(section);
      });
    }
    async function playSearchEntry(entry) {
      if (entry.playBusy) return; entry.playBusy = true; renderSearch();
      try { await invoke('playSearchResult', { requestId: entry.requestId, platform: entry.item.platform, id: entry.item.id }); }
      catch (error) { toast(error.message || error, true); }
      entry.playBusy = false; renderSearch();
    }
    async function loadSearch(platform, page, append) {
      var record = search.records[platform], serial = search.serial; if (!record || record.busy || page > 10) return; var sequence = ++record.sequence; record.busy = true; record.error = ''; renderSearch();
      try { var response = await invoke('search', { query: search.query, platform: platform, page: page }); if (serial !== search.serial || record !== search.records[platform] || sequence !== record.sequence) return; var data = response && response.results && response.results.find(function (item) { return item.platform === platform; }); if (!data || !data.ok) throw new Error(data && data.error || '暂时无法搜索'); var requestId = response.requestId; if (data.items && data.items.length && !requestId) throw new Error('搜索结果已失效，请重试'); var known = new Set(append ? record.entries.map(function (entry) { return entry.item.id; }) : []), additions = []; (data.items || []).slice(0, 20).forEach(function (item) { if (!item || item.platform !== platform || !item.id || known.has(item.id)) return; known.add(item.id); additions.push({ item: item, requestId: String(requestId), targets: Object.create(null) }); }); record.entries = append ? record.entries.concat(additions) : additions; record.page = page; record.total = Number(data.total) || record.entries.length; record.hasMore = Boolean(data.hasMore) && page < 10;
      } catch (error) { if (serial !== search.serial || record !== search.records[platform]) return; record.error = String(error.message || error).slice(0, 300); record.failedPage = page; }
      if (serial === search.serial && record === search.records[platform]) { record.busy = false; renderSearch(); }
    }
    function renderTargets(entry) {
      $('sheet-title').textContent = '加入歌单'; description(entry.item.title || '歌曲');
      var derived = window.mixTunesSearchMatch ? window.mixTunesSearchMatch.playlistsContaining(state.playlists || [], state.tracks || [], entry.item) : [];
      state.playlists.forEach(function (playlist) { var stored = entry.targets[playlist.id], status = stored || (derived.indexOf(playlist.id) !== -1 ? { status: 'exists' } : { status: 'idle' }), row = element('div', 'target-row'), name = element('div', 'target-name'); name.appendChild(element('strong', '', playlist.name)); name.appendChild(element('span', '', playlist.queue.length + ' 首' + (playlist.id === state.activePlaylistId ? ' · 当前' : ''))); var label = { adding: '加入中…', added: '已加入', exists: '已存在', duplicate: '同名同作者', error: '重试' }[status.status] || '加入'; var add = button(label, label + '「' + playlist.name + '」', function () { addTarget(entry, playlist.id); }, 'target-add'); add.dataset.targetAdd = playlist.id; add.disabled = ['adding', 'added', 'exists', 'duplicate'].indexOf(status.status) !== -1; row.appendChild(name); row.appendChild(add); $('sheet-body').appendChild(row); if (status.error) $('sheet-body').appendChild(element('p', 'target-error', status.error)); });
    }
    async function addTarget(entry, playlistId) {
      var derived = window.mixTunesSearchMatch ? window.mixTunesSearchMatch.playlistsContaining(state.playlists || [], state.tracks || [], entry.item) : [];
      if (derived.indexOf(playlistId) !== -1) return;
      var existing = entry.targets[playlistId]; if (existing && ['adding', 'added', 'exists', 'duplicate'].indexOf(existing.status) !== -1) return;
      entry.targets[playlistId] = { status: 'adding' }; renderSheet();
      try {
        var value = await invoke('addSearchResult', { requestId: entry.requestId, platform: entry.item.platform, id: entry.item.id, playlistId: playlistId });
        if (value && value.ok === false) throw new Error(value.error || '加入失败');
        var status = value && value.status ? value.status : Number(value.added) > 0 ? 'added' : Number(value.existingKey) > 0 ? 'exists' : Number(value.duplicateMetadata) > 0 ? 'duplicate' : '';
        if (['added', 'exists', 'duplicate'].indexOf(status) === -1) throw new Error('加入未完成，请重试');
        var playlist = state.playlists.filter(function (item) { return item.id === playlistId; })[0];
        var name = playlist ? playlist.name : '歌单';
        entry.targets[playlistId] = { status: status, key: typeof value.key === 'string' ? value.key : '' };
        toast(status === 'added' ? '已加入「' + name + '」' : status === 'exists' ? '「' + name + '」中已存在' : '「' + name + '」中已有同名同作者歌曲，未重复添加');
      } catch (error) { entry.targets[playlistId] = { status: 'error', error: String(error.message || error).slice(0, 300) }; toast(String(error.message || error), true); }
      var top = stack[stack.length - 1]; if (top && top.type === 'target' && top.data.entry === entry) renderSheet();
      renderSearch();
    }
    document.querySelectorAll('[data-screen]').forEach(function (node) { node.addEventListener('click', function () { changeScreen(node.dataset.screen); }); });
    $('toggle-theme').addEventListener('click', function () { window.mixlinkTheme.toggle(); }); window.addEventListener('mixlink-theme-change', themeChanged);
    $('retry-connect').addEventListener('click', function () { retryCount = 0; connect(); }); window.addEventListener('mixtunes-ready', connect);
    $('dismiss-notice').addEventListener('click', function () { $('notice').hidden = true; });
    $('choose-playlist').addEventListener('click', function () { openSheet('playlists'); }); $('open-import').addEventListener('click', function () { openSheet('import'); }); $('empty-import').addEventListener('click', function () { openSheet('import'); });
    $('library-filter').addEventListener('input', function () { filter = $('library-filter').value; renderLibrary(); });
    $('current-more').addEventListener('click', function () { var track = current(); if (track) openSheet('track', { key: track.key, fromPlayback: true }); });
    $('open-lyrics').addEventListener('click', openLyrics);
    $('locate-playing').addEventListener('click', locatePlaying);
    $('close-lyrics').addEventListener('click', function () { changeScreen(lyricsReturnScreen); });
    $('lyrics-retry').addEventListener('click', function () { if (current()) loadLyrics(current()); });
    $('lyrics-follow').addEventListener('click', function () { lyrics.follow = true; updateLyricsPosition(true); });
    function manualLyricsScroll() { if (screen === 'lyrics') { lyrics.follow = false; updateFollowButton(); } }
    $('main-content').addEventListener('wheel', manualLyricsScroll, { passive: true }); $('main-content').addEventListener('touchmove', manualLyricsScroll, { passive: true }); $('main-content').addEventListener('pointermove', function (event) { if (event.buttons === 1) manualLyricsScroll(); });
    $('current-video').addEventListener('click', function () { run(function () { return command('video-open', { key: state.currentKey }); }); });
    $('edit-range').addEventListener('click', function () { if (current()) openSheet('range', { key: state.currentKey }); });
    $('previous').addEventListener('click', function () { run(function () { return command('previous'); }); }); $('next').addEventListener('click', function () { run(function () { return command('next'); }); }); $('play-pause').addEventListener('click', function () { run(function () { return command(playing() ? 'pause' : 'play'); }); }); $('cycle-mode').addEventListener('click', function () { run(function () { return command('mode', { mode: modes[(modes.indexOf(state.playbackMode || state.mode) + 1) % modes.length] }); }); });
    $('seek').addEventListener('input', function () { seeking = true; $('position').textContent = time($('seek').value); }); $('seek').addEventListener('change', async function () { await run(function () { return command('seek', { positionMs: Number($('seek').value) }); }); seeking = false; renderPlayer(); }); $('seek').addEventListener('blur', function () { seeking = false; renderPlayer(); });
    async function queueVolume(value, save) {
      changingVolume = true; pendingVolume = {volume:value, save:!!save, muted:value > 0 ? false : state.muted};
      if (sendingVolume) return; sendingVolume = true;
      try { while (pendingVolume) { var next = pendingVolume; pendingVolume = null; await command('volume', next); } }
      catch(error) { toast(error.message || error, true); }
      finally { sendingVolume = false; changingVolume = false; renderPlayer(); }
    }
    $('volume').addEventListener('input', function() { $('volume-value').textContent = Math.round(Number(this.value)*100) + '%'; queueVolume(Number(this.value), false); });
    $('volume').addEventListener('change', function() { queueVolume(Number(this.value), true); });
    $('volume').addEventListener('blur', function() { if (changingVolume) queueVolume(Number(this.value), true); });
    $('mute').addEventListener('click', function() { run(function() { return command('mute', {muted:!state.muted}); }); });
    $('batch-manage').addEventListener('click', function() { selecting = !selecting; selectedKeys.clear(); renderLibrary(); });
    $('select-visible').addEventListener('change', function() { var checked = this.checked; visibleKeys.forEach(function(key) { checked ? selectedKeys.add(key) : selectedKeys.delete(key); }); renderLibrary(); });
    $('remove-selected').addEventListener('click', function() { if (selectedKeys.size) openSheet('batch-delete', {keys:Array.from(selectedKeys), playlistId:state.activePlaylistId}); });
    $('copy-selected').addEventListener('click', function() { if (selectedKeys.size) openSheet('batch-copy', {sourceId:state.activePlaylistId, keys:Array.from(selectedKeys)}); });
    $('refresh-accounts').addEventListener('click', function () { run(function () { return command('accounts-refresh'); }, $('refresh-accounts')); }); $('import-file').addEventListener('click', function () { run(function () { return invoke('importFile'); }, $('import-file')); }); $('export-library').addEventListener('click', function () { run(function () { return invoke('exportLibrary'); }, $('export-library')); });
    $('transfer-form').addEventListener('submit', function (event) { event.preventDefault(); var url = $('transfer-url').value.trim(); if (!url) return; $('transfer-url').blur(); run(function () { return invoke('importShareLink', url); }, $('transfer-submit'), '导入完成'); });
    $('search-form').addEventListener('submit', function (event) { event.preventDefault(); var query = $('search-query').value.trim(); if (!query) return; if (!ready) { toast('尚未连接，请稍后重试', true); return; } search = { serial: search.serial + 1, query: query, filter: search.filter, records: newRecords() }; platforms.forEach(function (platform) { loadSearch(platform, 1, false); }); });
    document.querySelectorAll('[data-search-platform]').forEach(function (node) { node.addEventListener('click', function () { search.filter = node.dataset.searchPlatform; renderSearch(); }); });
    $('close-sheet').addEventListener('click', closeAll); $('sheet-scrim').addEventListener('click', closeAll);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { if (window.mobileUI.back()) event.preventDefault(); } if (event.key === 'Tab' && stack.length) { var nodes = Array.prototype.filter.call($('sheet').querySelectorAll('button,input,textarea,select,[tabindex="0"]'), function (node) { return !node.disabled && node.getClientRects().length; }); if (nodes.length && event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); } else if (nodes.length && !event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); } } });
    window.mobileUI = Object.freeze({ back: function () { if (stack.length) { closeSheet(); return true; } if (screen === 'lyrics') { changeScreen(lyricsReturnScreen); return true; } if (screen !== 'library') { changeScreen('library'); return true; } return false; }, showScreen: changeScreen, refresh: connect });
    themeChanged(); render(); connect();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
