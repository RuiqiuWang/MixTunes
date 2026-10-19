'use strict';

const { randomInt, createCipheriv } = require('node:crypto');
const { normaliseQualitySettings } = require('./quality.cjs');

class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

const ORIGINS = {
  qq: 'https://y.qq.com/',
  netease: 'https://music.163.com/',
  bilibili: 'https://www.bilibili.com/',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAX_BODY = 12 * 1024 * 1024;
const MAX_TRACKS = 10000;
const isSubdomain = (host, root) => host === root || host.endsWith('.' + root);
const validId = value => /^\d{1,20}$/.test(String(value || ''));
const validMid = value => /^[a-zA-Z0-9]{6,32}$/.test(String(value || ''));
const validBvid = value => /^BV[a-zA-Z0-9]{10}$/.test(String(value || ''));

function hostPlatform(host) {
  if (isSubdomain(host, 'y.qq.com')) return 'qq';
  if (host === 'music.163.com' || host === 'y.music.163.com' || host === 'interface.music.163.com' || host === 'interface3.music.163.com' || host === '163cn.tv') return 'netease';
  if (host === 'b23.tv' || isSubdomain(host, 'bilibili.com')) return 'bilibili';
  return null;
}

function normalizeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ProviderError('INVALID_URL', '链接格式无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new ProviderError('UNSAFE_URL', '仅支持没有账号信息和自定义端口的平台 HTTPS 链接。');
  }
  url.protocol = 'https:';
  url.port = '';
  return url;
}

function assertUrl(value, platform, media = false) {
  const url = normalizeUrl(value);
  const host = url.hostname.toLowerCase();
  const apiAllowed = hostPlatform(host) === platform;
  const mediaAllowed = platform === 'netease'
    ? isSubdomain(host, 'music.126.net')
    : platform === 'qq'
      ? isSubdomain(host, 'qqmusic.qq.com') || host === 'aqqmusic.tc.qq.com'
      : isSubdomain(host, 'bilivideo.com') || isSubdomain(host, 'bilivideo.cn') || isSubdomain(host, 'hdslb.com');
  if (!apiAllowed && !(media && mediaAllowed)) throw new ProviderError('UNSAFE_URL', '平台返回了不受支持的地址，已停止访问。');
  return url.href;
}

function parseUrl(value) {
  const url = normalizeUrl(value);
  const platform = hostPlatform(url.hostname.toLowerCase());
  if (!platform) throw new ProviderError('UNSUPPORTED_URL', '仅支持 QQ 音乐、网易云音乐和 Bilibili 链接。');
  let path = url.pathname;
  let params = url.searchParams;
  if (platform === 'netease' && url.hash.startsWith('#/')) {
    const hashUrl = new URL(url.hash.slice(1), ORIGINS.netease);
    path = hashUrl.pathname;
    params = hashUrl.searchParams;
  }
  if (platform === 'netease') {
    if (url.hostname === '163cn.tv') return { platform, kind: 'shortlink', url: url.href };
    const id = params.get('id') || path.match(/\/(?:playlist|song)\/(\d+)/)?.[1];
    const kind = /(?:^|\/)(?:playlist|myplaylist)(?:\/|$)/.test(path) ? 'playlist' : /(?:^|\/)song(?:\/|$)/.test(path) ? 'track' : null;
    if (kind && validId(id)) return { platform, kind, id: String(id), url: `https://music.163.com/${kind === 'track' ? 'song' : 'playlist'}?id=${id}` };
  }
  if (platform === 'qq') {
    const playlistId = path.match(/\/(?:playlist|taoge)\/(\d+)/)?.[1] || (/taoge|playlist/.test(path) ? params.get('id') : null) || params.get('disstid');
    if (validId(playlistId)) return { platform, kind: 'playlist', id: String(playlistId), url: `https://y.qq.com/n/ryqq/playlist/${playlistId}` };
    const mid = path.match(/\/(?:songDetail|song)\/([A-Za-z0-9]+)/)?.[1] || path.match(/\/song\/([A-Za-z0-9]+)\.html/)?.[1] || params.get('songmid') || params.get('mid');
    if (validMid(mid)) return { platform, kind: 'track', id: mid, url: `https://y.qq.com/n/ryqq/songDetail/${mid}` };
    const songId = params.get('songid') || (path.includes('/song') ? params.get('id') : null);
    if (validId(songId)) return { platform, kind: 'track', id: String(songId), url: url.href };
    if (/\/base\/fcgi-bin\/u$|\/share\//.test(path)) return { platform, kind: 'shortlink', url: url.href };
  }
  if (platform === 'bilibili') {
    if (url.hostname === 'b23.tv') return { platform, kind: 'shortlink', url: url.href };
    // These are video-favourite folder IDs (media_id), distinct from an UP's
    // season/series IDs and from a video's aid/cid.
    let favoriteId=path.match(/^\/(?:medialist\/detail|list)\/ml(\d+)\/?$/)?.[1];
    if(!favoriteId&&url.hostname==='space.bilibili.com'&&/^\/\d+\/favlist\/?$/.test(path))favoriteId=params.get('fid');
    if(!favoriteId&&/^\/medialist\/play\/\d+\/?$/.test(path)&&['space','space_collection'].includes(params.get('business')))favoriteId=params.get('business_id');
    if(!favoriteId&&/^\/(?:list|medialist\/detail)\/?$/.test(path))favoriteId=params.get('listID')||params.get('media_id');
    if(favoriteId!==null&&favoriteId!==undefined){
      if(!validId(favoriteId))throw new ProviderError('INVALID_ID','Bilibili 收藏夹 ID 无效。');
      return {platform,kind:'favorites',id:String(favoriteId),url:`https://www.bilibili.com/medialist/detail/ml${favoriteId}`};
    }
    const id = path.match(/\/video\/((?:BV[a-zA-Z0-9]{10})|(?:av\d+))/)?.[1];
    if (id) {
      const page = Number(params.get('p') || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new ProviderError('INVALID_PAGE', 'Bilibili 分 P 编号无效。');
      return { platform, kind: 'video', id, page, url: `https://www.bilibili.com/video/${id}${page > 1 ? '?p=' + page : ''}` };
    }
  }
  throw new ProviderError('UNSUPPORTED_URL', '这个链接没有可识别的歌单、单曲或 Bilibili 视频 ID。');
}

function parseInput(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new ProviderError('INVALID_INPUT', '请粘贴不超过 1 MB 的链接或分享文案。');
  const links = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  // A bare BV number is useful when copied from the address bar/video metadata.
  if (!links.length && /^\s*BV[a-zA-Z0-9]{10}\s*$/.test(text)) links.push('https://www.bilibili.com/video/' + text.trim());
  if (!links.length) throw new ProviderError('NO_LINKS', '没有找到链接，请复制平台的歌单分享链接或 Bilibili 视频链接。');
  const resources = [];
  const seen = new Set();
  for (const raw of links) {
    const resource = parseUrl(raw.replace(/&amp;/g, '&').replace(/[，。；、！？）】》\]),;.]+$/g, ''));
    const key = `${resource.platform}:${resource.kind}:${resource.id || resource.url}:${resource.page || ''}`;
    if (!seen.has(key)) { seen.add(key); resources.push(resource); }
  }
  return resources;
}

async function request(url, platform, context, options = {}, media = false, acceptErrors = false) {
  if (!context || typeof context.fetch !== 'function') throw new ProviderError('NO_TRANSPORT', '未配置平台网络会话。');
  let current = assertUrl(url, platform, media);
  // Headers is not an enumerable plain object. Spreading it would silently lose
  // Range from Chromium's media proxy and turn seek requests into full downloads.
  const headers = new Headers({ 'User-Agent': UA, Referer: ORIGINS[platform] });
  for (const [name, value] of new Headers(options.headers || {})) headers.set(name, value);
  let opts = { ...options, redirect: 'manual', credentials: 'include', headers };
  const signal = options.signal || (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined);
  opts.signal = signal;
  for (let count = 0; count <= 5; count++) {
    let response;
    try { response = await context.fetch(current, opts); }
    catch (error) { throw new ProviderError('NETWORK', '连接平台失败，请检查网络或稍后重试。', { reason: error.name || 'network' }); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || count === 5) throw new ProviderError('REDIRECT_LIMIT', '分享链接跳转过多或已失效。');
      current = assertUrl(new URL(location, current).href, platform, media);
      // Never forward POST bodies through a 301/302/303 redirect.
      if ([301, 302, 303].includes(response.status)) opts = { ...opts, method: 'GET', body: undefined };
      continue;
    }
    if (response.url) assertUrl(response.url, platform, media);
    if (!response.ok && !acceptErrors) throw new ProviderError('HTTP_ERROR', `平台请求失败（HTTP ${response.status}）。`, { status: response.status });
    return { response, url: current };
  }
  throw new ProviderError('REDIRECT_LIMIT', '分享链接跳转过多。');
}

async function readText(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_BODY) throw new ProviderError('RESPONSE_TOO_LARGE', '平台返回内容过大。');
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); throw new ProviderError('RESPONSE_TOO_LARGE', '平台返回内容过大。'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BODY) throw new ProviderError('RESPONSE_TOO_LARGE', '平台返回内容过大。');
  return text;
}

async function jsonRequest(url, platform, context, options) {
  const { response } = await request(url, platform, context, options);
  let text = (await readText(response)).trim().replace(/^\uFEFF/, '');
  if (!text.startsWith('{') && !text.startsWith('[')) text = text.replace(/^[\w.$]+\s*\(/, '').replace(/\)\s*;?$/, '');
  try { return JSON.parse(text); } catch { throw new ProviderError('INVALID_RESPONSE', '平台没有返回有效数据，可能需要登录或接口已变化。'); }
}

function checkCode(data, allowed = [0, 200]) {
  if (data.code !== undefined && !allowed.includes(Number(data.code))) {
    const code = Number(data.code);
    throw new ProviderError([-101, 301, 401, 403, 1000, 104400, 104401].includes(code) ? 'LOGIN_REQUIRED' : 'PLATFORM_ERROR', '平台拒绝了请求，请打开平台登录后重试。', { platformCode: data.code });
  }
}

function neteaseTrack(raw) {
  if (!raw || !validId(raw.id)) return null;
  const id = String(raw.id);
  const artists = raw.ar || raw.artists || [];
  const album = raw.al || raw.album || {};
  const coverUrl = require('./store.cjs').restoredCoverUrl({platform:'netease',coverUrl:album.picUrl || ''}) || '';
  return {
    key: 'netease:' + id, platform: 'netease', sourceId: id, url: `https://music.163.com/song?id=${id}`,
    title: raw.name || `网易云歌曲 ${id}`, artist: artists.map(a => a.name).filter(Boolean).join(' / '),
    album: album.name || '', durationMs: Number(raw.dt || raw.duration || 0), coverUrl,
    extra: { neteaseRawSong: raw, fee: raw.fee, privilege: raw.privilege || null },
  };
}

function qqTrack(raw) {
  if (!raw) return null;
  const mid = raw.songmid || raw.mid;
  if (!validMid(mid)) return null;
  const album = raw.album || {};
  const albumMid = raw.albummid || album.mid || '';
  return {
    key: 'qq:' + mid, platform: 'qq', sourceId: mid, url: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
    title: raw.songname || raw.title || raw.name || `QQ 音乐 ${mid}`,
    artist: (raw.singer || []).map(a => a.name || a.title).filter(Boolean).join(' / '),
    album: raw.albumname || album.name || album.title || '', durationMs: Number(raw.interval || 0) * 1000,
    coverUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '',
    extra: { qqRawSong: raw, songmid: mid, mediaMid: raw.strMediaMid || raw.file?.media_mid || mid, songId: String(raw.songid || raw.id || ''), pay: raw.pay || {} },
  };
}

async function neteaseDetails(ids, context) {
  const tracks = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const url = new URL('https://music.163.com/api/v3/song/detail');
    url.searchParams.set('c', JSON.stringify(batch.map(id => ({ id: String(id) }))));
    url.searchParams.set('ids', JSON.stringify(batch.map(String)));
    const data = await jsonRequest(url.href, 'netease', context);
    checkCode(data);
    tracks.push(...(data.songs || []).map(neteaseTrack).filter(Boolean));
  }
  return tracks;
}

async function importNetease(resource, context) {
  if (!validId(resource.id)) throw new ProviderError('INVALID_ID', '网易云资源 ID 无效。');
  if (resource.kind === 'track') {
    const tracks = await neteaseDetails([resource.id], context);
    if (!tracks.length) throw new ProviderError('NOT_FOUND', '网易云单曲不可见或已下架。');
    return { tracks, expectedCount: 1, name: tracks[0].title, warnings: [] };
  }
  const url = `https://music.163.com/api/v6/playlist/detail?id=${resource.id}&n=1000&s=0`;
  const data = await jsonRequest(url, 'netease', context);
  checkCode(data);
  const playlist = data.playlist || data.result;
  if (!playlist) throw new ProviderError('NOT_FOUND', '歌单不可见、已删除或需要登录。');
  const expectedCount = Number(playlist.trackCount ?? playlist.trackIds?.length ?? playlist.tracks?.length ?? 0);
  if (expectedCount > MAX_TRACKS) throw new ProviderError('PLAYLIST_TOO_LARGE', '基础版单次最多导入 10000 首，请拆分歌单。');
  const provided = (playlist.tracks || []).map(neteaseTrack).filter(Boolean);
  const byId = new Map(provided.map(track => [track.sourceId, track]));
  const ids = (playlist.trackIds || []).map(item => String(item.id)).filter(validId);
  const warnings = [];
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) {
    try { for (const track of await neteaseDetails(missing, context)) byId.set(track.sourceId, track); }
    catch (error) { warnings.push('部分歌曲详情获取失败：' + error.message); }
  }
  const tracks = (ids.length ? ids.map(id => byId.get(id)).filter(Boolean) : provided).slice(0, MAX_TRACKS);
  if (tracks.length !== expectedCount) warnings.push(`歌单显示 ${expectedCount} 首，当前实际导入 ${tracks.length} 首；部分歌曲可能不可见或已下架。`);
  return { tracks, expectedCount, name: playlist.name || '网易云歌单', warnings };
}

async function qqRpc(payload, context) {
  const url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  url.searchParams.set('format', 'json');
  // Authenticated RPC bodies stay out of query strings, browser history and
  // network URL diagnostics. Cookies are supplied only by the app's session.
  if (payload.comm?.authst) {
    if (Number.isSafeInteger(payload.comm.g_tk)) url.searchParams.set('g_tk', String(payload.comm.g_tk));
    return jsonRequest(url.href, 'qq', context, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  url.searchParams.set('data', JSON.stringify(payload));
  return jsonRequest(url.href, 'qq', context);
}

async function importQq(resource, context) {
  if (resource.kind === 'track') {
    if (!validMid(resource.id) && !validId(resource.id)) throw new ProviderError('INVALID_ID', 'QQ 音乐单曲 ID 无效。');
    const params = validId(resource.id) ? { song_id: Number(resource.id) } : { song_mid: resource.id };
    const data = await qqRpc({ comm: { ct: 24, cv: 0, format: 'json' }, req_1: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: params } }, context);
    checkCode(data);
    checkCode(data.req_1 || {});
    const raw = data.req_1?.data?.track_info || data.req_1?.data?.songinfo;
    const track = qqTrack(raw);
    if (!track) throw new ProviderError('NOT_FOUND', 'QQ 音乐单曲不可见或已下架。');
    return { tracks: [track], expectedCount: 1, name: track.title, warnings: [] };
  }
  if (!validId(resource.id)) throw new ProviderError('INVALID_ID', 'QQ 音乐歌单 ID 无效。');
  const tracks = [], seen = new Set(), warnings = [];
  let expectedCount = 0, name = 'QQ 音乐歌单';
  for (let offset = 0; offset < MAX_TRACKS; offset += 100) {
    const url = new URL('https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg');
    const params = { type: 1, json: 1, utf8: 1, onlysong: 0, nosign: 1, disstid: resource.id, g_tk: 5381, loginUin: 0, hostUin: 0, format: 'json', inCharset: 'GB2312', outCharset: 'utf-8', notice: 0, platform: 'yqq', needNewCode: 0, song_begin: offset, song_num: 100 };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const data = await jsonRequest(url.href, 'qq', context);
    checkCode(data);
    const playlist = data.cdlist?.[0];
    if (!playlist) throw new ProviderError('NOT_FOUND', 'QQ 音乐歌单不可见、已删除或需要登录。');
    name = playlist.dissname || playlist.name || name;
    expectedCount = Number(playlist.total_song_num ?? playlist.songnum ?? playlist.songlist?.length ?? 0);
    if (expectedCount > MAX_TRACKS) throw new ProviderError('PLAYLIST_TOO_LARGE', '基础版单次最多导入 10000 首，请拆分歌单。');
    let added = 0;
    for (const raw of playlist.songlist || []) {
      const track = qqTrack(raw);
      if (track && !seen.has(track.key)) { seen.add(track.key); tracks.push(track); added++; }
    }
    if (tracks.length >= expectedCount || !added) break;
  }
  if (tracks.length !== expectedCount) warnings.push(`歌单显示 ${expectedCount} 首，当前实际导入 ${tracks.length} 首；接口可能限制分页或部分歌曲不可见。`);
  return { tracks, expectedCount, name, warnings };
}

async function importBilibili(resource, context) {
  if (!validBvid(resource.id) && !/^av\d{1,20}$/.test(resource.id || '')) throw new ProviderError('INVALID_ID', 'Bilibili 视频 ID 无效。');
  const query = validBvid(resource.id) ? 'bvid=' + resource.id : 'aid=' + resource.id.slice(2);
  const data = await jsonRequest('https://api.bilibili.com/x/web-interface/view?' + query, 'bilibili', context);
  checkCode(data);
  const video = data.data;
  if (!video || !validBvid(video.bvid)) throw new ProviderError('NOT_FOUND', '视频不可见或已失效。');
  const pages = video.pages || [];
  const selected = resource.allParts ? pages : pages.filter(part => Number(part.page) === Number(resource.page || 1));
  if (!selected.length) throw new ProviderError('NOT_FOUND', '指定分 P 不存在。');
  const tracks = selected.filter(part => validId(part.cid)).map(part => ({
    key: `bilibili:${video.bvid}:${part.cid}`, platform: 'bilibili', sourceId: video.bvid,
    url: `https://www.bilibili.com/video/${video.bvid}${Number(part.page) > 1 ? '?p=' + part.page : ''}`,
    title: pages.length > 1 ? `${video.title} · P${part.page} ${part.part || ''}` : video.title,
    artist: video.owner?.name || '', album: video.title || '', durationMs: Number(part.duration || video.duration || 0) * 1000,
    coverUrl: normaliseBilibiliCover(video.pic), extra: { bvid: video.bvid, aid: String(video.aid), cid: String(part.cid), page: Number(part.page), partCount: pages.length, audioOnly: true },
  }));
  return { tracks, expectedCount: selected.length, name: video.title || 'Bilibili 视频', warnings: [] };
}

async function importBilibiliFavorites(resource,context){
  if(!validId(resource.id))throw new ProviderError('INVALID_ID','Bilibili 收藏夹 ID 无效。');
  const resources=[],seen=new Set(),warnings=[];let expectedCount=null,name='Bilibili 收藏夹',duplicateCount=0;
  const pageSize=20;
  for(let page=1;page<=Math.ceil(MAX_TRACKS/pageSize);page++){
    const url=new URL('https://api.bilibili.com/x/v3/fav/resource/list');
    for(const[key,value]of Object.entries({media_id:resource.id,pn:page,ps:pageSize,keyword:'',order:'mtime',type:0,tid:0,platform:'web'}))url.searchParams.set(key,String(value));
    let data;
    try{
      data=await jsonRequest(url.href,'bilibili',context);
      if(Number(data.code)!==0){
        const code=Number(data.code);
        throw new ProviderError(code===-101?'LOGIN_REQUIRED':code===-404?'NOT_FOUND':'FAVORITES_UNAVAILABLE',code===-101?'这个 Bilibili 收藏夹需要在应用内登录后读取。':'Bilibili 收藏夹不可读取，可能为私密、已删除或当前账号没有权限。',{platformCode:code});
      }
      if(!data.data?.info||String(data.data.info.id)!==resource.id)throw new ProviderError('INVALID_RESPONSE','Bilibili 没有返回指定收藏夹资料。');
    }catch(error){
      if(page===1)throw error;
      warnings.push(`收藏夹第 ${page} 页读取失败，仅保留已取得的条目：${error.message}`);break;
    }
    const info=data.data.info;
    const count=Number(info.media_count);
    if(!Number.isSafeInteger(count)||count<0)throw new ProviderError('INVALID_RESPONSE','Bilibili 收藏夹没有返回有效的条目总数。');
    if(count>MAX_TRACKS)throw new ProviderError('PLAYLIST_TOO_LARGE','基础版单次最多导入 10000 条，请拆分收藏夹。');
    if(expectedCount===null){expectedCount=count;name=String(info.title||name);}
    else if(count!==expectedCount&&!warnings.some(w=>w.includes('读取过程中发生变化')))warnings.push('收藏夹在读取过程中发生变化，条目顺序或数量可能已更新。');
    const medias=Array.isArray(data.data.medias)?data.data.medias:[];
    if(page===1&&count>0&&!Array.isArray(data.data.medias)&&(Number(info.attr)&1))throw new ProviderError('FAVORITES_UNAVAILABLE','这个 Bilibili 收藏夹为私密收藏夹，当前会话没有取得条目；请在应用内登录拥有权限的账号。');
    let added=0;
    for(const media of medias){
      if(resources.length>=MAX_TRACKS)break;
      const identity=`${media?.type}:${media?.id||media?.bvid||media?.bv_id||''}`;
      if(seen.has(identity)){duplicateCount++;continue;}
      seen.add(identity);resources.push(media);added++;
    }
    if(resources.length>=MAX_TRACKS)break;
    const hasMore=data.data.has_more===true||data.data.has_more===1;
    if(!hasMore)break;
    if(!medias.length||!added){warnings.push('收藏夹分页没有返回新条目，已停止继续读取，避免重复循环。');break;}
  }
  if(resources.length!==expectedCount)warnings.push(`收藏夹显示 ${expectedCount} 条，实际取得 ${resources.length} 条；分页可能受限、条目被隐藏或收藏夹已变化。`);
  if(duplicateCount)warnings.push(`分页返回了 ${duplicateCount} 条重复记录，已按视频来源去重。`);
  // Verify each video against the same official metadata endpoint as direct
  // video imports. A stale favourite may retain its title/id after deletion or
  // privacy changes; it must not be reported as an imported playable resource.
  const results=new Array(resources.length);let next=0;
  async function worker(){
    while(next<resources.length){
      const index=next++;const media=resources[index];
      try{
        if(Number(media?.type)!==2)throw new ProviderError('UNSUPPORTED_RESOURCE','不是普通 Bilibili 视频');
        if(Number(media.attr)===9||/^(?:已失效视频|失效视频|已删除视频)$/.test(String(media.title||'').trim()))throw new ProviderError('NOT_FOUND','视频已失效或已删除');
        const id=media.bvid||media.bv_id;
        if(!validBvid(id))throw new ProviderError('INVALID_ID','缺少有效的视频 BV 号');
        const imported=await importBilibili({platform:'bilibili',kind:'video',id,page:1,url:`https://www.bilibili.com/video/${id}`},context);
        results[index]={track:imported.tracks[0]};
      }catch(error){results[index]={error:error.message,title:String(media?.title||'未知条目').slice(0,80)};}
    }
  }
  await Promise.all(Array.from({length:Math.min(3,resources.length)},worker));
  const tracks=results.filter(result=>result?.track).map(result=>result.track);
  const skipped=results.filter(result=>!result?.track);
  if(skipped.length){
    const examples=skipped.slice(0,3).map(item=>`${item.title}（${item.error}）`).join('；');
    warnings.push(`跳过 ${skipped.length} 条失效、不可访问或不支持的收藏条目${examples?'：'+examples:''}${skipped.length>3?'等':''}。`);
  }
  return {tracks,expectedCount:expectedCount??0,declaredCount:expectedCount??0,fetchedCount:resources.length,skippedCount:skipped.length,duplicateCount,name,warnings};
}

function normaliseBilibiliCover(value) {
  try {
    // The view API still returns http://i*.hdslb.com covers. The local UI only
    // accepts HTTPS; only upgrade Bilibili's own image hosts here.
    const url = normalizeUrl(typeof value === 'string' && value.startsWith('//') ? 'https:' + value : value);
    return isSubdomain(url.hostname, 'hdslb.com') ? url.href : '';
  } catch { return ''; }
}

async function expandShortlink(resource, context) {
  const { response, url } = await request(resource.url, resource.platform, context);
  try {
    const parsed = parseUrl(url);
    if (parsed.kind !== 'shortlink') return parsed;
  } catch {}
  const html = await readText(response);
  // Some sharing pages use an HTML/JavaScript navigation instead of an HTTP redirect.
  const candidates = [
    ...html.matchAll(/(?:https?:\/\/|https?:\\\/\\\/)[^\s<>"'`\\]+/gi),
  ].map(match => match[0].replace(/\\\//g, '/').replace(/&amp;/g, '&'));
  const decoded = html.match(/(?:url|href|location)\s*[:=]\s*["'](https?[^"']+)["']/gi) || [];
  for (const fragment of decoded) {
    const match = fragment.match(/["'](https?[^"']+)["']/);
    if (match) { try { candidates.push(decodeURIComponent(match[1].replace(/\\\//g, '/'))); } catch {} }
  }
  for (const candidate of candidates) {
    try { const parsed = parseUrl(candidate); if (parsed.platform === resource.platform && parsed.kind !== 'shortlink') return parsed; } catch {}
  }
  throw new ProviderError('SHORTLINK_EXPIRED', '无法展开分享短链，请在浏览器打开后复制完整的歌单或视频链接。');
}

async function importResource(resource, context) {
  if (!resource || !ORIGINS[resource.platform]) throw new ProviderError('UNSUPPORTED_PLATFORM', '不支持的平台。');
  assertUrl(resource.url, resource.platform);
  if (resource.kind === 'shortlink') resource = await expandShortlink(resource, context);
  if (resource.platform === 'qq') return importQq(resource, context);
  if (resource.platform === 'netease') return importNetease(resource, context);
  if (resource.kind==='favorites')return importBilibiliFavorites(resource,context);
  return importBilibili(resource, context);
}

// Public request-format constants from music.163.com's official web player.
// This is the same web protocol, not a credential or an entitlement bypass.
const NETEASE_RSA_MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
function neteaseWebBody(data) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const secret = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join('');
  const aes = (text, key) => {
    const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
    return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
  };
  let value = BigInt('0x' + Buffer.from([...secret].reverse().join('')).toString('hex'));
  let exponent = 65537n, encrypted = 1n;
  for (; exponent > 0n; exponent >>= 1n) {
    if (exponent & 1n) encrypted = encrypted * value % NETEASE_RSA_MODULUS;
    value = value * value % NETEASE_RSA_MODULUS;
  }
  return new URLSearchParams({ params: aes(aes(JSON.stringify(data), '0CoJUm6Qyw8W8jud'), secret), encSecKey: encrypted.toString(16).padStart(256, '0') }).toString();
}

function requestedQuality(track, context) {
  return normaliseQualitySettings(context.qualitySettings)[track.platform];
}

function withQuality(result, requested, actual, label, details = {}) {
  const wanted = requested === 'auto' ? 'lossless' : requested;
  const ranks = { standard: 0, high: 1, lossless: 2 };
  const downgraded = ranks[actual] < ranks[wanted];
  return { ...result, quality: label, requestedQuality: requested, actualQuality: actual, ...details,
    ...(downgraded ? { qualityFallbackReason: `平台没有返回${wanted === 'lossless' ? '无损' : '高品质'}音源，已使用${label}；可检查账号权限和这首歌的可用音质。` } : {}) };
}

function neteasePlaybackItem(data, track, requested) {
  checkCode(data);
  const item = (Array.isArray(data.data) ? data.data : []).find(value => String(value?.id) === track.sourceId);
  if (item?.url && (item.code === undefined || Number(item.code) === 200)) {
    const codec = String(item.type || new URL(item.url).pathname.split('.').pop() || '').toLowerCase();
    const bitrate = Number(item.br) > 0 ? Number(item.br) : undefined;
    // Describe the returned representation, never the requested level. The
    // backend may grant a lower level (or a preview) for this account and song.
    const lossless = codec === 'flac' || (!['mp3', 'm4a', 'aac'].includes(codec) && ['lossless', 'hires', 'jyeffect', 'sky', 'jymaster'].includes(item.level));
    const actual = lossless ? 'lossless' : ['exhigh', 'higher'].includes(item.level) || bitrate >= 256000 ? 'high' : 'standard';
    const label = lossless ? codec === 'flac' ? 'FLAC 无损' : '官方无损音源' : `${codec === 'mp3' ? 'MP3' : codec === 'm4a' || codec === 'aac' ? 'AAC' : '官方音源'}${bitrate ? ' ' + Math.round(bitrate / 1000) + ' kbps' : actual === 'high' ? ' 高品质' : ' 标准'}`;
    return withQuality({ url: assertUrl(item.url, 'netease', true), headers: { Referer: ORIGINS.netease, 'User-Agent': UA },
      preview: Boolean(item.freeTrialInfo || Number(item.freeTrialPrivilege?.listenType) > 0 || item.isPreview === true) }, requested, actual, label,
    { codec, ...(bitrate ? { bitrate } : {}) });
  }
  throw new ProviderError('PLAYBACK_UNAVAILABLE', '网易云未授权这首歌的音频。请在应用内登录购买时的账号；若已登录，请确认专辑购买权限，或使用官方网页播放。', { platformCode: item?.code, fee: item?.fee });
}

async function resolveNetease(track, context) {
  if (!validId(track.sourceId)) throw new ProviderError('INVALID_ID', '网易云歌曲 ID 无效。');
  const auth = typeof context.getNeteaseAuth === 'function' ? await context.getNeteaseAuth() : context.neteaseAuth || {};
  const requested = requestedQuality(track, context);
  const levels = requested === 'standard' ? ['standard'] : requested === 'high' ? ['exhigh', 'standard'] : ['lossless', 'exhigh', 'standard'];
  let lastError, preview;
  if (auth?.hasSession) {
    const csrfToken = typeof auth.csrfToken === 'string' && auth.csrfToken.length < 8192 ? auth.csrfToken : '';
    const url = new URL('https://music.163.com/weapi/song/enhance/player/url/v1');
    url.searchParams.set('csrf_token', csrfToken);
    for (const level of levels) {
      try {
        const data = await jsonRequest(url.href, 'netease', context, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: neteaseWebBody({ ids: JSON.stringify([track.sourceId]), level, encodeType: level === 'lossless' ? 'flac' : 'aac', csrf_token: csrfToken }) });
        const result = neteasePlaybackItem(data, track, requested);
        if (!result.preview) return result;
        preview ||= result;
      } catch (error) { lastError = error; if (error.code === 'LOGIN_REQUIRED') break; }
    }
  }
  const attempts = [
    ...levels.map(level => 'https://music.163.com/api/song/enhance/player/url/v1?ids=' + encodeURIComponent(JSON.stringify([track.sourceId])) + '&level=' + level + '&encodeType=' + (level === 'lossless' ? 'flac' : 'mp3')),
    'https://music.163.com/api/song/enhance/player/url?ids=' + encodeURIComponent(JSON.stringify([track.sourceId])) + '&br=' + (requested === 'standard' ? '128000' : '320000'),
  ];
  for (const url of attempts) {
    try {
      const data = await jsonRequest(url, 'netease', context);
      const result = neteasePlaybackItem(data, track, requested);
      if (!result.preview) return result;
      preview ||= result;
    } catch (error) { lastError = error; }
  }
  if (preview) return preview;
  // An official outer link is only accepted when the server redirects to a real media URL.
  // No alternate song, external extractor or membership bypass is used.
  try {
    const { response, url } = await request(`https://music.163.com/song/media/outer/url?id=${track.sourceId}.mp3`, 'netease', context, { method: 'HEAD' }, true);
    const type = response.headers.get('content-type') || '';
    if (/audio\//i.test(type) && isSubdomain(new URL(url).hostname, 'music.126.net')) return withQuality({ url, headers: { Referer: ORIGINS.netease }, preview: Number(track.extra?.fee || 0) !== 0 }, requested, 'standard', '官方外链（码率未提供）', { codec: 'mp3' });
  } catch {}
  throw lastError || new ProviderError('PLAYBACK_UNAVAILABLE', '这首网易云歌曲暂时无法播放，请登录后重试。');
}

async function resolveQq(track, context) {
  if (!validMid(track.sourceId)) throw new ProviderError('INVALID_ID', 'QQ 音乐歌曲 ID 无效。');
  const guid = String(randomInt(1000000000, 9999999999));
  const mediaMid = validMid(track.extra?.mediaMid) ? track.extra.mediaMid : track.sourceId;
  const requested = requestedQuality(track, context);
  const formats = requested === 'standard' ? ['C400'] : requested === 'high' ? ['M800', 'C400'] : ['F000', 'M800', 'C400'];
  const extension = prefix => prefix === 'F000' ? 'flac' : prefix === 'M800' ? 'mp3' : 'm4a';
  const filenames = formats.map(prefix => `${prefix}${mediaMid}.${extension(prefix)}`);
  // Credentials are read only from this application's platform session by main.
  // They are kept in memory and must never become Track metadata or probe logs.
  const auth = typeof context.getQqAuth === 'function' ? await context.getQqAuth() : context.qqAuth || {};
  const uin = validId(String(auth?.uin || '').replace(/^o0*/, '')) ? String(auth.uin).replace(/^o0*/, '') : '0';
  const comm = { ct: 24, cv: 0, format: 'json', uin };
  if (typeof auth?.authst === 'string' && auth.authst.length < 8192) comm.authst = auth.authst;
  if ([1, 2, 3].includes(Number(auth?.tmeLoginType))) comm.tmeLoginType = Number(auth.tmeLoginType);
  if (Number.isSafeInteger(auth?.gTk) && auth.gTk >= 0) comm.g_tk = auth.gTk;
  const payload = {
    comm,
    req_1: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid, songmid: filenames.map(() => track.sourceId), songtype: filenames.map(() => 0), uin, loginflag: 1, platform: '20', filename: filenames } },
  };
  const data = await qqRpc(payload, context);
  checkCode(data);
  const result = data.req_1 || data.req_0;
  checkCode(result || {});
  const infos = (result?.data?.midurlinfo || []).filter(item => item?.purl);
  // A platform can return previews for one representation and a full track for
  // another. Full playback takes precedence before selecting highest quality.
  const isPreview = item => /(?:^|\/)RS|preview|trial/i.test(item.purl) || Boolean(item.isPreview || item.is_preview);
  const rank = item => /(?:^|\/)F000[^/]*\.flac/i.test(item.purl) ? 2 : /(?:^|\/)M800[^/]*\.mp3/i.test(item.purl) ? 1 : 0;
  infos.sort((a, b) => Number(isPreview(a)) - Number(isPreview(b)) || rank(b) - rank(a));
  const info = infos[0] || result?.data?.midurlinfo?.[0];
  if (!info?.purl) throw new ProviderError('PLAYBACK_UNAVAILABLE', 'QQ 音乐未授权这首歌的音频。请在应用内登录购买时的 QQ／微信账号；若已登录，请确认该账号的专辑购买权限，或使用官方网页播放。', { platformCode: info?.result });
  const urls = [];
  for (const host of [...(result.data.sip || []), 'https://dl.stream.qqmusic.qq.com/']) {
    try { const candidate = assertUrl(new URL(info.purl, normalizeUrl(host)).href, 'qq', true); if (!urls.includes(candidate)) urls.push(candidate); } catch {}
  }
  if (!urls.length) throw new ProviderError('UNSAFE_URL', 'QQ 音乐没有返回受支持的音频地址。');
  const actual = rank(info) === 2 ? 'lossless' : rank(info) === 1 ? 'high' : 'standard';
  const codec = actual === 'lossless' ? 'flac' : actual === 'high' || /\.mp3(?:\?|$)/i.test(info.purl) ? 'mp3' : 'aac';
  const raw = track.extra?.qqRawSong || {};
  const file = raw.file || {};
  const bytes = Number(actual === 'lossless' ? file.size_flac || raw.sizeflac : actual === 'high' ? file.size_320mp3 || raw.size320 : file.size_96aac || raw.sizeaac);
  const duration = Number(track.durationMs || Number(raw.interval) * 1000);
  const bitrate = actual === 'high' ? 320000 : Number(info.bitrate) > 0 ? Number(info.bitrate) : bytes > 0 && duration > 0 ? Math.round(bytes * 8000 / duration) : undefined;
  const label = actual === 'lossless' ? 'FLAC 无损' : actual === 'high' ? 'MP3 320 kbps' : `${codec === 'mp3' ? 'MP3' : 'AAC'}${bitrate ? ' ' + Math.round(bitrate / 1000) + ' kbps' : ' 标准'}`;
  return withQuality({ url: urls[0], alternatives: urls.slice(1), headers: { Referer: ORIGINS.qq, 'User-Agent': UA }, preview: isPreview(info) }, requested, actual, label, { codec, ...(bitrate ? { bitrate } : {}) });
}

async function resolveBilibili(track, context) {
  let extra = track.extra || {};
  if (!validBvid(extra.bvid || track.sourceId) || !validId(extra.cid)) {
    const imported = await importBilibili(parseUrl(track.url), context);
    extra = imported.tracks[0].extra;
  }
  const bvid = extra.bvid || track.sourceId;
  const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${extra.cid}&qn=16&fnval=16&fnver=0&fourk=0`;
  const data = await jsonRequest(url, 'bilibili', context);
  checkCode(data);
  const requested = requestedQuality(track, context);
  const audio = (data.data?.dash?.audio || []).filter(item => /mp4a/.test(item.codecs || '') || item.mimeType === 'audio/mp4').sort((a, b) => requested === 'standard' ? Number(a.bandwidth || 0) - Number(b.bandwidth || 0) : Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
  if (!audio.length) throw new ProviderError('AUDIO_UNAVAILABLE', '这个视频没有返回可用的独立音轨，可能需要登录或暂不支持听视频。');
  // The primary Bilibili CDN can use a nonstandard PCDN port; prefer its own
  // standard HTTPS backup instead of allowing arbitrary ports or another source.
  for (const item of audio) {
    const candidates = [item.baseUrl || item.base_url, ...(item.backupUrl || item.backup_url || [])].filter(Boolean);
    const urls = [];
    for (const candidate of candidates) {
      try { const safe = assertUrl(candidate, 'bilibili', true); if (!urls.includes(safe)) urls.push(safe); } catch {}
    }
    if (urls.length) {
      const bitrate = Number(item.bandwidth) > 0 ? Number(item.bandwidth) : undefined;
      return { url: urls[0], alternatives: urls.slice(1), headers: { Referer: track.url || ORIGINS.bilibili, 'User-Agent': UA },
        quality: bitrate ? `AAC ${Math.round(bitrate / 1000)} kbps` : 'AAC 官方音轨', preview: Boolean(data.data?.is_preview),
        requestedQuality: requested, actualQuality: bitrate >= 128000 ? 'high' : 'standard', codec: 'aac', ...(bitrate ? { bitrate } : {}) };
    }
  }
  throw new ProviderError('UNSAFE_URL', 'Bilibili 没有返回受支持的 HTTPS 音轨地址。');
}

async function resolveTrack(track, context) {
  if (!track || !ORIGINS[track.platform]) throw new ProviderError('UNSUPPORTED_PLATFORM', '不支持的平台。');
  assertUrl(track.url, track.platform);
  if (track.platform === 'qq') return resolveQq(track, context);
  if (track.platform === 'netease') return resolveNetease(track, context);
  return resolveBilibili(track, context);
}

// Main-process audio proxy: safe redirects plus session cookies, without buffering
// media or attaching a lifetime timeout to a potentially long response stream.
// Only the connection/response headers have a timeout; 416 remains inspectable.
async function fetchMedia(url, platform, context, options = {}) {
  if (!ORIGINS[platform]) throw new ProviderError('UNSUPPORTED_PLATFORM', '不支持的平台。');
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), 20000);
  timer.unref?.();
  try {
    const { response } = await request(url, platform, context, { ...options, signal: controller.signal }, true, true);
    return response;
  } finally {
    clearTimeout(timer);
    // Keep the listener while the returned body is being consumed, so request
    // cancellation/unloading also terminates the upstream stream. It is once-only
    // and attached to this request's signal, not to an application-global object.
  }
}

module.exports = { parseInput, importResource, resolveTrack, fetchMedia, ProviderError, requestPlatformJson: jsonRequest };
