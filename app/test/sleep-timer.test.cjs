'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSleepTimer, validMinutes, shouldPause } = require('../src/sleep-timer.cjs');

function fakeClock(start = 1_000_000) {
  let time = start;
  let nextId = 1;
  const tasks = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay) { const id = nextId++; tasks.set(id, { fn, due: time + Math.max(0, delay) }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      time += ms;
      let again = true;
      while (again) {
        again = false;
        for (const [id, task] of [...tasks]) {
          if (task.due > time) continue;
          tasks.delete(id);
          task.fn();
          again = true;
          break;
        }
      }
    },
    advanceWithoutFiring(ms) { time += ms; },
    pending: () => tasks.size,
    fireAllDue() { for (const [id, task] of [...tasks]) if (task.due <= time) { tasks.delete(id); task.fn(); } }
  };
}

function setup() {
  const clock = fakeClock();
  const expired = [];
  const timer = createSleepTimer({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onExpire: value => expired.push(value) });
  return { clock, timer, expired };
}

test('validMinutes accepts 1 to 240 whole minutes only', () => {
  for (const value of [1, 15, 30, 60, 240]) assert.equal(validMinutes(value), true, String(value));
  for (const value of [0, -1, 1.5, 241, '15', null, undefined, NaN, Infinity]) assert.equal(validMinutes(value), false, String(value));
});

test('preset durations are scheduled on the deadline, not by decrementing', () => {
  for (const minutes of [15, 30, 60]) {
    const { clock, timer, expired } = setup();
    const snapshot = timer.startMinutes(minutes);
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.minutes, minutes);
    assert.equal(snapshot.remainingMs, minutes * 60000);
    assert.equal(clock.pending(), 1);
    clock.advanceWithoutFiring(minutes * 60000 - 1);
    assert.equal(expired.length, 0);
    clock.advance(1);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].minutes, minutes);
    assert.equal(timer.active, false);
    assert.equal(timer.snapshot().active, false);
  }
});

test('a custom duration of 1 to 240 minutes expires exactly once', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(240);
  clock.advance(240 * 60000);
  assert.equal(expired.length, 1);
  clock.advance(60 * 60000);
  assert.equal(expired.length, 1);
});

test('an early callback re-arms for the remaining time without expiring', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(15);
  clock.advance(1000);
  clock.fireAllDue();
  assert.equal(expired.length, 0);
  assert.equal(timer.snapshot().remainingMs, 15 * 60000 - 1000);
  clock.advance(15 * 60000 - 1000);
  assert.equal(expired.length, 1);
});

test('a long suspend expires once on the next callback', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(30);
  clock.advanceWithoutFiring(31 * 60000);
  clock.fireAllDue();
  assert.equal(expired.length, 1);
  assert.equal(expired[0].minutes, 30);
  assert.equal(timer.active, false);
});

test('a clock that moved backwards keeps the timer pending', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(60);
  clock.advanceWithoutFiring(10 * 60000);
  clock.advanceWithoutFiring(-5 * 60000);
  clock.fireAllDue();
  assert.equal(expired.length, 0);
  assert.equal(timer.snapshot().active, true);
  clock.advance(60 * 60000);
  assert.equal(expired.length, 1);
});

test('cancelling removes the deadline and never pauses', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(15);
  assert.equal(timer.cancel(), true);
  assert.equal(timer.cancel(), false);
  assert.equal(timer.active, false);
  assert.equal(clock.pending(), 0);
  clock.advance(60 * 60000);
  assert.equal(expired.length, 0);
});

test('replacing a timer invalidates the old callback', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(15);
  const first = timer.snapshot();
  clock.advanceWithoutFiring(5 * 60000);
  const second = timer.startMinutes(30);
  assert.equal(second.active, true);
  assert.equal(second.minutes, 30);
  assert.equal(second.remainingMs, 30 * 60000);
  assert.notEqual(second.endsAt, first.endsAt);
  assert.equal(clock.pending(), 1);
  clock.advance(15 * 60000);
  assert.equal(expired.length, 0, 'old deadline must not fire after replacement');
  clock.advance(15 * 60000);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].minutes, 30);
});

test('a stale callback cannot expire the replacement', () => {
  const clock = fakeClock();
  const callbacks = [];
  const timer = createSleepTimer({ now: clock.now, setTimeout: (_fn, _delay) => callbacks.push(_fn) - 1, clearTimeout: () => {}, onExpire: () => callbacks.expired = true });
  timer.startMinutes(15);
  const stale = callbacks[0];
  timer.startMinutes(30);
  clock.advanceWithoutFiring(15 * 60000);
  stale();
  assert.equal(callbacks.expired, undefined);
  assert.equal(timer.snapshot().minutes, 30);
});

test('invalid input is rejected without disturbing a running timer', () => {
  const { timer, expired } = setup();
  timer.startMinutes(15);
  const before = timer.snapshot();
  for (const value of [0, 241, 1.5, 'abc', null]) assert.throws(() => timer.startMinutes(value));
  const after = timer.snapshot();
  assert.equal(after.active, true);
  assert.equal(after.endsAt, before.endsAt);
  assert.equal(after.minutes, 15);
  assert.equal(expired.length, 0);
});

test('startMs validates positive finite durations', () => {
  const { timer } = setup();
  assert.throws(() => timer.startMs(0));
  assert.throws(() => timer.startMs(-1));
  assert.throws(() => timer.startMs(NaN));
  assert.equal(timer.active, false);
  const state = timer.startMs(2500);
  assert.equal(state.active, true);
  assert.equal(state.remainingMs, 2500);
});

test('remaining time never goes negative', () => {
  const { clock, timer } = setup();
  timer.startMinutes(1);
  clock.advanceWithoutFiring(2 * 60000);
  assert.equal(timer.snapshot().remainingMs, 0);
});

test('only active playback statuses request a pause', () => {
  for (const status of ['playing', 'buffering', 'loading']) assert.equal(shouldPause(status), true, status);
  for (const status of ['paused', 'idle', 'error', 'ended', undefined, null]) assert.equal(shouldPause(status), false, String(status));
});

test('the expiry callback receives no player state and cannot mutate it', () => {
  const { clock, timer, expired } = setup();
  timer.startMinutes(5);
  clock.advance(5 * 60000);
  assert.deepEqual(Object.keys(expired[0]).sort(), ['expiredAt', 'minutes']);
});
