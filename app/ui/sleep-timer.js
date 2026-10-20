'use strict';

// Shared settings panel for Windows and Android. The authoritative deadline is
// always owned elsewhere (Electron main process / Android native host); this
// module only renders the remaining time and submits user intent.
((root) => {
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 240;
  const PRESETS = [15, 30, 60];
  const EMPTY = { active: false, endsAt: null, remainingMs: 0, minutes: null };

  function formatRemaining(state) {
    if (!state || !state.active) return '睡眠定时器未开启';
    const total = Math.max(0, Math.ceil(Number(state.remainingMs || 0) / 1000));
    return `睡眠定时器：剩余 ${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, '0')} 秒`;
  }

  function mount({ api, anchor, card = false } = {}) {
    if (!api || typeof api.sleepTimer !== 'function' || !anchor) return null;
    const section = document.createElement('section');
    section.className = 'sleep-timer-settings' + (card ? ' settings-card' : '');
    section.innerHTML =
      (card ? '<h2>睡眠定时器</h2>' : '<h3 class="sleep-timer-title">睡眠定时器</h3>') +
      '<p class="sleep-timer-hint">到达设定时间后自动暂停当前实际播放的内容；切换歌曲、暂停或隐藏窗口不会取消计时。</p>' +
      '<div class="sleep-timer-presets" role="group" aria-label="睡眠定时器预设">' +
      PRESETS.map((minutes) => `<button type="button" data-sleep-minutes="${minutes}">${minutes} 分钟</button>`).join('') +
      '</div>' +
      '<form class="sleep-timer-custom" novalidate>' +
      '<label for="sleep-timer-minutes">自定义分钟（1～240）</label>' +
      '<input id="sleep-timer-minutes" type="number" inputmode="numeric" min="1" max="240" step="1" autocomplete="off" required>' +
      '<button type="submit">设置</button>' +
      '</form>' +
      '<p id="sleep-timer-status" class="sleep-timer-status" role="status" aria-live="polite">睡眠定时器未开启</p>' +
      '<p id="sleep-timer-error" class="sleep-timer-error" role="alert" hidden></p>' +
      '<button type="button" id="sleep-timer-cancel" class="sleep-timer-cancel" hidden>取消定时</button>';
    anchor.before(section);

    const statusNode = section.querySelector('#sleep-timer-status');
    const errorNode = section.querySelector('#sleep-timer-error');
    const cancelButton = section.querySelector('#sleep-timer-cancel');
    const minutesInput = section.querySelector('#sleep-timer-minutes');
    const form = section.querySelector('.sleep-timer-custom');
    const presets = [...section.querySelectorAll('[data-sleep-minutes]')];
    let state = { ...EMPTY };
    let ticker = null;
    let refreshing = false;

    function message(text) {
      errorNode.textContent = text || '';
      errorNode.hidden = !text;
    }

    function stopTicker() {
      if (ticker !== null) { clearInterval(ticker); ticker = null; }
    }

    function paint() {
      if (!state.active) {
        statusNode.textContent = formatRemaining(EMPTY);
        cancelButton.hidden = true;
        stopTicker();
        return;
      }
      cancelButton.hidden = false;
      const remainingMs = Math.max(0, Number(state.endsAt || 0) - Date.now());
      statusNode.textContent = formatRemaining({ ...state, remainingMs });
      if (remainingMs <= 0) { stopTicker(); refresh(); return; }
      if (ticker === null) ticker = setInterval(paint, 500);
    }

    function apply(next) {
      if (next && typeof next === 'object') state = { ...state, ...next, active: Boolean(next.active) };
      paint();
    }

    async function call(action, payload) {
      const result = await api.sleepTimer(action, payload);
      if (result && result.ok === false) throw new Error(result.error || '睡眠定时器操作失败');
      return result || {};
    }

    async function refresh() {
      if (refreshing) return state;
      refreshing = true;
      try {
        apply(await call('get'));
        message('');
      } catch (error) {
        message(error?.message || '无法读取睡眠定时器状态');
      } finally {
        refreshing = false;
      }
      return state;
    }

    async function setMinutes(minutes) {
      if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
        message('请输入 1～240 的整数分钟');
        return false;
      }
      message('');
      presets.forEach((button) => { button.disabled = true; });
      try {
        apply(await call('set', { minutes }));
        if (state.active) minutesInput.value = String(state.minutes ?? minutes);
        return true;
      } catch (error) {
        message(error?.message || '无法设置睡眠定时器');
        return false;
      } finally {
        presets.forEach((button) => { button.disabled = false; });
      }
    }

    async function cancel() {
      message('');
      cancelButton.disabled = true;
      try {
        apply(await call('cancel'));
        return true;
      } catch (error) {
        message(error?.message || '无法取消睡眠定时器');
        return false;
      } finally {
        cancelButton.disabled = false;
      }
    }

    presets.forEach((button) => button.addEventListener('click', () => setMinutes(Number(button.dataset.sleepMinutes))));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const minutes = minutesInput.valueAsNumber;
      if (!Number.isInteger(minutes)) { message('请输入 1～240 的整数分钟'); return; }
      setMinutes(minutes);
    });
    cancelButton.addEventListener('click', () => cancel());
    const unsubscribe = typeof api.onSleepTimer === 'function' ? api.onSleepTimer((next) => apply(next)) : null;
    const onVisibility = () => { if (!document.hidden) refresh(); };
    const onExpired = () => { refresh(); };
    const onExternalRefresh = () => { refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('mix-sleep-timer-expired', onExpired);
    window.addEventListener('mix-sleep-timer-refresh', onExternalRefresh);
    refresh();

    return {
      refresh,
      setMinutes,
      cancel,
      state: () => ({ ...state }),
      destroy() {
        stopTicker();
        unsubscribe?.();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('mix-sleep-timer-expired', onExpired);
        window.removeEventListener('mix-sleep-timer-refresh', onExternalRefresh);
        section.remove();
      }
    };
  }

  root.mixTunesSleepTimer = Object.freeze({ mount, formatRemaining, MIN_MINUTES, MAX_MINUTES, PRESETS });
})(typeof window !== 'undefined' ? window : globalThis);
