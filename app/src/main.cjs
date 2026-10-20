'use strict';
const electron=require('electron');
const {app,BrowserWindow,ipcMain,session,shell,dialog,globalShortcut,Menu,protocol,nativeTheme}=electron;
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {LibraryStore,normaliseLibrary,safeTrack}=require('./store.cjs');
const {PlayerEngine,errorMessage}=require('./engine.cjs');
const {parseInput,importResource,resolveTrack}=require('./providers.cjs');
const {searchPlatform}=require('./search-providers.cjs');
const {SearchService,searchUrl}=require('./search-service.cjs');
const {LyricsService}=require('./lyrics.cjs');
const {PlaylistShare}=require('./playlist-share.cjs');
const {AudioPlayer}=require('./audio-player.cjs');
const {WebPlayer}=require('./web-player.cjs');
const {VideoPlayer}=require('./video-player.cjs');
const {fetchWithSession}=require('./session-fetch.cjs');
const {readQqAuth,readNeteaseAuth,restoredAccountState,inspectAccount}=require('./platform-auth.cjs');
const {createSleepTimer,validMinutes,shouldPause}=require('./sleep-timer.cjs');
const {restoreMainWindow,installMainWindowLifecycle}=require('./window-lifecycle.cjs');
const {trayMenuTemplate,createAppTray}=require('./tray.cjs');
const {createAppPageGuard}=require('./app-page.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'mix-audio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
const argValue=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const dataDirectory=argValue('--data-dir');
const testMode=process.argv.includes('--test-mode');
const smokeTest=process.argv.includes('--smoke-test');
// Keep the established local profile and origin identities across the display
// name change. Explicit test profiles remain fully isolated.
app.setPath('userData',dataDirectory?path.resolve(dataDirectory):path.join(app.getPath('appData'),'MixLink'));
app.setPath('sessionData',app.getPath('userData'));
if(testMode)app.disableHardwareAcceleration();
app.setName('MixTunes');
let mainWindow,engine,store,trayController,quitting=false,importing=false,sleepTimer=null;
let searchService,lyricsService,playlistShare;
let accountsTimer=null,accountsRefresh=null,accountsRefreshAgain=false,pendingVideo=null,videoPlayer=null,videoRequestSerial=0;
const loginWindows=new Map();const contexts=new Map();
const uiPath=path.join(__dirname,'../ui/index.html');
const appPage=createAppPageGuard(uiPath);
const loginUrls={qq:'https://y.qq.com/portal/player.html',netease:'https://music.163.com/',bilibili:'https://www.bilibili.com/'};
const qqQuickLoginUrl=(()=>{
  const callback=new URL('https://y.qq.com/portal/wx_redirect.html');callback.searchParams.set('login_type','1');callback.searchParams.set('surl',loginUrls.qq);callback.searchParams.set('use_customer_cb','0');
  const url=new URL('https://graph.qq.com/oauth2.0/authorize');url.search=new URLSearchParams({response_type:'code',client_id:'100497308',redirect_uri:callback.href,state:'state',display:'pc'}).toString();return url.href;
})();

function sessionFor(platform){
  if(!loginUrls[platform])throw new Error('不支持的平台');
  return session.fromPartition(`persist:mixlink-${platform}`);
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
  if(!appPage.accepts(event,mainWindow?.webContents))throw new Error('拒绝非应用页面操作');
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
  const secure=target=>{
    target.webContents.setWindowOpenHandler(({url})=>loginHostAllowed(platform,url)?{action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{session:sessionFor(platform),nodeIntegration:false,contextIsolation:true,sandbox:true}}}:{action:'deny'});
    for(const eventName of ['will-navigate','will-redirect'])target.webContents.on(eventName,(event,url)=>{if(!loginHostAllowed(platform,url))event.preventDefault();});
    target.webContents.on('did-create-window',child=>secure(child));
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
  if(['play','pause','next','previous','playlist-select','playlist-delete','clear','remove','video-close'].includes(name)||name==='video-panel'&&payload.open===false){videoRequestSerial++;pendingVideo=null;}
  switch(name){
    case'play':await engine.playKey(payload.key,{playlistId:payload.playlistId});break;
    case'pause':await engine.pause();break;
    case'next':await engine.next();break;
    case'previous':await engine.previous();break;
    case'seek':await engine.seek(payload.positionMs);break;
    case'volume':await engine.setVolume(payload.volume,engine.state.muted,payload.save!==false);break;
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
    case'clear':await engine.clear();break;
    case'reorder':engine.reorder(payload.keys);break;
    case'playlist-create':return{ok:true,id:await engine.createPlaylist(payload.name)};
    case'playlist-select':await engine.selectPlaylist(payload.id);break;
    case'playlist-rename':engine.renamePlaylist(payload.id,payload.name);break;
    case'playlist-delete':await engine.deletePlaylist(payload.id);break;
    case'accounts-refresh':await updateAccounts();return{ok:true,message:'已更新账号状态；如需登录，请打开对应平台的官方登录窗口。'};
    case'quit':sleepTimer?.cancel();setTimeout(()=>{quitting=true;app.quit();},100);return{ok:true};
    default:throw new Error('不支持的操作');
  }
  return{ok:true};
}
function setupIpc(){
  handler('app:state',()=>engine.snapshot());handler('app:import-links',importLinks);handler('app:command',command);
  handler('app:sleep-timer',async(action,payload={})=>{
    if(action==='get')return{ok:true,...sleepTimerState()};
    if(action==='cancel'){sleepTimer.cancel();return{ok:true,...publishSleepTimer()};}
    if(action==='set'){
      if(!validMinutes(payload?.minutes))throw new Error('睡眠定时器需为 1～240 分钟的整数');
      sleepTimer.startMinutes(payload.minutes);return{ok:true,...publishSleepTimer()};
    }
    throw new Error('无效的睡眠定时器操作');
  });
  handler('app:search',payload=>searchService.search(payload));
  handler('app:search-add',payload=>searchService.add(payload));
  handler('app:search-play',payload=>{pendingVideo=null;videoRequestSerial++;return searchService.play(payload);});
  handler('app:lyrics',key=>lyricsService.get(key));
  handler('app:share-start',()=>playlistShare.start());
  handler('app:share-stop',()=>playlistShare.stop());
  handler('app:search-open',async payload=>{if(!payload||typeof payload!=='object')throw new Error('搜索参数无效');await shell.openExternal(searchUrl(payload.platform,payload.query));return{ok:true};});
  handler('app:login',openLogin);
  handler('app:source',async key=>{
    const track=engine.current()?.key===key?engine.current():engine.state.tracks.find(t=>t.key===key);if(!track)throw new Error('歌曲不存在');
    await shell.openExternal(safeTrack(track).url);return{ok:true};
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
function sleepTimerState(){return sleepTimer?.snapshot()||{active:false,endsAt:null,remainingMs:0,minutes:null};}
function publishSleepTimer(state=sleepTimerState()){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('app:sleep-timer',state);return state;}
async function expireSleepTimer(){
  // Cancel pre-deadline requests even when no backend is currently playing.
  searchService?.cancelPlayback();videoRequestSerial++;pendingVideo=null;
  const status=engine?.state.status;const pause=shouldPause(status);
  app.__mixSleepTestLog?.push({type:'sleep-timer-expire',status:status||null,pause,at:Date.now()});
  publishSleepTimer();
  if(!pause)return;
  try{await engine.pause();record({type:'sleep-timer-pause',status});}catch(error){record({type:'sleep-timer-pause-error',message:errorMessage(error)});}
  publishSleepTimer();
}
function setupTray(){
  if(!trayController)trayController=createAppTray({
    electron,
    iconPath:path.join(__dirname,'../ui/tray.png'),
    template:()=>trayMenuTemplate({
      onRestore:()=>restoreMainWindow(mainWindow),
      onToggle:()=>command(engine.state.status==='playing'?'pause':'play').catch(()=>{}),
      onNext:()=>command('next').catch(()=>{}),
      onQuit:()=>{quitting=true;app.quit();}
    }),
    restore:()=>restoreMainWindow(mainWindow),
    record
  });
  return Boolean(trayController.ensure());
}
async function start(){
  store=new LibraryStore(app.getPath('userData'));let library;
  try{library=store.load();}catch(error){
    if(testMode||smokeTest)throw error;
    const candidate=store.recoveryCandidate();
    const buttons=['退出','选择备份文件',...(candidate?[`恢复自动备份（${candidate.tracks} 首）`]:[])];
    const choice=await dialog.showMessageBox({type:'error',title:'歌单读取失败',message:errorMessage(error),detail:'恢复前会保留原文件。',buttons,defaultId:0,cancelId:0});
    if(choice.response===0){app.exit(1);return;}
    let text=candidate?.text;
    if(choice.response===1){const picked=await dialog.showOpenDialog({title:'恢复歌单备份',properties:['openFile'],filters:[{name:'MixTunes 备份',extensions:['json']}]});if(picked.canceled){app.exit(1);return;}text=fs.readFileSync(picked.filePaths[0],'utf8').replace(/^\uFEFF/,'');}
    library=store.restore(text);
  }
  if(testMode){library.muted=true;library.volume=0;}
  const audio=new AudioPlayer({electron,sessionFor,onEvent:event=>engine?.onEvent(event),onDiagnostic:record});
  const web=new WebPlayer({electron,sessionFor,onEvent:event=>engine?.onEvent({...event,backend:'web'})});
  const video=new VideoPlayer({electron,sessionFor,getHostWindow:()=>mainWindow,onEvent:event=>engine?.onEvent({...event,backend:'video'})});videoPlayer=video;
  engine=new PlayerEngine({library,resolveTrack,contextFor,audio,web,video,persist:state=>store.save(state),record});
  sleepTimer=createSleepTimer({onExpire:()=>{expireSleepTimer().catch(()=>{});}});
  if(testMode)app.__mixSleepTest={
    startSeconds:seconds=>{sleepTimer.startMs(Number(seconds)*1000);return publishSleepTimer();},
    state:()=>sleepTimerState(),
    forceStatus:status=>{engine.state.status=status;engine.publish();return engine.state.status;},
    status:()=>engine.state.status,
    snapshot:()=>engine.snapshot(),
    log:app.__mixSleepTestLog=[]
  };
  searchService=new SearchService({searchPlatform,contextFor,importResource,parseInput,safeTrack,engine});
  lyricsService=new LyricsService({engine,contextFor});
  playlistShare=new PlaylistShare({getLibrary:()=>engine.snapshot(),apkPath:()=>path.join(process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(app.getPath('exe')),`MixTunes-Android-${app.getVersion()}.apk`)});
  nativeTheme.themeSource='light';
  mainWindow=new BrowserWindow({title:'MixTunes',width:1240,height:840,minWidth:960,minHeight:680,show:!testMode&&!smokeTest,
    backgroundColor:'#ffffff',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(!appPage.matchesUrl(url))event.preventDefault();});
  // Hide on close while the tray exists so playback keeps running; fall back to
  // a real close when it does not, so a missing tray can never strand the app.
  installMainWindowLifecycle(mainWindow,{
    trayAvailable:()=>Boolean(trayController?.available()),
    isQuitting:()=>quitting,
    onQuit:()=>{quitting=true;app.quit();},
    onFirstHide:()=>{try{trayController?.get()?.displayBalloon?.({title:'MixTunes',content:'MixTunes 已在后台运行，可从系统托盘重新打开。',iconType:'info'});}catch{}}
  });
  engine.on('state',state=>{if(!mainWindow.isDestroyed())mainWindow.webContents.send('app:state',state);});
  engine.on('notice',notice=>{if(!mainWindow.isDestroyed())mainWindow.webContents.send('app:notice',notice);});
  setupIpc();await mainWindow.loadURL(pathToFileURL(uiPath).href);setupTray();await updateAccounts();
  for(const platform of Object.keys(loginUrls))sessionFor(platform).cookies.on('changed',scheduleAccountsUpdate);
  for(const [key,action] of [['MediaPlayPause',()=>command(engine.state.status==='playing'?'pause':'play')],['MediaNextTrack',()=>command('next')],['MediaPreviousTrack',()=>command('previous')]]){
    try{globalShortcut.register(key,()=>action().catch(()=>{}));}catch{}
  }
  record({type:'app-ready',version:app.getVersion(),testMode});
  if(smokeTest){
    fs.writeFileSync(path.join(app.getPath('userData'),'smoke-result.json'),JSON.stringify({ok:true,version:app.getVersion(),packaged:app.isPackaged,trayAvailable:Boolean(trayController?.available()),uiUrl:mainWindow.webContents.getURL(),at:new Date().toISOString()}));
    setTimeout(()=>{quitting=true;app.quit();},1200);
  }
}
if(!testMode&&!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',()=>restoreMainWindow(mainWindow));
  app.whenReady().then(start).catch(error=>{record({type:'startup-error',message:errorMessage(error)});if(!testMode)dialog.showErrorBox('MixTunes 启动失败',errorMessage(error));app.exit(1);});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{
  quitting=true;sleepTimer?.cancel();clearTimeout(accountsTimer);globalShortcut.unregisterAll();searchService?.close();playlistShare?.stop();if(engine){try{store.save(engine.snapshot());}catch{}engine.close();}
  for(const window of loginWindows.values())if(!window.isDestroyed())window.destroy();
  trayController?.destroy();
});
