'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

test('Electron playback, seeking and repeated slot reuse release real HTTP streams',
  { skip: process.platform !== 'linux', timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-audio-network-'));
  let instance;
  t.after(async () => {
    await instance?.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const modulePath = process.env.MIXTUNES_AUDIO_MODULE || path.resolve(__dirname, '../src/audio-player.cjs');
  const main = path.join(directory, 'main.cjs');
  fs.writeFileSync(main, `
    const electron = require('electron');
    const { app, protocol, session } = electron;
    const http = require('node:http');
    const { AudioPlayer } = require(${JSON.stringify(modulePath)});
    app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
    app.disableHardwareAcceleration();
    protocol.registerSchemesAsPrivileged([{ scheme: 'mix-audio', privileges: {
      standard: true, secure: true, stream: true, supportFetchAPI: true
    } }]);
    const f = globalThis.audioNetworkFixture = { ready: false, events: [], diagnostics: [], active: new Set(), requests: 0, closed: 0, peak: 0 };
    f.until = async predicate => {
      const end = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() > end) throw Error('Audio fixture timed out: ' + JSON.stringify({ active: f.active.size, requests: f.requests, last: f.events.slice(-3), diagnostics: f.diagnostics.slice(-5) }));
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    app.whenReady().then(async () => {
      const pcm = Buffer.alloc(44 + 16000 * 2 * 600);
      pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
      pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
      pcm.writeUInt32LE(16000, 24); pcm.writeUInt32LE(32000, 28);
      pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
      pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40);
      f.server = http.createServer((req, res) => {
        const range = /bytes=(\\d+)-(\\d*)/.exec(req.headers.range || '');
        let offset = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), pcm.length - 1) : pcm.length - 1;
        if (offset > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + pcm.length }); res.end(); return; }
        f.requests++; f.active.add(res); f.peak = Math.max(f.peak, f.active.size);
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - offset + 1,
          'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': 'bytes ' + offset + '-' + end + '/' + pcm.length } : {}) });
        const timer = setInterval(() => {
          if (res.writableLength > 128 * 1024) return;
          const next = Math.min(offset + 32768, end + 1);
          res.write(pcm.subarray(offset, next)); offset = next;
          if (offset > end) { clearInterval(timer); res.end(); }
        }, 10);
        res.on('close', () => { clearInterval(timer); f.active.delete(res); f.closed++; });
      });
      await new Promise(resolve => f.server.listen(0, '127.0.0.1', resolve));
      const transport = session.fromPartition('audio-network-test');
      await transport.setProxy({ mode: 'direct' });
      const source = 'http://127.0.0.1:' + f.server.address().port + '/sample.wav';
      const sourceSession = { fetch: async (_url, options) => {
        const response = await transport.fetch(source, { signal: options.signal, headers: { Range: options.headers.get('range') || 'bytes=0-' } }).catch(error => { f.diagnostics.push({ type: 'fixture-transport-error', message: error.stack }); throw error; });
        // The fixture replaces only the transport destination; production URL
        // validation and Range/header handling still run in AudioPlayer.
        return new Response(response.body, { status: response.status, headers: response.headers });
      } };
      f.player = new AudioPlayer({ electron, sessionFor: () => sourceSession, onEvent: event => f.events.push(event), onDiagnostic: event => f.diagnostics.push(event) });
      await f.player.init();
      f.cycle = async index => {
        const entry = await f.player.load({ key: 'netease:' + index, platform: 'netease' }, index,
          { url: 'https://m804.music.126.net/fixture.wav' }, index % 2, 0, true);
        f.player.activate(entry);
        await f.until(() => f.events.some(event => event.token === entry.token && event.type === 'playing'));
        f.player.seek(entry, 120000);
        await f.until(() => f.events.some(event => event.token === entry.token && event.type === 'seeked' && Math.abs(event.positionMs - 120000) < 500));
        await f.until(() => f.active.size <= 4);
        return { active: f.active.size, requests: f.requests, closed: f.closed };
      };
      f.ready = true;
    }).catch(error => { f.error = error.stack; });
    app.on('before-quit', () => { f.player?.destroy(); f.server?.closeAllConnections(); f.server?.close(); });
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  instance = await _electron.launch({
    executablePath: process.env.MIXTUNES_ELECTRON_EXECUTABLE || '/usr/lib/electron43/electron',
    args: [main, '--ozone-platform=wayland'], env, timeout: 30000,
  });
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await instance.evaluate(() => ({ ready: globalThis.audioNetworkFixture?.ready, error: globalThis.audioNetworkFixture?.error }));
    if (state.error) throw Error(state.error);
    if (state.ready) break;
    if (attempt === 199) throw Error('Audio fixture did not initialize');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  for (let index = 1; index <= 12; index++) {
    const state = await instance.evaluate(async (_electron, index) => globalThis.audioNetworkFixture.cycle(index), index);
    assert.ok(state.active <= 4, 'old requests must not accumulate over song changes');
  }
  const result = await instance.evaluate(async () => {
    const f = globalThis.audioNetworkFixture;
    for (const entry of [...f.player.slots.values()]) f.player.unload(entry);
    await f.until(() => f.active.size === 0);
    return { requests: f.requests, closed: f.closed, active: f.active.size,
      playing: new Set(f.events.filter(event => event.type === 'playing').map(event => event.key)).size };
  });
  assert.equal(result.playing, 12);
  assert.equal(result.active, 0);
  assert.equal(result.closed, result.requests);
  console.log('Audio HTTP lifecycle:', JSON.stringify(result));
});
