'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TrackExporter, sanitizeFileName, baseFileName, extensionFor } = require('../src/track-export.cjs');

const track = (overrides = {}) => ({
  key: 'netease:1',
  platform: 'netease',
  sourceId: '1',
  title: '晴天',
  artist: '周杰伦',
  url: 'https://music.163.com/song?id=1',
  ...overrides,
});

function fakeResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    body,
  };
}

function rig(t, { handlers } = {}) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.mixtunes-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen = [];
  const exporter = new TrackExporter({
    directory,
    maxBytes: 64 * 1024,
    contextFor: (platform) => ({ platform }),
    resolveTrack: async (item) => ({ url: `https://cdn.example/${item.key}.mp3`, codec: 'mp3', headers: { referer: 'https://music.163.com/' } }),
    fetchMedia: async (url) => {
      seen.push(url);
      if (handlers && handlers[url]) return handlers[url]();
      return fakeResponse(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('audio-bytes')); controller.close(); } }), { headers: { 'content-length': '11' } });
    },
  });
  return { exporter, directory, seen };
}

test('file names drop everything Windows rejects', () => {
  assert.equal(sanitizeFileName('A/B:C*D?E"F<G>H|I', 'x'), 'A_B_C_D_E_F_G_H_I');
  assert.equal(sanitizeFileName('   ', '未知作者'), '未知作者');
  assert.equal(sanitizeFileName('...名.字...', 'x'), '名.字');
  assert.equal(sanitizeFileName('很'.repeat(200), 'x').length, 110);
});

test('the exported name is author - title, honouring renames', () => {
  assert.equal(baseFileName(track()), '周杰伦 - 晴天');
  assert.equal(baseFileName(track({ displayTitle: '晴天（现场）' })), '周杰伦 - 晴天（现场）');
  assert.equal(baseFileName(track({ artist: '', title: '' })), '未知作者 - 未命名');
});

test('extension follows the codec and falls back to the URL suffix', () => {
  assert.equal(extensionFor({ codec: 'flac', url: 'https://x/y' }), 'flac');
  assert.equal(extensionFor({ codec: 'aac', url: 'https://x/y' }), 'm4a');
  assert.equal(extensionFor({ url: 'https://x/y.m4a?auth_key=1' }), 'm4a');
  assert.equal(extensionFor({ url: 'https://x/y' }), 'mp3');
});

test('ensure downloads once and then reuses the same file', async (t) => {
  const { exporter, seen } = rig(t);
  const first = await exporter.ensure(track());
  assert.equal(first.cached, false);
  assert.equal(seen.length, 1);
  assert.ok(fs.existsSync(first.path));
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'audio-bytes');

  const second = await exporter.ensure(track());
  assert.equal(second.cached, true);
  assert.equal(second.path, first.path);
  assert.equal(seen.length, 1, 'a cached track must not be downloaded again');
});

test('concurrent ensure calls share one download', async (t) => {
  const { exporter, seen } = rig(t);
  const [a, b] = await Promise.all([exporter.ensure(track()), exporter.ensure(track())]);
  assert.deepEqual(a, b);
  assert.equal(seen.length, 1);
});

test('the exported file keeps a readable name', async (t) => {
  const { exporter } = rig(t);
  const { path: file } = await exporter.ensure(track({ title: '晴天', artist: '周杰伦' }));
  assert.equal(path.basename(file), '周杰伦 - 晴天.mp3');
});

test('a failing primary URL falls through to the alternatives', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.mixtunes-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen = [];
  const exporter = new TrackExporter({
    directory,
    contextFor: () => ({}),
    resolveTrack: async () => ({ url: 'https://cdn.example/primary.mp3', alternatives: ['https://cdn.example/fallback.mp3'], codec: 'mp3' }),
    fetchMedia: async (url) => {
      seen.push(url);
      if (url.endsWith('primary.mp3')) return fakeResponse(null, { status: 404 });
      return fakeResponse(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('ok')); controller.close(); } }));
    },
  });
  const { path: file } = await exporter.ensure(track());
  assert.deepEqual(seen, ['https://cdn.example/primary.mp3', 'https://cdn.example/fallback.mp3']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
});

test('an incomplete download leaves nothing behind', async (t) => {
  const { exporter, directory } = rig(t, {
    handlers: {
      'https://cdn.example/netease:1.mp3': () => fakeResponse(new ReadableStream({
        start(controller) { controller.error(new Error('connection reset')); },
      })),
    },
  });
  await assert.rejects(exporter.ensure(track()));
  assert.deepEqual(fs.readdirSync(directory).filter((name) => !name.startsWith('index')), []);
  assert.equal(exporter.cachedPath(track()), null);
});

test('download progress is throttled before it reaches the renderer', () => {
  const messages = [];
  const exporter = new TrackExporter({
    directory: path.join(__dirname, '.mixtunes-progress-'),
    contextFor: () => ({}),
    resolveTrack: async () => ({ url: 'https://cdn.example/x.mp3' }),
    fetchMedia: async () => fakeResponse(new ReadableStream({ start(controller) { controller.close(); } })),
    onProgress: (payload) => messages.push(payload),
  });
  exporter.reportProgress(track(), 5, 10);
  exporter.reportProgress(track(), 6, 10);
  assert.deepEqual(messages, [{ key: 'netease:1', received: 5, total: 10 }], 'the second tick is throttled');
});

test('the oldest cached files are dropped when the cache grows too large', async (t) => {
  const { exporter, directory } = rig(t);
  await exporter.ensure(track({ key: 'one', sourceId: '1', title: '一' }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await exporter.ensure(track({ key: 'two', sourceId: '2', title: '二' }));
  assert.equal(exporter.readyKeys([track({ key: 'one' }), track({ key: 'two' })].map((item) => item)).length, 2);

  // Both cached files are 11 bytes, so a 15-byte budget has to let one of them go.
  exporter.maxBytes = 15;
  exporter.prune();
  const left = fs.readdirSync(directory).filter((name) => name.endsWith('.mp3'));
  assert.equal(left.length, 1, 'only the most recent file survives');
  assert.deepEqual(exporter.readyKeys([track({ key: 'one' })]), []);
  assert.deepEqual(exporter.readyKeys([track({ key: 'two' })]), ['two']);
});

test('the download folder uses its own index and never prunes what the user saved', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.mixtunes-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const make = (options = {}) => new TrackExporter({
    directory,
    contextFor: (platform) => ({ platform }),
    resolveTrack: async (item) => ({ url: `https://cdn.example/${item.key}.mp3`, codec: 'mp3' }),
    fetchMedia: async () => fakeResponse(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('audio-bytes')); controller.close(); } }), { headers: { 'content-length': '11' } }),
    ...options,
  });

  const downloads = make({ indexName: 'downloads.json', autoPrune: false });
  downloads.prune = () => { throw new Error('the download folder must not prune'); };
  const first = await downloads.ensure(track());
  assert.equal(first.cached, false);
  assert.ok(fs.existsSync(path.join(directory, 'downloads.json')), 'downloads get their own index');
  assert.equal(fs.existsSync(path.join(directory, 'index.json')), false, 'the drag cache index stays untouched');
  assert.ok(fs.existsSync(first.path), 'the saved file is kept');

  const again = await downloads.ensure(track());
  assert.equal(again.cached, true, 'a second click reuses the file already on disk');
  assert.equal(again.path, first.path);
});
