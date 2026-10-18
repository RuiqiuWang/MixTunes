'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { closeDecision } = require('../src/window-lifecycle.cjs');

test('closing the window hides it to the tray so playback survives', () => {
  assert.equal(closeDecision({ quitting: false, hasTray: true, backgroundPlayback: true }), 'hide');
});

test('an explicit quit always closes', () => {
  assert.equal(closeDecision({ quitting: true, hasTray: true, backgroundPlayback: true }), 'quit');
});

test('without a tray icon the app must not hide itself', () => {
  // A missing or hidden Windows tray would leave the user with no way back.
  assert.equal(closeDecision({ quitting: false, hasTray: false, backgroundPlayback: true }), 'quit');
});

test('background playback can be turned off', () => {
  assert.equal(closeDecision({ quitting: false, hasTray: true, backgroundPlayback: false }), 'quit');
});

test('the decision defaults to quitting when nothing is supplied', () => {
  assert.equal(closeDecision(), 'quit');
});
