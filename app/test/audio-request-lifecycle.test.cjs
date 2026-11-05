'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioPlayer } = require('../src/audio-player.cjs');

function fixture(t, fetch) {
  const requests = [], diagnostics = [];
  const session = { fetch: fetch || (async (_url, options) => {
    const request = { signal: options.signal, cancelled: false, headers: options.headers };
    requests.push(request);
    // Deliberately keep the producer open: protocol cancellation may not abort
    // the original Request, and the player must release this response itself.
    const body = new ReadableStream({
      start(controller) { request.body = controller; },
      cancel() { request.cancelled = true; },
    });
    return new Response(body, { status: 206, headers: {
      'content-type': 'audio/mpeg', 'content-range': 'bytes 0-999/1000',
      'content-length': '1000', 'accept-ranges': 'bytes',
    } });
  }) };
  const player = new AudioPlayer({ electron: {}, sessionFor: () => session,
    onEvent() {}, onDiagnostic: event => diagnostics.push(event) });
  player.init = async () => {};
  t.after(() => player.destroy());
  let generation = 0;
  const load = (slot = 0) => player.load({ key: `netease:${++generation}`, platform: 'netease' },
    generation, { url: 'https://m804.music.126.net/test.mp3' }, slot);
  const stream = (entry, options) => player.stream(new Request(`mix-audio://stream/${entry.token}`, options));
  return { player, requests, diagnostics, load, stream };
}

test('repeated song unloads abort upstream requests and cancel unread bodies', async t => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) {
    const entry = await f.load();
    await f.stream(entry);
    f.player.unload(entry);
    assert.equal(f.requests.at(-1).signal.aborted, true);
    assert.equal(f.requests.at(-1).cancelled, true);
  }
  assert.equal(f.player.tokens.size, 0);
});

test('replacing a slot releases its old stream while preserving next-song preload', async t => {
  const f = fixture(t), first = await f.load(0), prepared = await f.load(1);
  await f.stream(first); await f.stream(prepared);
  await f.load(0);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[0].cancelled, true);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.equal(f.requests[1].cancelled, false);
  assert.equal(f.player.tokens.has(prepared.token), true);
  f.player.unload(first);
  assert.equal(f.player.slots.has(0), true, 'late unload must preserve the replacement');
});

test('cancelling one range closes its upstream without cancelling other ranges', async t => {
  const f = fixture(t), entry = await f.load();
  const first = await f.stream(entry, { headers: { Range: 'bytes=0-' } });
  const second = await f.stream(entry, { headers: { Range: 'bytes=500-' } });
  await first.body.cancel();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[0].cancelled, true);
  assert.equal(f.requests[1].signal.aborted, false);
  assert.equal(second.headers.get('content-range'), 'bytes 0-999/1000');
  assert.equal(f.requests[1].headers.get('range'), 'bytes=500-');
  f.player.unload(entry);
  assert.equal(f.requests[1].signal.aborted, true);
  assert.equal(f.requests[1].cancelled, true);
});

test('unload rejects a pending read and releases every range for that song', async t => {
  const f = fixture(t), entry = await f.load();
  const first = await f.stream(entry), second = await f.stream(entry);
  const reader = first.body.getReader();
  const rejected = assert.rejects(reader.read(), { name: 'AbortError' });
  f.player.unload(entry);
  await rejected;
  assert.equal(f.requests.every(request => request.signal.aborted && request.cancelled), true);
  await assert.rejects(second.text(), { name: 'AbortError' });
});

test('incoming request abort also cancels a producer that ignores abort signals', async t => {
  const f = fixture(t), entry = await f.load(), controller = new AbortController();
  const response = await f.stream(entry, { signal: controller.signal });
  const rejected = assert.rejects(response.text(), { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[0].cancelled, true);
});

test('normal completion preserves bytes and headers and detaches abort cleanup', async t => {
  const f = fixture(t), entry = await f.load();
  const response = await f.stream(entry);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-length'), '1000');
  f.requests[0].body.enqueue(new Uint8Array([1, 2, 3]));
  f.requests[0].body.close();
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  f.player.unload(entry);
  assert.equal(f.requests[0].cancelled, false);
});

test('destroy aborts all active slots even with no renderer window', async t => {
  const f = fixture(t);
  await f.stream(await f.load(0)); await f.stream(await f.load(1));
  f.player.destroy();
  assert.equal(f.requests.every(request => request.signal.aborted && request.cancelled), true);
  assert.equal(f.player.tokens.size, 0);
});

test('unload aborts a request awaiting headers without retrying or logging a network fault', async t => {
  let signal, called = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(t, async (_url, options) => {
    signal = options.signal; called++; started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const entry = await f.load();
  const pending = f.stream(entry);
  await ready;
  f.player.unload(entry);
  assert.equal(signal.aborted, true);
  assert.equal((await pending).status, 502);
  assert.equal(called, 1);
  assert.equal(f.diagnostics.some(event => /error/.test(event.type)), false);
});
