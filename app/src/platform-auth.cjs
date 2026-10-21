'use strict';

// Read only this application's Electron cookie objects. Never read another
// browser's profile or return authentication material through renderer IPC.
const ROOTS = { qq: 'https://y.qq.com/', netease: 'https://music.163.com/', bilibili: 'https://www.bilibili.com/' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const AUTH_CODES = new Set([301, 401, 403, 1000, 104400, 104401, 200005, -101]);

function cookieValue(cookies, names, domains) {
  const now = Date.now() / 1000;
  for (const name of names) {
    for (const domain of domains) {
      const candidate = (Array.isArray(cookies) ? cookies : []).find(cookie => cookie?.name === name &&
        String(cookie.domain || '').replace(/^\./, '').toLowerCase() === domain &&
        typeof cookie.value === 'string' && cookie.value.trim().length > 0 && cookie.value.length < 8192 &&
        (cookie.expirationDate === undefined || Number.isFinite(cookie.expirationDate) && cookie.expirationDate > now));
      if (candidate) return candidate.value;
    }
  }
  return '';
}

function hash33(value) {
  let hash = 5381;
  for (const character of String(value || '')) hash = (hash + (hash << 5) + character.charCodeAt(0)) | 0;
  return hash & 0x7fffffff;
}

function readQqAuth(cookies) {
  // Android CookieManager reports cookies against the queried origin. These
  // exact first-party mobile/API hosts can also own host-only music cookies.
  const find = (...names) => cookieValue(cookies, names, ['y.qq.com', 'qq.com', 'music.qq.com', 'u.y.qq.com', 'i.y.qq.com', 'i2.y.qq.com']);
  const webLoginType = find('login_type');
  // Official wx_redirect.html uses web login_type=2 for WeChat, but sends
  // tmeLoginType=1 to music.login.LoginServer. QQ Connect uses type 2 in RPC.
  const wechat = webLoginType === '2' || (!webLoginType && !!find('wxuin', 'lwxuin'));
  const rawUin = wechat ? find('wxuin', 'lwxuin', 'qqmusic_uin') : find('qqmusic_uin', 'uin', 'p_uin', 'luin', 'p_luin');
  const normalUin = rawUin.replace(/^o0*/i, '').replace(/^0+(?=\d)/, '');
  const uin = /^\d{1,20}$/.test(normalUin) ? normalUin : '0';
  const musicKey = wechat ? find('qm_keyst', 'lqm_keyst', 'qqmusic_key') : find('qqmusic_key', 'qm_keyst', 'lqm_keyst');
  const authst = musicKey || (wechat ? '' : find('p_skey', 'skey', 'p_lskey', 'lskey'));
  // Generic QQ SSO cookies alone are not evidence that this app has completed
  // QQ Music login. Keep the old playback compatibility token in memory, but
  // restore the account indicator only with a specific music-session key.
  return { uin, authst, tmeLoginType: wechat ? 1 : 2, gTk: hash33(authst), hasSession: uin !== '0' && !!musicKey };
}

function readNeteaseAuth(cookies) {
  const domains = ['music.163.com', '163.com'];
  return { hasSession: !!cookieValue(cookies, ['MUSIC_U'], domains), csrfToken: cookieValue(cookies, ['__csrf'], domains) };
}

function readBilibiliAuth(cookies){
  // Expose a flag only. The Electron platform session supplies credentials to
  // its own requests; this result never transports a cookie to renderer IPC.
  return {hasSession:!!cookieValue(cookies,['SESSDATA'],['bilibili.com','www.bilibili.com'])};
}

function state(loggedIn, verified, status, message, nickname = '') {
  return { loggedIn, verified, nickname: typeof nickname === 'string' ? nickname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '', status, message };
}
const absent = () => state(false, false, 'signed-out', '未登录，请在官方窗口登录购买歌曲时使用的账号。');
const restored = () => state(true, false, 'session-restored', '已恢复此播放器保存的登录会话，平台验证暂不可用；可直接尝试播放，权限由平台判断。');
const expired = () => state(false, true, 'expired', '平台未确认有效登录，请在官方窗口重新登录。');

function restoredAccountState(platform, cookies) {
  const hasSession = platform === 'qq' ? readQqAuth(cookies).hasSession
    : platform === 'netease' ? readNeteaseAuth(cookies).hasSession
      : platform === 'bilibili' ? readBilibiliAuth(cookies).hasSession : false;
  return hasSession ? restored() : absent();
}

function safeResponseUrl(value, platform) {
  if (!value) return;
  const url = new URL(value);
  const hosts = platform === 'qq' ? ['u.y.qq.com'] : platform === 'netease' ? ['music.163.com'] : ['api.bilibili.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw new Error('Unexpected account response origin');
}

async function accountJson(url, platform, context, options = {}) {
  safeResponseUrl(url, platform);
  if (typeof context?.fetch !== 'function') throw new Error('No platform session');
  const response = await context.fetch(url, { ...options, redirect: 'manual', credentials: 'include', signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': UA, Referer: ROOTS[platform], ...options.headers } });
  safeResponseUrl(response.url, platform);
  if (!response.ok) {
    const error = new Error('Account response unavailable');
    error.authRejected = [401, 403].includes(response.status);
    throw error;
  }
  if (Number(response.headers.get('content-length') || 0) > 1024 * 1024) throw new Error('Account response too large');
  const text = await response.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Account response too large');
  return JSON.parse(text);
}

async function inspectQq(context, cookies) {
  const auth = readQqAuth(cookies);
  if (!auth.hasSession) return absent();
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('format', 'json');
  url.searchParams.set('g_tk', String(auth.gTk));
  // Unlike a public profile lookup, this RPC asks only for the authenticated
  // identity. Anonymous and intentionally invalid test sessions return 1000.
  const payload = { comm: { ct: 24, cv: 0, format: 'json', uin: auth.uin, authst: auth.authst, tmeLoginType: auth.tmeLoginType },
    req_1: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} } };
  const data = await accountJson(url.href, 'qq', context, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = data.req_1;
  if (AUTH_CODES.has(Number(data.code)) || AUTH_CODES.has(Number(result?.code))) return expired();
  if (Number(data.code) !== 0 || Number(result?.code) !== 0 || !result.data || typeof result.data !== 'object') return restored();
  const user = result.data.userInfo || result.data.userinfo || result.data;
  const id = String(user.musicid || user.musicId || user.uin || user.str_musicid || '');
  // A successful but empty result does not establish server verification.
  // Music IDs and QQ login UINs belong to different identity namespaces; the
  // self-only RPC need not echo the login UIN to authenticate its own response.
  if (!/^\d{1,20}$/.test(id) || Number(id) === 0) return restored();
  return state(true, true, 'signed-in', '已通过 QQ 音乐账号验证；实际播放权限由平台按歌曲判断。', user.nick || user.nickname || user.nickName || '');
}

async function inspectNetease(context, cookies) {
  const auth = readNeteaseAuth(cookies);
  if (!auth.hasSession) return absent();
  const url = new URL('https://music.163.com/api/w/nuser/account/get');
  if (auth.csrfToken) url.searchParams.set('csrf_token', auth.csrfToken);
  const data = await accountJson(url.href, 'netease', context);
  if (AUTH_CODES.has(Number(data.code))) return expired();
  if (Number(data.code) !== 200) return restored();
  if (!data.account || !data.profile) return expired();
  const id = String(data.account.id || ''), profileId = String(data.profile.userId || data.profile.user_id || '');
  if (!/^\d{1,20}$/.test(id) || Number(id) === 0 || (profileId && profileId !== id)) return restored();
  return state(true, true, 'signed-in', '已通过网易云音乐账号验证；实际播放权限由平台按歌曲判断。', data.profile.nickname);
}

async function inspectBilibili(context, cookies) {
  if (!readBilibiliAuth(cookies).hasSession) return absent();
  const data = await accountJson('https://api.bilibili.com/x/web-interface/nav', 'bilibili', context);
  if (Number(data.code) === -101 || data.data?.isLogin === false) return expired();
  if (Number(data.code) === 0 && data.data?.isLogin === true) return state(true, true, 'signed-in', '已通过 Bilibili 账号验证。', data.data.uname);
  return restored();
}

async function inspectAccount(platform, context, cookies) {
  try {
    if (platform === 'qq') return await inspectQq(context, cookies);
    if (platform === 'netease') return await inspectNetease(context, cookies);
    if (platform === 'bilibili') return await inspectBilibili(context, cookies);
    return state(false, false, 'unsupported', '不支持的平台。');
  } catch (error) {
    // Deliberately omit server text, token-bearing URLs and exception details.
    if (error.authRejected) return expired();
    return restoredAccountState(platform, cookies);
  }
}

module.exports = { readQqAuth, readNeteaseAuth, readBilibiliAuth, restoredAccountState, inspectAccount };
