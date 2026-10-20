'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HistoryStore } = require('../src/history-store.cjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const entry = (id, playedAt = 1000) => ({
  id, platform: 'netease', sourceId: '33894312', key: 'netease:33894312',
  title: '夜曲', artist: '周杰伦', durationMs: 226000, playedAt,
});

test('history store saves atomically and reloads the same entries', t => {
  const dir = tempDir(t);
  const store = new HistoryStore(dir);
  assert.deepEqual(store.load(), []);
  assert.equal(store.save([entry('a', 1000), entry('b', 2000)]), 2);
  assert.equal(fs.existsSync(path.join(dir, 'history.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'history.json.tmp')), false);
  const loaded = new HistoryStore(dir).load();
  assert.deepEqual(loaded.map(item => item.id), ['b', 'a']);
  assert.equal(JSON.stringify(loaded).includes('session'), false);
});

test('history store keeps a corrupt-file copy and returns an empty writable history', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'history.json'), '{ not json');
  const store = new HistoryStore(dir);
  assert.deepEqual(store.load(), []);
  const backups = fs.readdirSync(dir).filter(name => name.startsWith('history.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(store.save([entry('a')]), 1);
  assert.deepEqual(new HistoryStore(dir).load().map(item => item.id), ['a']);
});

test('history store sanitises invalid entries and caps the saved list', t => {
  const dir = tempDir(t);
  const store = new HistoryStore(dir);
  const entries = [
    { platform: 'qq', sourceId: '', playedAt: 1 },
    entry('dupe', 10),
    entry('dupe', 20),
    ...Array.from({ length: 505 }, (_, index) => ({
      id: `bulk-${index}`, platform: 'qq', sourceId: String(index), key: `qq:${index}`, playedAt: index + 1,
    })),
  ];
  store.save(entries);
  const loaded = store.load();
  assert.equal(loaded.length, 500);
  assert.equal(loaded[0].key, 'qq:504');
});

test('history store load propagates only unexpected IO failures', t => {
  const dir = tempDir(t);
  const blocker = path.join(dir, 'history.json');
  fs.mkdirSync(blocker);
  const store = new HistoryStore(dir);
  assert.throws(() => store.load(), /EISDIR|directory/i);
  assert.throws(() => store.save([]), /不会覆盖/);
});

test('failed corruption backup locks saving and preserves the exact original bytes', t => {
  const dir = tempDir(t), file = path.join(dir, 'history.json');
  const original = Buffer.from('{ broken history');
  fs.writeFileSync(file, original);
  const store = new HistoryStore(dir);
  t.mock.method(fs, 'copyFileSync', () => { throw Object.assign(new Error('backup denied'), { code: 'EACCES' }); });
  assert.deepEqual(store.load(), []);
  assert.throws(() => store.save([entry('new')]), /不会覆盖/);
  assert.deepEqual(fs.readFileSync(file), original);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: [entry('restored')] }));
  assert.equal(store.load()[0].id, 'restored');
  assert.equal(store.save([]), 0, 'a successful reload re-enables saving');
});

test('invalid history envelopes are preserved in a backup while valid old formats still load', t => {
  const dir = tempDir(t), store = new HistoryStore(dir);
  let now = 1000; t.mock.method(Date, 'now', () => ++now);
  for (const raw of [null, {}, {entries: 'invalid'}, {schemaVersion: 99, entries: []}]) {
    const text = JSON.stringify(raw); fs.writeFileSync(store.file, text);
    assert.deepEqual(store.load(), []);
    assert.ok(fs.readdirSync(dir).filter(n => n.startsWith('history.json.corrupt-')).some(n => fs.readFileSync(path.join(dir, n), 'utf8') === text));
  }
  for (const raw of [[entry('old')], {entries:[entry('old')]}, {schemaVersion:1, entries:[]}]) {
    fs.writeFileSync(store.file, JSON.stringify(raw));
    assert.deepEqual(store.load().map(e => e.id), Array.isArray(raw) || raw.entries.length ? ['old'] : []);
  }
});
