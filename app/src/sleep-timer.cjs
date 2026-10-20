'use strict';

// A single sleep timer authority. All scheduling is deadline based, so a late
// callback, a suspended process or a clock that moved backwards never needs a
// per-second decrement to stay correct.
const MINUTES_MIN = 1;
const MINUTES_MAX = 240;
// Statuses whose current content still needs an explicit pause when the timer
// expires. A user who already paused must never be resumed by the timer.
const PLAYING_STATUSES = ['playing', 'buffering', 'loading'];

function validMinutes(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= MINUTES_MIN && value <= MINUTES_MAX;
}

function shouldPause(status) {
  return PLAYING_STATUSES.includes(status);
}

function createSleepTimer({ now = () => Date.now(), setTimeout: schedule = setTimeout, clearTimeout: cancelSchedule = clearTimeout, onExpire = () => {} } = {}) {
  let active = null;
  let serial = 0;

  function snapshot() {
    if (!active) return { active: false, endsAt: null, remainingMs: 0, minutes: null };
    const remainingMs = Math.max(0, active.endsAt - now());
    return { active: true, endsAt: active.endsAt, remainingMs, minutes: active.minutes };
  }

  function disarm(entry) {
    if (entry && entry.handle !== null) { cancelSchedule(entry.handle); entry.handle = null; }
  }

  function arm(entry) {
    entry.handle = schedule(() => fire(entry.id), Math.max(0, entry.endsAt - now()));
  }

  function fire(id) {
    const entry = active;
    if (!entry || entry.id !== id) return;
    const remaining = entry.endsAt - now();
    if (remaining > 0) { arm(entry); return; }
    active = null;
    entry.handle = null;
    try { onExpire({ minutes: entry.minutes, expiredAt: now() }); } catch {}
  }

  function startMs(milliseconds) {
    const duration = Number(milliseconds);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('睡眠定时器时长无效');
    disarm(active);
    const entry = { id: ++serial, endsAt: now() + Math.round(duration), handle: null, minutes: Math.round(duration / 60000 * 100) / 100 };
    active = entry;
    arm(entry);
    return snapshot();
  }

  function startMinutes(minutes) {
    if (!validMinutes(minutes)) throw new Error('睡眠定时器需为 1～240 分钟的整数');
    return startMs(Number(minutes) * 60000);
  }

  function cancel() {
    if (!active) return false;
    disarm(active);
    active = null;
    serial++;
    return true;
  }

  return { startMinutes, startMs, cancel, snapshot, get active() { return Boolean(active); } };
}

module.exports = { createSleepTimer, validMinutes, shouldPause, MINUTES_MIN, MINUTES_MAX, PLAYING_STATUSES };
