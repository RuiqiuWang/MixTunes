'use strict';
const electron=require('electron');
const {app,BrowserWindow,ipcMain,session,shell,dialog,globalShortcut,Tray,Menu,nativeImage,protocol,nativeTheme}=electron;
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {LibraryStore,normaliseLibrary,safeTrack}=require('./store.cjs');
const {PlayerEngine,errorMessage}=require('./engine.cjs');
const {parseInput,importResource,resolveTrack,fetchMedia}=require('./providers.cjs');
const {TrackExporter}=require('./track-export.cjs');
const {searchPlatform}=require('./search-providers.cjs');
const {SearchService,searchUrl}=require('./search-service.cjs');
const {LyricsService}=require('./lyrics.cjs');
const {PlaylistShare}=require('./playlist-share.cjs');
const {AudioPlayer}=require('./audio-player.cjs');
const {WebPlayer}=require('./web-player.cjs');
const {VideoPlayer}=require('./video-player.cjs');
const {fetchWithSession}=require('./session-fetch.cjs');
const {readQqAuth,readNeteaseAuth,restoredAccountState,inspectAccount}=require('./platform-auth.cjs');
const {closeDecision}=require('./window-lifecycle.cjs');
const {BackgroundStore,averageLuminance}=require('./background.cjs');
const {suggestedScrim}=require('../ui/background-math.js');

protocol.registerSchemesAsPrivileged([{scheme:'mix-audio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
const argValue=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const dataDirectory=argValue('--data-dir');
const testMode=process.argv.includes('--test-mode');
const smokeTest=process.argv.includes('--smoke-test');
// A plain text trace written next to the executable and into the profile folder.
// When the window never shows up this is the only way to tell whether the launch
// was blocked by another instance, crashed, or quit on purpose.
const startupLogPaths=(()=>{const paths=[];try{paths.push(path.join(path.dirname(app.getPath('exe')),'MixTunes-startup.log'));}catch{}return paths;})();
function logStartup(message,detail){
  const line=`${new Date().toISOString()} pid=${process.pid} ${message}${detail===undefined?'':` ${detail}`}\n`;
  for(const file of startupLogPaths){
    try{
      if(!file)continue;
      if(fs.existsSync(file)&&fs.statSync(file).size>256*1024)fs.writeFileSync(file,line);
      else fs.appendFileSync(file,line);
    }catch{}
  }
}
process.on('uncaughtException',error=>{logStartup('UNCAUGHT-EXCEPTION',(error&&error.stack)||String(error));});
process.on('unhandledRejection',error=>{logStartup('UNHANDLED-REJECTION',(error&&error.stack)||String(error));});
logStartup('LAUNCH',`version=${app.getVersion()} exe=${process.execPath}`);
// Keep the established local profile and origin identities across the display
// name change. Explicit test profiles remain fully isolated.
try{
  app.setPath('userData',dataDirectory?path.resolve(dataDirectory):path.join(app.getPath('appData'),'MixLink'));
  app.setPath('sessionData',app.getPath('userData'));
  logStartup('USER-DATA',app.getPath('userData'));
  // Mirror the trace into the profile: the folder holding the exe can be read-only
  // (Program Files, a network share) and then the exe-side copy is never written.
  try{startupLogPaths.push(path.join(app.getPath('userData'),'MixTunes-startup.log'));}catch{}
}catch(error){logStartup('USER-DATA-FAILED',(error&&error.stack)||String(error));}
if(testMode)app.disableHardwareAcceleration();
app.setName('MixTunes');
// Windows taskbar buttons and toasts use the AppUserModelID to pick the icon and
// to group windows; without it a packaged build shows the generic Electron icon.
if(process.platform==='win32')app.setAppUserModelId('local.mixlink.player');
let mainWindow,engine,store,tray,quitting=false,importing=false,trayHintShown=false,backgroundStore=null;
let searchService,lyricsService,playlistShare,trackExporter,trackDownloads;
let accountsTimer=null,accountsRefresh=null,accountsRefreshAgain=false,pendingVideo=null,videoPlayer=null,videoRequestSerial=0;
const loginWindows=new Map();const contexts=new Map();
const uiPath=path.join(__dirname,'../ui/index.html');
const loginUrls={qq:'https://y.qq.com/portal/player.html',netease:'https://music.163.com/',bilibili:'https://www.bilibili.com/'};
const qqQuickLoginUrl=(()=>{
  const callback=new URL('https://y.qq.com/portal/wx_redirect.html');callback.searchParams.set('login_type','1');callback.searchParams.set('surl',loginUrls.qq);callback.searchParams.set('use_customer_cb','0');
  const url=new URL('https://graph.qq.com/oauth2.0/authorize');url.search=new URLSearchParams({response_type:'code',client_id:'100497308',redirect_uri:callback.href,state:'state',display:'pc'}).toString();return url.href;
})();

function sessionFor(platform){
  if(!loginUrls[platform])throw new Error('不支持的平台');
  return session.fromPartition(`persist:mixlink-${platform}`);
}
// Where "下载" saves. 音乐\MixTunes unless the user picked another folder.
function downloadSettingsFile(){return path.join(app.getPath('userData'),'download-settings.json');}
function downloadDirectory(){
  try{const data=JSON.parse(fs.readFileSync(downloadSettingsFile(),'utf8'));if(data&&typeof data.directory==='string'&&data.directory)return data.directory;}catch{}
  return path.join(app.getPath('music'),'MixTunes');
}
function saveDownloadDirectory(directory){
  fs.mkdirSync(app.getPath('userData'),{recursive:true});
  fs.writeFileSync(downloadSettingsFile(),JSON.stringify({directory}),'utf8');
}
let downloadProgressAt=0;
function createTrackDownloads(){
  trackDownloads=new TrackExporter({resolveTrack,fetchMedia,contextFor,directory:downloadDirectory(),indexName:'downloads.json',autoPrune:false,
    onProgress:({key,received,total})=>{
      const now=Date.now();
      if(now-downloadProgressAt<150&&!(total&&received>=total))return;
      downloadProgressAt=now;
      try{mainWindow?.webContents.send('app:download-progress',{key,received,total});}catch{}
    }});
  return trackDownloads;
}
async function getQqAuth(){
  return readQqAuth(await sessionFor('qq').cookies.get({}));
}
async function getNeteaseAuth(){
  return readNeteaseAuth(await sessionFor('netease').cookies.get({}));
}
function contextFor(platform){
  if(!contexts.has(platform))contexts.set(platform,{fetch:(url,options)=>fetchWithSession(electron,sessionFor(platform),url,options),get qualitySettings(){return engine?.state.qualitySettings;},...(platform==='qq'?{getQqAuth}:platform==='netease'?{getNeteaseAuth}:{})});
  return contexts.get(platform);
}
function record(event){
  try{
    fs.mkdirSync(app.getPath('userData'),{recursive:true});
    const file=path.join(app.getPath('userData'),'playback-events.jsonl');
    if(fs.existsSync(file)&&fs.statSync(file).size>2*1024*1024)fs.renameSync(file,file+'.previous');
    fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
  }catch{}
}
function trusted(event){
  if(event.sender!==mainWindow?.webContents||event.senderFrame?.url!==pathToFileURL(uiPath).href)throw new Error('拒绝非应用页面操作');
}
function trackByKey(key){
  if(!key)return undefined;
  if(engine.current()?.key===key)return engine.current();
  return engine.state.tracks.find(track=>track.key===key);
}
// The picture Windows shows while a track file is being dragged out of the window.
let dragIconImage=null;
function dragIcon(){
  try{
    if(dragIconImage!==null)return dragIconImage;
    const source=nativeImage.createFromPath(path.join(__dirname,'../ui/app-icon.png'));
    dragIconImage=source.isEmpty()?null:(source.getSize().width>64?source.resize({width:64,height:64}):source);
    return dragIconImage;
  }catch{return null;}
}
function handler(channel,fn){ipcMain.handle(channel,async(event,...args)=>{
  try{trusted(event);return await fn(...args);}catch(error){return{ok:false,error:errorMessage(error)};}
});}
function publishAccounts(next){
  const previous=engine.state.accounts||{};
  for(const platform of Object.keys(loginUrls)){
    if(['loggedIn','verified','userId','status'].some(field=>previous[platform]?.[field]!==next[platform]?.[field]))lyricsService?.invalidate(platform);
  }
  engine.state.accounts=next;engine.publish();
}
async function updateAccounts(){
  if(!engine||quitting)return;
  if(accountsRefresh){accountsRefreshAgain=true;return accountsRefresh;}
  accountsRefresh=(async()=>{
    const accounts={};
    const platformCookies=new Map();
    for(const platform of Object.keys(loginUrls)){
      let cookies=[];try{cookies=await sessionFor(platform).cookies.get({});}catch{}
      platformCookies.set(platform,cookies);accounts[platform]=restoredAccountState(platform,cookies);
    }
    publishAccounts({...accounts});
    await Promise.all(Object.keys(loginUrls).map(async platform=>{
      try{accounts[platform]=await inspectAccount(platform,contextFor(platform),platformCookies.get(platform));}
      catch{accounts[platform]=restoredAccountState(platform,platformCookies.get(platform));}
    }));
    publishAccounts(accounts);
    if(pendingVideo&&accounts.bilibili?.loggedIn&&accounts.bilibili?.verified){
      const requested=pendingVideo;pendingVideo=null;
      if(videoAllowed(requested.key,requested.playlistId)){
        setTimeout(()=>{if(!quitting&&requested.serial===videoRequestSerial&&engine.state.videoPanel.open&&videoAllowed(requested.key,requested.playlistId))engine.openVideo(requested.key,{playlistId:requested.playlistId}).catch(error=>engine.notice(errorMessage(error)));},0);
      }
    }
    return accounts;
  })();
  try{return await accountsRefresh;}
  finally{accountsRefresh=null;if(accountsRefreshAgain){accountsRefreshAgain=false;scheduleAccountsUpdate();}}
}
function scheduleAccountsUpdate(){
  clearTimeout(accountsTimer);
  accountsTimer=setTimeout(()=>{accountsTimer=null;updateAccounts().catch(()=>{});},800);
}
function loginHostAllowed(platform,url){
  try{
    const u=new URL(url);if(u.protocol!=='https:')return false;
    const roots=platform==='qq'?['qq.com','qzone.com','weixin.qq.com']:platform==='netease'?['163.com','126.com','netease.com']:['bilibili.com','b23.tv'];
    return roots.some(root=>u.hostname===root||u.hostname.endsWith('.'+root));
  }catch{return false;}
}
function openLogin(platform){
  if(!loginUrls[platform])throw new Error('不支持的平台');
  let window=loginWindows.get(platform);
  if(window&&!window.isDestroyed()){window.show();window.focus();return{ok:true,message:'请在官方页面完成登录，完成后关闭该窗口即可。'};}
  window=new BrowserWindow({title:`MixTunes · ${platform==='qq'?'QQ 音乐':platform==='netease'?'网易云':'Bilibili'} 官方登录`,width:1120,height:800,
    autoHideMenuBar:true,show:!testMode,webPreferences:{session:sessionFor(platform),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  loginWindows.set(platform,window);
  const secure=win=>{
    win.webContents.setWindowOpenHandler(({url})=>loginHostAllowed(platform,url)?{action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{session:sessionFor(platform),nodeIntegration:false,contextIsolation:true,sandbox:true}}}:{action:'deny'});
    for(const eventName of ['will-navigate','will-redirect'])win.webContents.on(eventName,(event,url)=>{if(!loginHostAllowed(platform,url))event.preventDefault();});
    win.webContents.on('did-create-window',child=>secure(child));
  };
  secure(window);
  window.on('closed',()=>{loginWindows.delete(platform);scheduleAccountsUpdate();});
  window.loadURL(platform==='qq'?qqQuickLoginUrl:loginUrls[platform]).catch(()=>engine.notice('官方登录页面加载失败，请检查网络后重试。'));
  return{ok:true,message:'请在官方页面登录；应用会保存本机登录状态。'};
}
function videoAllowed(key,playlistId){return playlistId?engine.state.playlists.some(p=>p.id===playlistId&&p.queue.includes(key)):engine.current()?.key===key||engine.state.playlists.some(p=>p.id===engine.state.activePlaylistId&&p.queue.includes(key));}
async function requestVideo(key=engine.snapshot().currentKey,playlistId){
  const track=engine.current()?.key===key?engine.current():engine.state.tracks.find(t=>t.key===key);
  if(track?.platform!=='bilibili'||!videoAllowed(key,playlistId))throw new Error('请选择 Bilibili 内容');
  if(!playlistId&&engine.current()?.key!==key)playlistId=engine.state.activePlaylistId;
  const serial=++videoRequestSerial;
  await engine.setVideoPanel({open:true,expanded:!!engine.state.videoPanel.expanded});
  await updateAccounts();
  if(serial!==videoRequestSerial||!engine.state.videoPanel.open)return{ok:true,canceled:true};
  if(!videoAllowed(key,playlistId))throw new Error('视频已移除，请重新选择');
  if(!engine.state.accounts.bilibili?.loggedIn){
    pendingVideo={key,playlistId,serial};openLogin('bilibili');
    return{ok:true,requiresLogin:true,message:'请先在 Bilibili 官方窗口登录；完成后会用这个账号打开视频。'};
  }
  pendingVideo=null;await engine.openVideo(key,{playlistId});return{ok:true};
}
async function importLinks(text){
  if(importing)throw new Error('正在导入，请等待当前导入完成');
  const resources=parseInput(text);if(resources.length>100)throw new Error('一次最多导入 100 个链接');
  const playlistId=engine.snapshot().activePlaylistId;
  importing=true;let added=0;let total=0;let existingKey=0;let duplicateMetadata=0;const warnings=[];const errors=[];const pendingTracks=[];
  try{
    for(let i=0;i<resources.length;i++){
      const resource=resources[i];engine.notice(`正在读取第 ${i+1}/${resources.length} 个链接…`);
      try{
        const result=await importResource(resource,contextFor(resource.platform));
        const tracks=result.tracks.map(safeTrack).filter(Boolean);
        total+=tracks.length;
        pendingTracks.push(...tracks);
        warnings.push(...(result.warnings||[]));
      }catch(error){errors.push(errorMessage(error));}
    }
    if(!total&&errors.length)throw new Error(errors.join('；'));
    const imported=engine.addTracksDetailed(pendingTracks,playlistId);
    added=imported.added;existingKey=imported.existingKey;duplicateMetadata=imported.duplicateMetadata;
    const message=`新增 ${added} 首${existingKey?`，已存在 ${existingKey} 首`:''}${duplicateMetadata?`，跳过同名同作者 ${duplicateMetadata} 首（保留已有歌曲）`:''}${warnings.length?'；'+warnings.join('；'):''}${errors.length?'；部分链接未导入：'+errors.join('；'):''}`;
    engine.notice(message);return{ok:true,added,total,existingKey,duplicateMetadata,playlistId,warnings,errors,message};
  }finally{importing=false;}
}
async function command(name,payload={}){
  if(!payload||typeof payload!=='object')throw new Error('操作参数无效');
  if(['play','pause','next','previous','video-open','quit'].includes(name))searchService.cancelPlayback?.();
  if(['play','pause','next','previous','playlist-select','playlist-play','playlist-delete','clear','remove','video-close'].includes(name)||name==='video-panel'&&payload.open===false){videoRequestSerial++;pendingVideo=null;}
  switch(name){
    case'play':await engine.playKey(payload.key,{playlistId:payload.playlistId});break;
    case'pause':await engine.pause();break;
    case'next':await engine.next();break;
    case'previous':await engine.previous();break;
    case'seek':await engine.seek(payload.positionMs);break;
    case'volume':await engine.setVolume(payload.volume);break;
    case'rate':await engine.setRate(payload.rate);break;
    case'mute':await engine.setVolume(engine.state.volume,payload.muted);break;
    case'mode':engine.setMode(payload.mode);break;
    case'theme':{
      if(!['light','dark'].includes(payload.theme))throw new Error('主题无效');
      nativeTheme.themeSource=payload.theme;mainWindow?.setBackgroundColor(payload.theme==='dark'?'#181818':'#ffffff');return{ok:true};
    }
    case'quality':engine.setQuality(payload.platform,payload.quality);return{ok:true,message:'音质设置已保存。切歌后应用；当前曲目暂停后再播放会从头应用新音质。'};
    case'track-rename':engine.renameTrack(payload.key,payload.title);return{ok:true,message:'歌曲显示名称已保存。'};
    case'track-range':await engine.setPlayRange(payload.key,{startMs:payload.startMs,endMs:payload.endMs});return{ok:true,message:'这首内容的播放起止时间已保存。'};
    case'video-open':return requestVideo(payload.key||engine.snapshot().currentKey,payload.playlistId);
    case'video-close':pendingVideo=null;await engine.closeVideo();return{ok:true};
    case'video-panel':if(!payload.open)pendingVideo=null;await engine.setVideoPanel({open:payload.open,expanded:payload.expanded??false});return{ok:true};
    case'video-layout':{
      if(typeof payload.visible!=='boolean')throw new Error('视频布局参数无效');
      const b=payload.bounds;if(!b||!['x','y','width','height'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])))throw new Error('视频尺寸无效');
      videoPlayer?.setLayout({visible:payload.visible&&engine.state.videoPanel.open,bounds:b});return{ok:true};
    }
    case'remove':await engine.remove(payload.key);break;
    case'track-move':{
      const moved=engine.moveTrackToPlaylist(payload.key,payload.playlistId,{copy:Boolean(payload.copy)});
      const title=moved.trackTitle||'这首歌';
      return{ok:true,message:moved.copied?`“${moved.playlistName}”里已添加《${title}》`:`已把《${title}》移到“${moved.playlistName}”`};
    }
    case'clear':await engine.clear();break;
    case'reorder':engine.reorder(payload.keys);break;
    case'playlist-create':return{ok:true,id:await engine.createPlaylist(payload.name)};
    case'playlist-select':await engine.selectPlaylist(payload.id);break;
    case'playlist-play':await engine.playPlaylist(payload.id);return{ok:true,message:`正在播放“${engine.playlist(payload.id).name}”。`};
    case'playlist-rename':engine.renamePlaylist(payload.id,payload.name);break;
    case'playlist-delete':await engine.deletePlaylist(payload.id);break;
    case'accounts-refresh':await updateAccounts();return{ok:true,message:'已更新账号状态；如需登录，请打开对应平台的官方登录窗口。'};
    case'quit':setTimeout(()=>{quitting=true;app.quit();},100);return{ok:true};
    default:throw new Error('不支持的操作');
  }
  return{ok:true};
}
// Background pictures are returned to the renderer as a downscaled JPEG data URL.
// They are never part of engine state: that is published on every playback tick.
function backgroundPayload(){
  const settings=backgroundStore.settings;
  let image=null;
  const file=backgroundStore.imagePath();
  if(settings.file&&file&&fs.existsSync(file)){
    try{
      const source=nativeImage.createFromPath(file);
      if(!source.isEmpty()){
        const {width}=source.getSize();
        const scaled=width>1920?source.resize({width:1920,quality:'good'}):source;
        image=`data:image/jpeg;base64,${scaled.toJPEG(82).toString('base64')}`;
      }
    }catch{}
  }
  return{...settings,image};
}
function publishBackground(){
  if(!mainWindow||mainWindow.isDestroyed())return;
  mainWindow.webContents.send('app:background',backgroundPayload());
}
function setupIpc(){  handler('app:state',()=>engine.snapshot());handler('app:import-links',importLinks);handler('app:command',command);
  handler('app:search',payload=>searchService.search(payload));
  handler('app:search-add',payload=>searchService.add(payload));
  handler('app:search-play',payload=>{pendingVideo=null;videoRequestSerial++;return searchService.play(payload);});
  handler('app:lyrics',key=>lyricsService.get(key));
  handler('app:share-start',()=>playlistShare.start());
  handler('app:share-stop',()=>playlistShare.stop());
  handler('app:search-open',async payload=>{if(!payload||typeof payload!=='object')throw new Error('搜索参数无效');await shell.openExternal(searchUrl(payload.platform,payload.query));return{ok:true};});
  handler('app:login',openLogin);
  handler('app:background-get',async()=>({ok:true,background:backgroundPayload()}));
  handler('app:background-choose',async theme=>{
    const {filePaths,canceled}=await dialog.showOpenDialog(mainWindow,{title:'选择背景图片',properties:['openFile'],filters:[{name:'图片',extensions:['jpg','jpeg','png','webp','bmp']}]});
    if(canceled)return{ok:true,canceled:true};
    const file=backgroundStore.adopt(filePaths[0]);
    const luminance=averageLuminance(nativeImage.createFromPath(backgroundStore.imagePath()));
    // Seed the scrim from the picture brightness so a new image is readable at once.
    backgroundStore.save({file,dim:suggestedScrim(luminance,theme),blur:0,luminance});
    publishBackground();
    return{ok:true,background:backgroundPayload(),message:'背景图片已更新。'};
  });
  handler('app:background-set',async payload=>{
    if(!payload||typeof payload!=='object')throw new Error('背景参数无效');
    const current=backgroundStore.settings;
    backgroundStore.save({...current,dim:payload.dim??current.dim,blur:payload.blur??current.blur});
    publishBackground();
    return{ok:true,background:backgroundPayload()};
  });
  handler('app:background-clear',async()=>{backgroundStore.clear();publishBackground();return{ok:true,background:backgroundPayload(),message:'已恢复纯色背景。'};});
  handler('app:source',async key=>{
    const track=trackByKey(key);if(!track)throw new Error('歌曲不存在');
    await shell.openExternal(safeTrack(track).url);return{ok:true};
  });
  // Which of the listed songs already sit in the local export cache, so the rows
  // can show that dragging them out will be instant.
  handler('app:track-file-status',async keys=>{
    if(!Array.isArray(keys))throw new Error('歌曲列表无效');
    return{ok:true,ready:trackExporter.readyKeys(keys.slice(0,500).map(trackByKey).filter(Boolean))};
  });
  handler('app:track-prepare',async key=>{
    const track=trackByKey(key);if(!track)throw new Error('歌曲不存在');
    const result=await trackExporter.ensure(track);
    return{ok:true,path:result.path,name:path.basename(result.path),cached:result.cached};
  });
  handler('app:track-save-as',async key=>{
    const track=trackByKey(key);if(!track)throw new Error('歌曲不存在');
    // An already-downloaded song is copied straight from the download folder.
    const source=trackDownloads.cachedPath(track)||(await trackExporter.ensure(track)).path;
    const extension=path.extname(source).replace(/^\./,'')||'mp3';
    const {filePath,canceled}=await dialog.showSaveDialog(mainWindow,{title:'导出歌曲文件',defaultPath:path.basename(source),
      filters:[{name:'音频文件',extensions:[extension]}]});
    if(canceled||!filePath)return{ok:true,canceled:true};
    fs.copyFileSync(source,filePath);
    return{ok:true,message:`已导出 ${path.basename(filePath)}`};
  });
  // Permanent downloads: 音乐\MixTunes by default, listed so rows can carry a
  // "已下载" mark and clicking it can reveal the file in Explorer.
  handler('app:track-download-status',async keys=>{
    if(!Array.isArray(keys))throw new Error('歌曲列表无效');
    return{ok:true,downloaded:trackDownloads.readyKeys(keys.slice(0,500).map(trackByKey).filter(Boolean))};
  });
  handler('app:track-download',async key=>{
    const track=trackByKey(key);if(!track)throw new Error('歌曲不存在');
    const result=await trackDownloads.ensure(track);
    const label=track.displayTitle||track.title||'歌曲';
    return{ok:true,path:result.path,name:path.basename(result.path),cached:result.cached,
      message:result.cached?`《${label}》已经下载过：${path.dirname(result.path)}`:`已下载《${label}》到 ${path.dirname(result.path)}`};
  });
  handler('app:track-reveal',async key=>{
    const track=trackByKey(key);const file=trackDownloads.cachedPath(track);
    if(!file)throw new Error('这首歌还没有下载');
    shell.showItemInFolder(file);return{ok:true};
  });
  handler('app:downloads-info',async()=>{
    const directory=downloadDirectory();
    const keys=trackDownloads.readyKeys(engine.state.tracks||[]);
    return{ok:true,directory,count:keys.length};
  });
  handler('app:downloads-choose',async()=>{
    const {filePaths,canceled}=await dialog.showOpenDialog(mainWindow,{title:'选择下载文件夹',properties:['openDirectory','createDirectory']});
    if(canceled||!filePaths?.[0])return{ok:true,canceled:true,directory:downloadDirectory()};
    saveDownloadDirectory(filePaths[0]);createTrackDownloads();
    return{ok:true,directory:downloadDirectory(),message:`下载文件夹已改为 ${downloadDirectory()}`};
  });
  handler('app:downloads-open',async()=>{const dir=downloadDirectory();fs.mkdirSync(dir,{recursive:true});await shell.openPath(dir);return{ok:true};});
  // Native file drag. The renderer only asks once it knows the file exists, so
  // Windows can put a real CF_HDROP into the drag payload straight away.
  ipcMain.on('app:track-drag-out',(event,key)=>{
    try{
      trusted(event);
      const track=trackByKey(key);
      // Prefer the permanent download; fall back to the drag cache.
      const file=trackDownloads?.cachedPath(track)||trackExporter.cachedPath(track);
      if(!file)return;
      const icon=dragIcon();
      event.sender.startDrag(icon?{file,icon}:{file});
    }catch(error){try{engine?.notice(errorMessage(error));}catch{}}
  });
  handler('app:export',async()=>{
    const {filePath,canceled}=await dialog.showSaveDialog(mainWindow,{title:'导出本地歌单备份',defaultPath:'MixTunes-歌单备份.json',filters:[{name:'JSON 歌单',extensions:['json']}]});
    if(canceled)return{ok:true,canceled:true};
    const data=normaliseLibrary(engine.snapshot());
    fs.writeFileSync(filePath,JSON.stringify(data,null,2),'utf8');return{ok:true,message:'已导出全部混合歌单备份，不包含账号登录信息。'};
  });
  handler('app:import-file',async()=>{
    const {filePaths,canceled}=await dialog.showOpenDialog(mainWindow,{title:'导入歌单文件',properties:['openFile'],filters:[{name:'歌单或链接列表',extensions:['json','txt','csv']}]});
    if(canceled)return{ok:true,canceled:true};
    const file=filePaths[0];if(fs.statSync(file).size>12*1024*1024)throw new Error('文件大于 12 MB，请分批导入');
    const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
    if(path.extname(file).toLowerCase()==='.json'){
      const data=JSON.parse(text);if(!Array.isArray(data.tracks))throw new Error('需要 MixTunes 或旧版 MixLink 的歌单备份');
      const imported=await engine.importBackup(data);
      const message=`从备份${imported.playlistsCreated?`恢复 ${imported.playlistsCreated} 个歌单，`:''}新增 ${imported.added} 首歌曲${imported.existingKey?`，已存在 ${imported.existingKey} 首`:''}${imported.duplicateMetadata?`，跳过同名同作者 ${imported.duplicateMetadata} 首（保留已有歌曲）`:''}。`;
      return{ok:true,...imported,message};
    }
    return importLinks(text);
  });
}
// Windows frequently ignores a bare focus() call for a window that was hidden or
// minimised, so restore it, raise it briefly on top and flash the taskbar button.
let wakePending=false;
function showPlayer(){
  if(!mainWindow||mainWindow.isDestroyed()){wakePending=true;return;}
  wakePending=false;
  const hidden=!mainWindow.isVisible()||mainWindow.isMinimized();
  try{
    if(mainWindow.isMinimized())mainWindow.restore();
    if(!mainWindow.isVisible())mainWindow.show();
    mainWindow.setAlwaysOnTop(true);mainWindow.focus();
    setTimeout(()=>{try{if(!mainWindow.isDestroyed())mainWindow.setAlwaysOnTop(false);}catch{}},400);
    if(hidden&&process.platform==='win32'){
      mainWindow.flashFrame(true);
      mainWindow.once('focus',()=>{try{mainWindow.flashFrame(false);}catch{}});
      try{tray&&tray.displayBalloon({title:'MixTunes',content:'播放器窗口已经打开'});}catch{}
    }
  }catch{}
}
function trayImage(){
  // Windows shows a 16 px tray glyph at 100 % scaling, so ship a 32 px PNG and a
  // 64 px representation for 200 % displays. Without them the tray renders blank.
  const base=nativeImage.createFromPath(path.join(__dirname,'../ui/tray.png'));
  const large=nativeImage.createFromPath(path.join(__dirname,'../ui/tray@2x.png'));
  if(base.isEmpty()){
    // Some packaged layouts cannot read the PNG through the asar path; fall back
    // to the window icon so the tray still gets a real bitmap.
    const fallback=nativeImage.createFromPath(path.join(__dirname,'../ui/app-icon.png'));
    return fallback.isEmpty()?fallback:fallback.resize({width:32,height:32});
  }
  if(!large.isEmpty())base.addRepresentation({scaleFactor:2,buffer:large.toPNG()});
  return base;
}
function setupTray(){
  try{
    const icon=trayImage();
    if(icon.isEmpty()){record({type:'tray-error',reason:'empty-icon'});return;}
    tray=new Tray(icon);tray.setToolTip('MixTunes');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'显示播放器',click:showPlayer},
      {label:'播放 / 暂停',click:()=>command(engine.state.status==='playing'?'pause':'play').catch(()=>{})},
      {label:'上一首',click:()=>command('previous').catch(()=>{})},
      {label:'下一首',click:()=>command('next').catch(()=>{})},
      {type:'separator'}, {label:'退出 MixTunes',click:()=>{quitting=true;app.quit();}}
    ]));
    tray.on('double-click',showPlayer);
    tray.on('click',showPlayer);
    record({type:'tray-ready'});
  }catch(error){
    record({type:'tray-error',message:errorMessage(error)});
  }
}
async function start(){
  store=new LibraryStore(app.getPath('userData'));const library=store.load();
  backgroundStore=new BackgroundStore(app.getPath('userData'));
  if(testMode){library.muted=true;library.volume=0;}
  const audio=new AudioPlayer({electron,sessionFor,onEvent:event=>engine?.onEvent(event),onDiagnostic:record});
  const web=new WebPlayer({electron,sessionFor,onEvent:event=>engine?.onEvent({...event,backend:'web'})});
  const video=new VideoPlayer({electron,sessionFor,getHostWindow:()=>mainWindow,onEvent:event=>engine?.onEvent({...event,backend:'video'})});videoPlayer=video;
  engine=new PlayerEngine({library,resolveTrack,contextFor,audio,web,video,persist:state=>store.save(state),record});
  searchService=new SearchService({searchPlatform,contextFor,importResource,parseInput,safeTrack,engine});
  lyricsService=new LyricsService({engine,contextFor});
  playlistShare=new PlaylistShare({getLibrary:()=>engine.snapshot(),apkPath:()=>path.join(process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(app.getPath('exe')),`MixTunes-Android-${app.getVersion()}.apk`)});
  trackExporter=new TrackExporter({resolveTrack,fetchMedia,contextFor,directory:path.join(app.getPath('userData'),'track-cache')});
  // User-visible downloads live in 音乐\MixTunes (or the chosen folder), keep their
  // own index and are never evicted by the drag cache's size limit.
  createTrackDownloads();
  nativeTheme.themeSource='light';
  mainWindow=new BrowserWindow({title:'MixTunes',width:1240,height:840,minWidth:960,minHeight:680,show:!testMode&&!smokeTest,
    icon:path.join(__dirname,'../ui/app-icon.png'),
    backgroundColor:'#ffffff',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(uiPath).href)event.preventDefault();});
  // 关闭窗口 = 退出：音乐停下、托盘一起收掉。
  // 想边听边收起来请用标题栏的最小化（—），最小化不会动播放。
  mainWindow.on('close',(event)=>{
    if(quitting)return;
    event.preventDefault();
    quitting=true;
    try{engine.audio?.stopAll?.();}catch{}
    record({type:'window-close-quit'});
    app.quit();
  });
  mainWindow.on('closed',()=>{if(!quitting){quitting=true;app.quit();}});
  engine.on('state',state=>{if(!mainWindow.isDestroyed())mainWindow.webContents.send('app:state',state);});
  engine.on('notice',notice=>{if(!mainWindow.isDestroyed())mainWindow.webContents.send('app:notice',notice);});
  setupIpc();await mainWindow.loadFile(uiPath);setupTray();
  logStartup('WINDOW-READY',`url=${mainWindow.webContents.getURL()}`);
  if(!testMode&&!smokeTest){try{mainWindow.show();mainWindow.focus();}catch{}}
  await updateAccounts();
  for(const platform of Object.keys(loginUrls))sessionFor(platform).cookies.on('changed',scheduleAccountsUpdate);
  for(const [key,action] of [['MediaPlayPause',()=>command(engine.state.status==='playing'?'pause':'play')],['MediaNextTrack',()=>command('next')],['MediaPreviousTrack',()=>command('previous')]]){
    try{globalShortcut.register(key,()=>action().catch(()=>{}));}catch{}
  }
  record({type:'app-ready',version:app.getVersion(),testMode});
  logStartup('APP-READY',`version=${app.getVersion()}`);
  // A second launch that arrived while start() was still running asked for the window
  // before it existed; honour it now.
  if(wakePending)showPlayer();
  // The window can still end up behind other windows or never raised at all. Give it
  // one more chance after the UI has settled instead of leaving a silent launch.
  if(!testMode&&!smokeTest)setTimeout(()=>{
    try{
      if(quitting||!mainWindow||mainWindow.isDestroyed())return;
      if(!mainWindow.isVisible()||mainWindow.isMinimized()){logStartup('WATCHDOG-SHOW','window not visible 6s after app-ready');showPlayer();}
    }catch{}
  },6000);
  if(smokeTest){
    fs.writeFileSync(path.join(app.getPath('userData'),'smoke-result.json'),JSON.stringify({ok:true,version:app.getVersion(),packaged:app.isPackaged,uiUrl:mainWindow.webContents.getURL(),at:new Date().toISOString()}));
    setTimeout(()=>{quitting=true;app.quit();},1200);
  }
}
const singleInstance=testMode?true:app.requestSingleInstanceLock();
logStartup('SINGLE-INSTANCE-LOCK',String(singleInstance));
if(!singleInstance){
  // The already running instance receives second-instance and raises its own window.
  // Nothing here may open a window, otherwise two copies would fight over the profile.
  // Quitting silently used to look exactly like "the app will not start", so say so.
  logStartup('QUIT','another MixTunes instance already owns this profile');
  if(!testMode&&!smokeTest){
    try{
      dialog.showErrorBox('MixTunes 已经在运行',
        '已经有一个 MixTunes 打开着（可能收在右下角托盘里），已经请它把窗口显示出来了。\n\n'+
        '如果还是看不到窗口：\n'+
        '1. 右键任务栏 → 任务管理器 → 结束所有 MixTunes 进程；\n'+
        '2. 重新双击 MixTunes.exe。');
    }catch{}
  }
  app.quit();
}
else{
  app.on('second-instance',()=>{logStartup('SECOND-INSTANCE');showPlayer();});
  app.whenReady().then(start).catch(error=>{logStartup('STARTUP-ERROR',(error&&error.stack)||String(error));record({type:'startup-error',message:errorMessage(error)});if(!testMode)dialog.showErrorBox('MixTunes 启动失败',errorMessage(error));app.exit(1);});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{
  quitting=true;clearTimeout(accountsTimer);globalShortcut.unregisterAll();searchService?.close();playlistShare?.stop();if(engine){try{store.save(engine.snapshot());}catch{}engine.close();}
  for(const window of loginWindows.values())if(!window.isDestroyed())window.destroy();
  tray?.destroy();
});
