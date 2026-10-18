'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInput, importResource, resolveTrack, fetchMedia, ProviderError } = require('../src/providers.cjs');

function response(data, status = 200, headers = {}) {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const netSong = id => ({ id, name: 'Song ' + id, ar: [{ name: 'Artist' }], al: { name: 'Album' }, dt: 123000 });
const qqSong = id => ({ songmid: '000000000' + String(id).padStart(5, '0'), songname: 'QQ ' + id, songid: id, interval: 120, singer: [{ name: 'Singer' }], strMediaMid: '00000000000001' });

test('share text parses hash routes, mobile QQ playlists, multiple URLs and duplicates', () => {
  const resources = parseInput('网易云歌单 https://music.163.com/#/playlist?id=123&userid=9， QQ https://i.y.qq.com/n2/m/share/details/taoge.html?id=456 https://music.163.com/playlist?id=123 B站 https://www.bilibili.com/video/BV17x411w7KC?p=3。');
  assert.deepEqual(resources.map(r => [r.platform, r.kind, r.id, r.page]), [['netease', 'playlist', '123', undefined], ['qq', 'playlist', '456', undefined], ['bilibili', 'video', 'BV17x411w7KC', 3]]);
});

test('canonical parser accepts QQ new routes, song routes, and bare BVID', () => {
  assert.equal(parseInput('https://y.qq.com/n/ryqq_v2/playlist/1234567890')[0].id, '1234567890');
  assert.equal(parseInput('https://y.qq.com/n/ryqq/songDetail/002w57E00BGzXn')[0].kind, 'track');
  assert.equal(parseInput('http://music.163.com/song?id=33894312')[0].url, 'https://music.163.com/song?id=33894312');
  assert.equal(parseInput('BV17x411w7KC')[0].id, 'BV17x411w7KC');
  assert.deepEqual(parseInput('https://y.music.163.com/m/song?id=3330630999&userid=9')[0], {
    platform: 'netease', kind: 'track', id: '3330630999', url: 'https://music.163.com/song?id=3330630999',
  });
});

test('parser rejects foreign hosts, credentials, ports and invalid page values', () => {
  for (const url of ['https://music.163.com.evil.test/playlist?id=1', 'https://localhost/playlist?id=1', 'https://evil@music.163.com/playlist?id=1', 'https://music.163.com:999/playlist?id=1', 'https://www.bilibili.com/video/BV17x411w7KC?p=NaN']) {
    assert.throws(() => parseInput(url), ProviderError);
  }
});

test('redirect host validation blocks SSRF before making second request', async () => {
  let calls = 0;
  await assert.rejects(importResource(parseInput('https://b23.tv/abcdef')[0], { fetch: async () => { calls++; return response('', 302, { location: 'http://127.0.0.1/private' }); } }), error => error.code === 'UNSAFE_URL');
  assert.equal(calls, 1);
});

test('shortlink redirects are bounded to five', async () => {
  let calls = 0;
  await assert.rejects(importResource(parseInput('https://b23.tv/abcdef')[0], { fetch: async () => { calls++; return response('', 302, { location: 'https://b23.tv/abcdef' }); } }), error => error.code === 'REDIRECT_LIMIT');
  assert.equal(calls, 6);
});

test('NetEase shortlink follows official mobile song redirect and imports canonical metadata', async () => {
  const calls = [];
  const result = await importResource(parseInput('https://163cn.tv/example')[0], { fetch: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    if (calls.length === 1) return response('', 302, { location: 'https://y.music.163.com/m/song?id=3330630999&userid=9' });
    if (calls.length === 2) return response('<html><title>mobile song</title></html>');
    assert.match(url, /^https:\/\/music\.163\.com\/api\/v3\/song\/detail\?/);
    return response({ code: 200, songs: [netSong(3330630999)] });
  } });
  assert.equal(calls.length, 3);
  assert.equal(result.tracks[0].url, 'https://music.163.com/song?id=3330630999');
  assert.equal(result.tracks[0].sourceId, '3330630999');
  assert.equal(result.expectedCount, 1);
});

test('NetEase mobile-domain allowlist blocks lookalikes, arbitrary subdomains and unsafe redirect ports', async () => {
  for (const destination of ['https://y.music.163.com.evil.test/m/song?id=1', 'https://evil.music.163.com/m/song?id=1', 'https://y.music.163.com:8443/m/song?id=1', 'https://evil@y.music.163.com/m/song?id=1', 'http://127.0.0.1/private']) {
    let calls = 0;
    await assert.rejects(importResource(parseInput('https://163cn.tv/example')[0], { fetch: async () => {
      calls++;
      return response('', 302, { location: destination });
    } }), error => error.code === 'UNSAFE_URL');
    assert.equal(calls, 1);
  }
});

test('netease imports every track ID in original order and fills missing metadata', async () => {
  const fetch = async url => {
    if (url.includes('playlist/detail')) return response({ code: 200, playlist: { name: 'Mix', trackCount: 3, trackIds: [{ id: 3 }, { id: 1 }, { id: 2 }], tracks: [netSong(1)] } });
    const ids = JSON.parse(new URL(url).searchParams.get('ids'));
    assert.deepEqual(ids, ['3', '2']);
    return response({ code: 200, songs: [netSong(2), netSong(3)] });
  };
  const result = await importResource(parseInput('https://music.163.com/playlist?id=12')[0], { fetch });
  assert.deepEqual(result.tracks.map(t => t.sourceId), ['3', '1', '2']);
  assert.equal(result.tracks[0].durationMs, 123000);
  assert.equal(result.tracks[0].extra.neteaseRawSong.id, 3);
  assert.equal(result.expectedCount, 3);
  assert.equal(result.warnings.length, 0);
});

test('netease reports inaccessible playlist entries instead of silent truncation', async () => {
  const fetch = async url => url.includes('playlist/detail')
    ? response({ code: 200, playlist: { name: 'Partial', trackCount: 2, trackIds: [{ id: 1 }, { id: 2 }], tracks: [netSong(1)] } })
    : response({ code: 200, songs: [] });
  const result = await importResource(parseInput('https://music.163.com/playlist?id=1')[0], { fetch });
  assert.equal(result.tracks.length, 1);
  assert.match(result.warnings[0], /2.*1/);
});

test('QQ paginates metadata and retains raw songs for official web playback', async () => {
  const calls = [];
  const result = await importResource(parseInput('https://y.qq.com/n/ryqq/playlist/456')[0], { fetch: async url => {
    const offset = Number(new URL(url).searchParams.get('song_begin'));
    calls.push(offset);
    return response({ code: 0, cdlist: [{ dissname: 'QQ list', total_song_num: 102, songlist: Array.from({ length: offset ? 2 : 100 }, (_, i) => qqSong(offset + i + 1)) }] });
  } });
  assert.deepEqual(calls, [0, 100]);
  assert.equal(result.tracks.length, 102);
  assert.equal(result.tracks[0].extra.qqRawSong.songid, 1);
  assert.equal(result.tracks[0].extra.mediaMid, '00000000000001');
});

test('QQ ignored pagination stops and warns rather than looping forever', async () => {
  let calls = 0;
  const result = await importResource(parseInput('https://y.qq.com/n/ryqq/playlist/456')[0], { fetch: async () => {
    calls++;
    return response({ code: 0, cdlist: [{ total_song_num: 201, songlist: Array.from({ length: 100 }, (_, i) => qqSong(i + 1)) }] });
  } });
  assert.equal(calls, 2);
  assert.equal(result.tracks.length, 100);
  assert.equal(result.warnings.length, 1);
});

test('Bilibili selected P resolves only audio and blocks foreign stream hosts', async () => {
  const fetch = async url => url.includes('/view?') ? response({ code: 0, data: { bvid: 'BV17x411w7KC', aid: 170001, title: 'Test', owner: { name: 'UP' }, pages: [{ page: 1, cid: 11, duration: 10 }, { page: 2, cid: 22, duration: 20 }] } })
    : response({ code: 0, data: { dash: { video: [{ baseUrl: 'https://not-used.test/video' }], audio: [{ codecs: 'mp4a.40.2', bandwidth: 64000, baseUrl: 'https://test.bilivideo.com/audio.m4s' }] } } });
  const imported = await importResource(parseInput('https://www.bilibili.com/video/BV17x411w7KC?p=2')[0], { fetch });
  assert.equal(imported.tracks.length, 1);
  assert.equal(imported.tracks[0].extra.cid, '22');
  const resolved = await resolveTrack(imported.tracks[0], { fetch });
  assert.match(resolved.url, /audio\.m4s/);
  assert.equal(resolved.preview, false);
  await assert.rejects(resolveTrack(imported.tracks[0], { fetch: async () => response({ code: 0, data: { dash: { audio: [{ codecs: 'mp4a.40.2', baseUrl: 'http://127.0.0.1/private' }] } } }) }), e => e.code === 'UNSAFE_URL');
});

test('QQ vkey failure is explicit and no alternate source is fetched', async () => {
  let calls = 0;
  const track = { platform: 'qq', sourceId: '002w57E00BGzXn', url: 'https://y.qq.com/n/ryqq/songDetail/002w57E00BGzXn' };
  await assert.rejects(resolveTrack(track, { fetch: async () => { calls++; return response({ code: 0, req_1: { code: 0, data: { midurlinfo: [{ purl: '', result: 104003 }] } } }); } }), error => error.code === 'PLAYBACK_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('Netease trial audio is marked and full audio remains unmarked', async () => {
  const track = { platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1' };
  for (const trial of [null, { start: 0, end: 30 }]) {
    const resolved = await resolveTrack(track, { fetch: async () => response({ code: 200, data: [{ id: 1, url: 'http://m8.music.126.net/file.mp3', br: 128000, freeTrialInfo: trial }] }) });
    assert.equal(resolved.preview, Boolean(trial));
    assert.equal(resolved.url, 'https://m8.music.126.net/file.mp3');
  }
});

test('QQ successful result uses platform CDN and flags official preview filenames', async () => {
  const track = { platform: 'qq', sourceId: '002w57E00BGzXn', url: 'https://y.qq.com/n/ryqq/songDetail/002w57E00BGzXn', extra: { mediaMid: '002J3L3S3suxlD' } };
  const resolved = await resolveTrack(track, { qualitySettings: { qq: 'standard' }, fetch: async url => {
    const payload = JSON.parse(new URL(url).searchParams.get('data'));
    assert.deepEqual(payload.req_1.param.filename, ['C400002J3L3S3suxlD.m4a']);
    return response({ code: 0, req_1: { code: 0, data: { sip: ['http://dl.stream.qqmusic.qq.com/'], midurlinfo: [{ purl: 'RS02002J3L3S3suxlD.mp3?vkey=test' }] } } });
  } });
  assert.match(resolved.url, /^https:\/\/dl\.stream\.qqmusic\.qq\.com\//);
  assert.equal(resolved.preview, true);
});

test('QQ official login state is kept in request payload only, and current CDN is supported', async () => {
  const track = { platform: 'qq', sourceId: '0016IKty1sTxqi', url: 'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi' };
  const resolved = await resolveTrack(track, { getQqAuth: async () => ({ uin: 'o0012345', authst: 'in-memory-test-token', tmeLoginType: 1, gTk: 123456 }), fetch: async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(new URL(url).searchParams.has('data'), false);
    assert.equal(url.includes('in-memory-test-token'), false);
    assert.equal(new URL(url).searchParams.get('g_tk'), '123456');
    assert.equal(options.credentials, 'include');
    const payload = JSON.parse(options.body);
    assert.equal(payload.comm.uin, '12345');
    assert.equal(payload.req_1.param.uin, '12345');
    assert.equal(payload.comm.authst, 'in-memory-test-token');
    assert.equal(payload.comm.tmeLoginType, 1);
    return response({ code: 0, req_1: { code: 0, data: { sip: ['https://aqqmusic.tc.qq.com/'], midurlinfo: [{ purl: 'C400file.m4a?vkey=test' }] } } });
  } });
  assert.match(resolved.url, /^https:\/\/aqqmusic\.tc\.qq\.com\//);
  assert.equal(JSON.stringify(track).includes('in-memory-test-token'), false);
  assert.equal(JSON.stringify(resolved).includes('in-memory-test-token'), false);
});

test('NetEase authenticated session uses official web POST with CSRF and encrypted form', async () => {
  const track = { platform: 'netease', sourceId: '3330630999', url: 'https://music.163.com/song?id=3330630999' };
  let calls = 0, authReads = 0;
  const resolved = await resolveTrack(track, {
    getNeteaseAuth: async () => { authReads++; return { hasSession: true, csrfToken: 'csrf-test-value' }; },
    fetch: async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, '/weapi/song/enhance/player/url/v1');
      assert.equal(new URL(url).searchParams.get('csrf_token'), 'csrf-test-value');
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'include');
      assert.equal(options.redirect, 'manual');
      const form = new URLSearchParams(options.body);
      assert.match(form.get('params'), /^[a-zA-Z0-9+/]+=*$/);
      assert.match(form.get('encSecKey'), /^[a-f0-9]{256}$/);
      assert.equal(options.body.includes('csrf-test-value'), false);
      assert.equal(options.body.includes(track.sourceId), false);
      return response({ code: 200, data: [{ id: Number(track.sourceId), code: 200, url: 'https://m8.music.126.net/own-session.m4a', level: 'standard', freeTrialInfo: null }] });
    },
  });
  assert.equal(calls, 1);
  assert.equal(authReads, 1);
  assert.equal(resolved.preview, false);
  assert.equal(JSON.stringify(resolved).includes('csrf-test-value'), false);
});

test('NetEase will not play a different song returned by an API', async () => {
  const track = { platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1' };
  await assert.rejects(resolveTrack(track, { fetch: async url => url.includes('/outer/') ? response('', 403) : response({ code: 200, data: [{ id: 2, code: 200, url: 'https://m8.music.126.net/different.mp3' }] }) }), e => e.code === 'PLAYBACK_UNAVAILABLE');
});

test('NetEase retained preview is clearly flagged after full-session attempts fail', async () => {
  const track = { platform: 'netease', sourceId: '1', url: 'https://music.163.com/song?id=1' };
  let calls = 0;
  const result = await resolveTrack(track, { qualitySettings: { netease: 'standard' }, getNeteaseAuth: async () => ({ hasSession: true, csrfToken: 'csrf' }), fetch: async url => {
    calls++;
    if (url.includes('/weapi/')) return response({ code: 200, data: [{ id: 1, code: 200, url: 'https://m8.music.126.net/trial.m4a', freeTrialInfo: { start: 0, end: 30 } }] });
    return response({ code: 200, data: [{ id: 1, code: 404, url: null, fee: 4 }] });
  } });
  assert.equal(result.preview, true);
  assert.equal(calls, 3);
  assert.equal(result.url, 'https://m8.music.126.net/trial.m4a');
});

test('QQ expired authentication and album entitlement failure remain distinct and actionable', async () => {
  const track = { platform: 'qq', sourceId: '0024NyOE4L7Zyu', url: 'https://y.qq.com/n/ryqq/songDetail/0024NyOE4L7Zyu' };
  await assert.rejects(resolveTrack(track, { fetch: async () => response({ code: 0, req_1: { code: 104401 } }) }), e => e.code === 'LOGIN_REQUIRED');
  await assert.rejects(resolveTrack(track, { getQqAuth: async () => ({ uin: '12345', authst: 'fake-fixture-token', tmeLoginType: 2 }), fetch: async () => response({ code: 0, req_1: { code: 0, data: { midurlinfo: [{ purl: '', result: 104003 }] } } }) }), e => e.code === 'PLAYBACK_UNAVAILABLE' && /专辑购买权限/.test(e.message));
});

test('media proxy preserves Range, session credentials and a streaming 206 response', async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  const upstream = new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-2/100', 'content-type': 'audio/mp4' } });
  const response = await fetchMedia('https://aqqmusic.tc.qq.com/file.m4a', 'qq', { fetch: async (url, options) => {
    assert.equal(new Headers(options.headers).get('range'), 'bytes=0-2');
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'manual');
    return upstream;
  } }, { headers: { Range: 'bytes=0-2' } });
  assert.equal(response, upstream);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-2/100');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('media proxy passes through 416 without turning it into a generic network error', async () => {
  const response = await fetchMedia('https://m10.music.126.net/file.mp3', 'netease', { fetch: async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */100' } }) });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */100');
});

test('media redirects keep Range but are individually validated before fetching', async () => {
  const calls = [];
  const result = await fetchMedia('https://aqqmusic.tc.qq.com/file.m4a', 'qq', { fetch: async (url, options) => {
    calls.push(url);
    assert.equal(new Headers(options.headers).get('range'), 'bytes=500-');
    return calls.length === 1 ? response('', 302, { location: 'https://sjy6.stream.qqmusic.qq.com/file.m4a' }) : response('', 206);
  } }, { headers: { Range: 'bytes=500-' } });
  assert.equal(result.status, 206);
  assert.equal(calls.length, 2);
  let count = 0;
  await assert.rejects(fetchMedia('https://aqqmusic.tc.qq.com/file.m4a', 'qq', { fetch: async () => { count++; return response('', 302, { location: 'https://localhost/private' }); } }), e => e.code === 'UNSAFE_URL');
  assert.equal(count, 1);
});

test('media caller cancellation remains connected after response headers arrive', async () => {
  const cancel = new AbortController();
  let upstreamSignal;
  await fetchMedia('https://test.bilivideo.com/audio.m4s', 'bilibili', { fetch: async (url, options) => { upstreamSignal = options.signal; return response('', 206); } }, { signal: cancel.signal });
  assert.equal(upstreamSignal.aborted, false);
  cancel.abort();
  assert.equal(upstreamSignal.aborted, true);
});

test('Bilibili safely uses its official backup when primary PCDN port is unsupported', async () => {
  const track = { platform: 'bilibili', sourceId: 'BV17x411w7KC', url: 'https://www.bilibili.com/video/BV17x411w7KC', extra: { bvid: 'BV17x411w7KC', cid: '279786' } };
  const resolved = await resolveTrack(track, { fetch: async () => response({ code: 0, data: { dash: { audio: [{ codecs: 'mp4a.40.2', baseUrl: 'https://pcdn.bilivideo.cn:4483/audio.m4s', backupUrl: ['https://mirror.bilivideo.com/audio.m4s'] }] } } }) });
  assert.equal(resolved.url, 'https://mirror.bilivideo.com/audio.m4s');
});

test('media proxy preserves Chromium Headers objects including Range on tail seeks', async () => {
  const headers = new Headers({ Range: 'bytes=3000000-', Referer: 'https://y.qq.com/portal/player.html' });
  await fetchMedia('https://aqqmusic.tc.qq.com/file.m4a', 'qq', { fetch: async (url, options) => {
    assert.equal(new Headers(options.headers).get('range'), 'bytes=3000000-');
    assert.equal(new Headers(options.headers).get('referer'), 'https://y.qq.com/portal/player.html');
    return response('', 206);
  } }, { headers });
});

test('official CDN alternatives retain the same QQ purl or Bilibili audio representation', async () => {
  const qq = { platform: 'qq', sourceId: '0016IKty1sTxqi', url: 'https://y.qq.com/n/ryqq/songDetail/0016IKty1sTxqi' };
  const qqResult = await resolveTrack(qq, { fetch: async () => response({ code: 0, req_1: { code: 0, data: { sip: ['https://aqqmusic.tc.qq.com/', 'https://sjy6.stream.qqmusic.qq.com/', 'https://aqqmusic.tc.qq.com/', 'https://evil.test/'], midurlinfo: [{ purl: 'C400same.m4a?vkey=same' }] } } }) });
  assert.equal(qqResult.url, 'https://aqqmusic.tc.qq.com/C400same.m4a?vkey=same');
  assert.equal(qqResult.alternatives.includes('https://sjy6.stream.qqmusic.qq.com/C400same.m4a?vkey=same'), true);
  assert.equal(new Set([qqResult.url, ...qqResult.alternatives]).size, 1 + qqResult.alternatives.length);
  assert.equal(qqResult.alternatives.some(url => url.includes('evil.test')), false);
  const bili = { platform: 'bilibili', sourceId: 'BV17x411w7KC', url: 'https://www.bilibili.com/video/BV17x411w7KC', extra: { bvid: 'BV17x411w7KC', cid: '279786' } };
  const biliResult = await resolveTrack(bili, { fetch: async () => response({ code: 0, data: { dash: { audio: [
    { codecs: 'mp4a.40.2', bandwidth: 128000, baseUrl: 'https://primary.bilivideo.com/high.m4s', backupUrl: ['https://backup.bilivideo.com/high.m4s', 'https://backup.bilivideo.com/high.m4s', 'https://evil.test/high.m4s'] },
    { codecs: 'mp4a.40.2', bandwidth: 64000, baseUrl: 'https://low.bilivideo.com/low.m4s', backupUrl: ['https://lowbackup.bilivideo.com/low.m4s'] },
  ] } } }) });
  assert.equal(biliResult.url, 'https://primary.bilivideo.com/high.m4s');
  assert.deepEqual(biliResult.alternatives, ['https://backup.bilivideo.com/high.m4s']);
});

test('new NetEase imports expose HTTPS artwork immediately',async()=>{
  const song={...netSong(123),al:{name:'Album',picUrl:'http://p1.music.126.net/cover.jpg'}};
  const result=await importResource(parseInput('https://music.163.com/song?id=123')[0],{fetch:async()=>response({code:200,songs:[song]})});
  assert.equal(result.tracks[0].coverUrl,'https://p1.music.126.net/cover.jpg');
});
