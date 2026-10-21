'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readQqAuth, readNeteaseAuth, readBilibiliAuth, restoredAccountState, inspectAccount } = require('../src/platform-auth.cjs');
const cookie = (name, value, domain = '.qq.com', extra = {}) => ({ name, value, domain, ...extra });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const qqCookies = [cookie('login_type', '1'), cookie('qqmusic_uin', 'o0012345'), cookie('qqmusic_key', 'test-session-key')];

test('QQ web login type maps to RPC type and selects matching purchase account', () => {
  const mixed = [...qqCookies, cookie('wxuin', '98765'), cookie('qm_keyst', 'wechat-session-key')];
  assert.deepEqual(readQqAuth(mixed), { uin: '12345', authst: 'test-session-key', tmeLoginType: 2, gTk: readQqAuth(qqCookies).gTk, hasSession: true });
  mixed[0] = cookie('login_type', '2');
  const auth = readQqAuth(mixed);
  assert.equal(auth.uin, '98765');
  assert.equal(auth.authst, 'wechat-session-key');
  assert.equal(auth.tmeLoginType, 1);
  assert.equal(auth.hasSession, true);
});

test('auth cookie readers reject expired, foreign and incomplete credentials', () => {
  assert.equal(readQqAuth([cookie('qqmusic_uin', '12345'), cookie('qqmusic_key', 'expired', '.qq.com', { expirationDate: 1 })]).hasSession, false);
  assert.equal(readQqAuth([cookie('qqmusic_uin', '12345', 'evil.qq.com'), cookie('qqmusic_key', 'foreign', 'evil.qq.com')]).hasSession, false);
  assert.equal(readQqAuth([cookie('uin', 'not-an-id'), cookie('p_skey', 'key')]).hasSession, false);
  assert.deepEqual(readNeteaseAuth([cookie('MUSIC_U', 'session', '.music.163.com'), cookie('__csrf', 'csrf-value', '.music.163.com')]), { hasSession: true, csrfToken: 'csrf-value' });
  assert.equal(readNeteaseAuth([cookie('MUSIC_U', 'session', 'evil.music.163.com')]).hasSession, false);
  assert.equal(readQqAuth([cookie('uin', '12345'), cookie('p_skey', 'generic-QQ-only')]).hasSession, false);
  assert.equal(readQqAuth([cookie('qqmusic_uin', '000000'), cookie('qqmusic_key', 'music-key')]).hasSession, false);
  assert.equal(readNeteaseAuth([cookie('MUSIC_U', 'expired', '.music.163.com', { expirationDate: 1 })]).hasSession, false);
  assert.equal(readNeteaseAuth([cookie('MUSIC_U', 'invalid-expiration', '.music.163.com', { expirationDate: '1' })]).hasSession, false);
  assert.equal(readNeteaseAuth([cookie('MUSIC_U', ' ', '.music.163.com')]).hasSession, false);
});

test('QQ Music accepts host-only cookies from the exact Android music/API origins', async () => {
  for (const domain of ['u.y.qq.com', 'i.y.qq.com', 'i2.y.qq.com']) {
    const cookies = [cookie('login_type', '1', 'qq.com'), cookie('qqmusic_uin', 'o0012345', domain), cookie('qqmusic_key', 'mobile-music-key', domain)];
    const auth = readQqAuth(cookies);
    assert.equal(auth.hasSession, true, domain);
    assert.equal(auth.uin, '12345');
    assert.equal(auth.authst, 'mobile-music-key');
    let probes = 0;
    const result = await inspectAccount('qq', { fetch: async (url, options) => {
      probes++;
      const rpc = JSON.parse(options.body);
      assert.equal(rpc.comm.authst, 'mobile-music-key');
      assert.equal(rpc.comm.uin, '12345');
      return response({ code: 0, req_1: { code: 0, data: { userInfo: { musicid: 67890, nick: 'Mobile account' } } } });
    } }, cookies);
    assert.equal(probes, 1, 'the mobile session must reach server verification');
    assert.equal(result.loggedIn, true); assert.equal(result.verified, true);
    assert.equal(JSON.stringify(result).includes('mobile-music-key'), false);
  }
});

test('mobile QQ domains do not admit sibling/lookalike origins, expired keys, or generic client SSO', () => {
  for (const domain of ['evil.y.qq.com', 'i2.y.qq.com.evil.test', 'evil.i2.y.qq.com']) {
    assert.equal(readQqAuth([cookie('qqmusic_uin', '12345', domain), cookie('qqmusic_key', 'foreign', domain)]).hasSession, false);
  }
  assert.equal(readQqAuth([cookie('uin', '12345', 'i2.y.qq.com'), cookie('p_skey', 'client-only', 'i2.y.qq.com')]).hasSession, false);
  assert.equal(readQqAuth([cookie('qqmusic_uin', '12345', 'i2.y.qq.com'), cookie('qqmusic_key', 'expired', 'i2.y.qq.com', {expirationDate: 1})]).hasSession, false);
});

test('restoredAccountState synchronously restores only app music credentials with no identity or token exposure', () => {
  const result = restoredAccountState('qq', qqCookies);
  assert.equal(result.status, 'session-restored');
  assert.equal(result.loggedIn, true);
  assert.equal(result.verified, false);
  assert.equal(result.nickname, '');
  assert.equal(JSON.stringify(result).includes('test-session-key'), false);
  assert.equal(JSON.stringify(result).includes('12345'), false);
  const netease = restoredAccountState('netease', [cookie('MUSIC_U', 'netease-session', '.music.163.com')]);
  assert.equal(netease.loggedIn, true);
  assert.equal(netease.verified, false);
  assert.equal(restoredAccountState('bilibili', [cookie('SESSDATA', 'bili-session', '.bilibili.com')]).loggedIn, true);
});

test('restoredAccountState rejects absent, expired, foreign and generic SSO cookies before network verification', () => {
  for (const platform of ['qq', 'netease', 'bilibili']) {
    assert.equal(restoredAccountState(platform, []).status, 'signed-out');
    assert.equal(restoredAccountState(platform, []).loggedIn, false);
  }
  assert.equal(restoredAccountState('qq', [cookie('uin', '12345'), cookie('p_skey', 'generic-QQ-only')]).loggedIn, false);
  assert.equal(restoredAccountState('qq', [cookie('qqmusic_uin', '12345'), cookie('qqmusic_key', 'expired', '.qq.com', { expirationDate: Date.now() / 1000 - 10 })]).loggedIn, false);
  assert.equal(restoredAccountState('netease', [cookie('MUSIC_U', 'foreign', 'evil.music.163.com')]).loggedIn, false);
  assert.equal(restoredAccountState('bilibili', [cookie('SESSDATA', 'expired', '.bilibili.com', { expirationDate: 1 })]).loggedIn, false);
});

test('no cookies means signed out without any network request', async () => {
  for (const platform of ['qq', 'netease', 'bilibili']) {
    const state = await inspectAccount(platform, { fetch: async () => { throw new Error('must not call'); } }, []);
    assert.equal(state.status, 'signed-out');
    assert.equal(state.loggedIn, false);
    assert.equal(state.verified, false);
  }
});

test('QQ self identity response verifies login without exposing tokens or account ids', async () => {
  const result = await inspectAccount('qq', { fetch: async (url, options) => {
    assert.equal(new URL(url).hostname, 'u.y.qq.com');
    assert.equal(options.method, 'POST');
    assert.equal(url.includes('test-session-key'), false);
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'manual');
    const rpc = JSON.parse(options.body);
    assert.equal(rpc.req_1.method, 'GetLoginUserInfo');
    assert.deepEqual(rpc.req_1.param, {});
    assert.equal(rpc.comm.authst, 'test-session-key');
    return response({ code: 0, req_1: { code: 0, data: { userInfo: { musicid: 12345, nick: 'Test Nick' }, privateToken: 'not-to-render' } } });
  } }, qqCookies);
  assert.equal(result.loggedIn, true);
  assert.equal(result.verified, true);
  assert.equal(result.nickname, 'Test Nick');
  assert.deepEqual(Object.keys(result).sort(), ['loggedIn', 'verified', 'nickname', 'status', 'message'].sort());
  assert.equal(JSON.stringify(result).includes('12345'), false);
  assert.equal(JSON.stringify(result).includes('test-session-key'), false);
  assert.equal(JSON.stringify(result).includes('not-to-render'), false);
});

test('QQ explicit auth rejection clears restored login but an inconclusive probe preserves the music session', async () => {
  const expired = await inspectAccount('qq', { fetch: async () => response({ code: 0, req_1: { code: 1000 } }) }, qqCookies);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.verified, true);
  assert.equal(expired.loggedIn, false);
  for (const data of [{}, { userInfo: { musicid: 0 } }, { userInfo: { musicid: '00000' } }, { userInfo: { musicid: 'malformed' } }]) {
    const result = await inspectAccount('qq', { fetch: async () => response({ code: 0, req_1: { code: 0, data } }) }, qqCookies);
    assert.equal(result.status, 'session-restored');
    assert.equal(result.loggedIn, true);
    assert.equal(result.verified, false);
    assert.equal(result.nickname, '');
  }
});

test('QQ self RPC verifies nonzero music identity even when it differs from cookie UIN', async () => {
  const result = await inspectAccount('qq', { fetch: async () => response({ code: 0, req_1: { code: 0, data: { userInfo: { musicid: 54321, nick: 'Music profile' } } } }) }, qqCookies);
  assert.equal(result.status, 'signed-in');
  assert.equal(result.loggedIn, true);
  assert.equal(result.verified, true);
  assert.equal(result.nickname, 'Music profile');
  assert.equal(JSON.stringify(result).includes('54321'), false);
});

test('generic QQ client SSO cookies alone are not restored as a music login', async () => {
  const result = await inspectAccount('qq', { fetch: async () => { throw new Error('must not call'); } }, [cookie('uin', '12345'), cookie('p_skey', 'generic-QQ-only')]);
  assert.equal(result.status, 'signed-out');
  assert.equal(result.loggedIn, false);
});

test('NetEase requires authenticated account and profile rather than just MUSIC_U', async () => {
  const cookies = [cookie('MUSIC_U', 'session-secret', '.music.163.com'), cookie('__csrf', 'csrf-test', '.music.163.com')];
  const verified = await inspectAccount('netease', { fetch: async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/w/nuser/account/get');
    assert.equal(new URL(url).searchParams.get('csrf_token'), 'csrf-test');
    assert.equal(options.credentials, 'include');
    return response({ code: 200, account: { id: 67890 }, profile: { userId: 67890, nickname: 'Netease Nick' } });
  } }, cookies);
  assert.equal(verified.loggedIn, true);
  assert.equal(verified.nickname, 'Netease Nick');
  const anonymous = await inspectAccount('netease', { fetch: async () => response({ code: 200, account: null, profile: null }) }, cookies);
  assert.equal(anonymous.loggedIn, false);
  assert.equal(anonymous.status, 'expired');
});

test('network errors preserve an app music session without claiming server verification or leaking details', async () => {
  for (const fetch of [async () => { throw new Error('secret URL test-session-key'); }, async () => { const r = response({ code: 0 }); Object.defineProperty(r, 'url', { value: 'https://127.0.0.1/private' }); return r; }]) {
    const result = await inspectAccount('qq', { fetch }, qqCookies);
    assert.equal(result.status, 'session-restored');
    assert.equal(result.loggedIn, true);
    assert.equal(result.verified, false);
    assert.equal(JSON.stringify(result).includes('test-session-key'), false);
  }
});

test('HTTP authentication rejection always clears the local restored indicator', async () => {
  for (const status of [401, 403]) {
    const result = await inspectAccount('qq', { fetch: async () => new Response('', { status }) }, qqCookies);
    assert.equal(result.status, 'expired');
    assert.equal(result.loggedIn, false);
    assert.equal(result.verified, true);
  }
});

test('NetEase transient account probe failure restores only an unexpired MUSIC_U session', async () => {
  const result = await inspectAccount('netease', { fetch: async () => { throw new Error('Offline'); } }, [cookie('MUSIC_U', 'music-session', '.music.163.com')]);
  assert.equal(result.status, 'session-restored');
  assert.equal(result.loggedIn, true);
  assert.equal(result.verified, false);
  const expired = await inspectAccount('netease', { fetch: async () => { throw new Error('must not call'); } }, [cookie('MUSIC_U', 'expired-session', '.music.163.com', { expirationDate: 1 })]);
  assert.equal(expired.loggedIn, false);
  assert.equal(expired.status, 'signed-out');
});

test('Bilibili status uses authenticated nav result', async () => {
  const cookies = [cookie('SESSDATA', 'fixture-only', '.bilibili.com')];
  const result = await inspectAccount('bilibili', { fetch: async () => response({ code: 0, data: { isLogin: true, uname: 'UP name' } }) }, cookies);
  assert.equal(result.loggedIn, true);
  assert.equal(result.nickname, 'UP name');
});

test('Bilibili auth reader exposes only a flag and rejects foreign, missing and expired session cookies',()=>{
  const auth=readBilibiliAuth([cookie('SESSDATA','never-to-render','.bilibili.com')]);assert.deepEqual(auth,{hasSession:true});assert.equal(JSON.stringify(auth).includes('never-to-render'),false);
  for(const cookies of [[],[cookie('bili_jct','not-a-session','.bilibili.com')],[cookie('SESSDATA','expired','.bilibili.com',{expirationDate:1})],[cookie('SESSDATA','foreign','evil.bilibili.com')]])assert.deepEqual(readBilibiliAuth(cookies),{hasSession:false});
});

test('Bilibili nav negative status clears the restored indicator and only nav true is server verified',async()=>{
  const cookies=[cookie('SESSDATA','fixture-only','.bilibili.com')];
  for(const data of [{code:-101,data:{isLogin:false}},{code:0,data:{isLogin:false}}]){
    const result=await inspectAccount('bilibili',{fetch:async(url,options)=>{assert.equal(url,'https://api.bilibili.com/x/web-interface/nav');assert.equal(options.credentials,'include');return response(data);}},cookies);
    assert.equal(result.loggedIn,false);assert.equal(result.verified,true);assert.equal(result.status,'expired');
  }
  for(const fetch of [async()=>{throw new Error('offline');},async()=>response({code:0,data:{}})]){
    const result=await inspectAccount('bilibili',{fetch},cookies);assert.equal(result.loggedIn,true);assert.equal(result.verified,false);assert.equal(result.status,'session-restored');
  }
});
