'use strict';
(() => {
  const req=window.__mixRequire,{native,nativeFetch}=window.__mixPlatform;
  const {PlayerEngine,errorMessage}=req('./engine.cjs'),{normaliseLibrary,safeTrack}=req('./store.cjs');
  const {parseInput,importResource,resolveTrack}=req('./providers.cjs'),{searchPlatform}=req('./search-providers.cjs'),{SearchService,searchUrl}=req('./search-service.cjs');
  const {readQqAuth,readNeteaseAuth,restoredAccountState,inspectAccount}=req('./platform-auth.cjs');
  const {LyricsService}=req('./lyrics.cjs'),{normaliseShareLink}=req('./share-link.cjs');
  const {mergeTransferredLibrary}=req('./playlist-transfer.cjs'),{shouldPause}=req('./sleep-timer.cjs');
  const {chooseLibrary,parseSaved}=req('./library-recovery.cjs');
  const stateListeners=new Set(),noticeListeners=new Set(),contexts=new Map();
  let engine,searchService,lyricsService,importing=false,saveQueue=Promise.resolve(),accountsPromise=null,accountsRefreshAgain=false,pendingVideo=null,videoRequest=0,transportRequest=0,savedAt=0;
  const libraryKey='mixtunes-library-v2';
  let storageLocked=false,recoveryText=null,recoveryReason='';
  function notice(message){for(const fn of noticeListeners){try{fn(errorMessage(message));}catch{}}}
  function persist(state){
    if(storageLocked)return;
    savedAt=Math.max(Date.now(),savedAt+1);
    const json=JSON.stringify({...normaliseLibrary(state),_mixtunesSavedAt:savedAt},null,2);
    try{localStorage.setItem(libraryKey,json);}catch{}
    saveQueue=saveQueue.catch(()=>{}).then(()=>native('storage-save',{json})).catch(()=>notice('歌单暂未保存，请稍后重试'));
  }
  function contextFor(platform){
    if(!contexts.has(platform))contexts.set(platform,{fetch:nativeFetch,get qualitySettings(){return engine?.state.qualitySettings;},
      ...(platform==='qq'?{getQqAuth:async()=>readQqAuth(await native('cookies',{platform}))}:platform==='netease'?{getNeteaseAuth:async()=>readNeteaseAuth(await native('cookies',{platform}))}:{})});
    return contexts.get(platform);
  }
  const dispatch=(method,payload)=>native(method,payload).catch(error=>notice(error));
  class NativeAudio{
    async load(track,generation,resolved,slot=0,volume=.8,muted=false){
      return native('audio-load',{url:resolved.url,alternatives:resolved.alternatives||[],headers:resolved.headers||{},platform:track.platform,key:track.key,generation,slot,volume,muted,title:track.displayTitle||track.title,artist:track.artist,startMs:track.playRange?.startMs||0,endMs:track.playRange?.endMs??null});
    }
    activate(entry){if(entry)dispatch('audio-activate',{token:entry.token});}
    pause(entry){dispatch('audio-pause',{token:entry?.token});}
    seek(entry,positionMs){if(entry)dispatch('audio-seek',{token:entry.token,positionMs});}
    setRange(entry,range){if(entry)dispatch('audio-range',{token:entry.token,startMs:range.startMs,endMs:range.endMs});}
    stopAll(){dispatch('audio-stop',{});}
    volume(volume,muted){dispatch('audio-volume',{volume,muted});}
    unload(entry){if(entry)dispatch('audio-unload',{token:entry.token});}
    destroy(){dispatch('audio-destroy',{});}
  }
  class NativeWeb{
    constructor(kind){this.kind=kind;this.current=null;this.supported=kind!=='web';}
    async load(track,generation,range){this.current={key:track.key,generation};return native(this.kind+'-load',{url:track.url,platform:track.platform,key:track.key,generation,title:track.displayTitle||track.title,startMs:range.startMs,endMs:range.endMs,visible:!!engine.state.videoPanel.open});}
    async play(generation){if(this.current&&this.current.generation===generation)return native(this.kind+'-play',{generation});}
    async pause(){if(this.current)return native(this.kind+'-pause',{});}
    async seek(positionMs){if(this.current)return native(this.kind+'-seek',{positionMs});}
    async setVolume(volume){if(this.current)return native(this.kind+'-volume',{volume});}
    async setRange(range){if(this.current)return native(this.kind+'-range',{startMs:range.startMs,endMs:range.endMs});}
    async setLayout(layout){if(this.kind==='video'&&this.current)return native('video-layout',layout);}
    async close(){if(!this.current)return;this.current=null;return native(this.kind+'-close',{});}
    destroy(){this.close().catch(()=>{});}
  }
  function publishAccounts(next){
    const previous=engine.state.accounts||{};
    for(const platform of ['qq','netease','bilibili']){
      if(['loggedIn','verified','userId','status'].some(field=>previous[platform]?.[field]!==next[platform]?.[field]))lyricsService?.invalidate(platform);
    }
    engine.state.accounts=next;engine.publish();
  }
  async function updateAccounts(){
    if(accountsPromise){accountsRefreshAgain=true;return accountsPromise;}
    accountsPromise=(async()=>{
      const cookies=await Promise.all(['qq','netease','bilibili'].map(async platform=>{try{return[platform,await native('cookies',{platform})];}catch{return[platform,[]];}}));
      publishAccounts(Object.fromEntries(cookies.map(([platform,list])=>[platform,restoredAccountState(platform,list)])));
      const statuses=await Promise.all(cookies.map(async([platform,list])=>{try{return[platform,await inspectAccount(platform,contextFor(platform),list)];}catch{return[platform,restoredAccountState(platform,list)];}}));
      publishAccounts(Object.fromEntries(statuses));
      if(pendingVideo&&engine.state.accounts.bilibili?.loggedIn&&engine.state.accounts.bilibili?.verified){const target=pendingVideo;pendingVideo=null;if(videoRequest===target.request&&videoAllowed(target.key,target.playlistId))await engine.openVideo(target.key,{playlistId:target.playlistId});}
      return engine.state.accounts;
    })();
    try{return await accountsPromise;}finally{accountsPromise=null;if(accountsRefreshAgain){accountsRefreshAgain=false;Promise.resolve().then(()=>updateAccounts()).catch(()=>{});}}
  }
  function videoAllowed(key,playlistId){return playlistId?engine.state.playlists.some(p=>p.id===playlistId&&p.queue.includes(key)):engine.current()?.key===key||engine.state.playlists.some(p=>p.id===engine.state.activePlaylistId&&p.queue.includes(key));}
  async function requestVideo(key,playlistId){
    key||=engine.snapshot().currentKey;const track=engine.current()?.key===key?engine.current():engine.state.tracks.find(t=>t.key===key);
    if(track?.platform!=='bilibili'||!videoAllowed(key,playlistId))throw new Error('请选择 B 站视频');
    if(!playlistId&&engine.current()?.key!==key)playlistId=engine.state.activePlaylistId;
    const request=++videoRequest;pendingVideo=null;
    if(engine.active?.backend==='video'&&engine.current()?.key===key&&(!playlistId||playlistId===engine.playbackPlaylistId)){
      await engine.openVideo(key,{playlistId});return{ok:true};
    }
    await updateAccounts();
    if(request!==videoRequest||!videoAllowed(key,playlistId))return{ok:true,canceled:true};
    if(!engine.state.accounts.bilibili?.loggedIn){pendingVideo={key,playlistId,request};await native('login',{platform:'bilibili'});return{ok:true,requiresLogin:true,message:'在官方页面登录后继续播放'};}
    if(!engine.state.accounts.bilibili?.verified)throw new Error('暂时无法验证 B 站登录，请稍后重试');
    pendingVideo=null;await engine.openVideo(key,{playlistId});return{ok:true};
  }
  async function importLinks(text){
    if(storageLocked)throw new Error('歌单处于只读状态，请先恢复备份');
    if(importing)throw new Error('正在导入，请稍候');
    const resources=parseInput(text);if(resources.length>100)throw new Error('一次最多导入 100 个链接');
    const playlistId=engine.state.activePlaylistId,tracks=[],errors=[],warnings=[];importing=true;
    try{
      for(let i=0;i<resources.length;i++){
        notice(`读取链接 ${i+1}/${resources.length}`);
        try{const imported=await importResource(resources[i],contextFor(resources[i].platform));tracks.push(...(imported.tracks||[]).map(safeTrack).filter(Boolean));warnings.push(...(imported.warnings||[]));}catch(error){errors.push(errorMessage(error));}
      }
      if(!tracks.length&&errors.length)throw new Error(errors.join('；'));
      const result=engine.addTracksDetailed(tracks,playlistId);
      const message=`新增 ${result.added} 首${result.existingKey?`，已存在 ${result.existingKey} 首`:''}${result.duplicateMetadata?`，同名同作者 ${result.duplicateMetadata} 首已跳过`:''}${errors.length?'；部分链接未导入':''}`;
      return{ok:true,...result,total:tracks.length,playlistId,warnings,errors,message};
    }finally{importing=false;}
  }
  async function command(name,payload={}){
    if(!payload||typeof payload!=='object')throw new Error('操作参数无效');
    if(storageLocked&&['playlist-create','playlist-rename','playlist-delete','remove','remove-many','copy-many','clear','reorder','track-rename','track-range'].includes(name))throw new Error('歌单处于只读状态，请先恢复备份');
    if(['play','pause','next','previous','playlist-create','playlist-select','playlist-delete','clear','remove','video-close','quit'].includes(name)){pendingVideo=null;videoRequest++;}
    const isTransport=['play','pause','next','previous','video-open','quit'].includes(name),request=isTransport?++transportRequest:transportRequest;
    if(isTransport)searchService.cancelPlayback?.();
    if(['play','next','previous'].includes(name)){await native('playback-start',{});if(request!==transportRequest)return{ok:true,canceled:true};}
    switch(name){
      case'play':await engine.playKey(payload.key,{playlistId:payload.playlistId});break;
      case'pause':await engine.pause();break;
      case'next':await engine.next();break;
      case'previous':await engine.previous();break;
      case'seek':await engine.seek(payload.positionMs);break;
      case'volume':await engine.setVolume(payload.volume,payload.muted??engine.state.muted,payload.save!==false);break;
      case'mute':await engine.setVolume(engine.state.volume,payload.muted);break;
      case'mode':engine.setMode(payload.mode);break;
      case'quality':engine.setQuality(payload.platform,payload.quality);return{ok:true,message:'音质已保存，下次播放生效'};
      case'theme':if(!['light','dark'].includes(payload.theme))throw new Error('主题无效');await native('theme',payload).catch(()=>{});break;
      case'track-rename':engine.renameTrack(payload.key,payload.title);break;
      case'track-range':await engine.setPlayRange(payload.key,{startMs:payload.startMs,endMs:payload.endMs});break;
      case'playlist-create':return{ok:true,id:await engine.createPlaylist(payload.name)};
      case'playlist-select':await engine.selectPlaylist(payload.id);break;
      case'playlist-rename':engine.renamePlaylist(payload.id,payload.name);break;
      case'playlist-delete':await engine.deletePlaylist(payload.id);break;
      case'remove-many':await engine.removeMany(payload.keys,payload.playlistId);break;
      case'copy-many':{const result=engine.copyPlaylistTracks(payload.sourceId,payload.targetId,payload.keys);return{ok:true,...result,message:`已添加 ${result.added} 首，已有 ${result.existingKey} 首、同名同作者 ${result.duplicateMetadata} 首已跳过（来源歌单保留）`};}
      case'remove':await engine.remove(payload.key);break;
      case'clear':await engine.clear();break;
      case'reorder':engine.reorder(payload.keys,payload.playlistId);break;
      case'accounts-refresh':await updateAccounts();break;
      case'video-open':return requestVideo(payload.key,payload.playlistId);
      case'video-close':pendingVideo=null;await engine.closeVideo();break;
      case'video-panel':await engine.setVideoPanel(payload);break;
      case'quit':await engine.pause();await saveQueue;await native('quit',{});break;
      default:throw new Error('不支持的操作');
    }
    return{ok:true};
  }
  async function exportLibrary(){const json=JSON.stringify(normaliseLibrary(engine.snapshot()),null,2);await saveQueue;return native('export',{json,suggestedName:'MixTunes-歌单备份.json'},{timeoutMs:10*60*1000});}
  async function importFile(){
    const result=await native('import',{}, {timeoutMs:10*60*1000});if(result?.canceled)return{ok:true,canceled:true};
    const text=String(result?.text||'').replace(/^\uFEFF/,'');if(Buffer.byteLength(text)>12*1024*1024)throw new Error('文件大于 12 MB');
    if(text.trim().startsWith('{')){
      const data=JSON.parse(text);if(!Array.isArray(data.tracks))throw new Error('请选择 MixTunes 歌单备份');
      if(storageLocked)return recoverLibrary(text);
      const imported=await engine.importBackup(data);
      const message=`备份导入完成${imported.playlistsCreated?`，恢复 ${imported.playlistsCreated} 个歌单`:''}，新增 ${imported.added} 首${imported.existingKey?`，已存在 ${imported.existingKey} 首`:''}${imported.duplicateMetadata?`，跳过同名同作者 ${imported.duplicateMetadata} 首`:''}。${imported.playlistsCreated?'请在歌单列表中查看恢复的歌单。':'请在当前歌单中查看。'}`;
      return{ok:true,...imported,message};
    }
    return importLinks(text);
  }
  async function importShareLink(input){
    if(storageLocked)throw new Error('歌单处于只读状态，请先恢复备份');
    const url=normaliseShareLink(input),result=await native('share-fetch',{url},{timeoutMs:12000});
    const text=String(result?.text||'').replace(/^\uFEFF/,'');if(Buffer.byteLength(text)>12*1024*1024)throw new Error('文件大于 12 MB');
    const data=JSON.parse(text);if(!Array.isArray(data.tracks)||!Array.isArray(data.playlists))throw new Error('链接没有包含 MixTunes 歌单');
    const added=mergeTransferredLibrary(engine,data);return{ok:true,...added,message:`已导入电脑歌单，新增 ${added.added} 首${added.playlistsCreated?`、${added.playlistsCreated} 个歌单`:''}`};
  }
  const ready=(async()=>{
    let nativeText=null,localText=null,nativeError=null,localError=null,nativeBackup=null;
    try{const saved=await native('storage-load',{});nativeText=saved?.json??null;nativeBackup=saved?.backup??null;}catch(error){nativeError=error;}
    try{localText=localStorage.getItem(libraryKey);}catch(error){localError=error;}
    const selected=chooseLibrary({nativeText,localText,nativeError,localError,nativeBackup});
    const {library,useLocal}=selected;savedAt=selected.savedAt;storageLocked=selected.locked;recoveryText=selected.candidateText;recoveryReason=selected.reason;
    engine=new PlayerEngine({library:normaliseLibrary(library),resolveTrack,contextFor,audio:new NativeAudio(),web:new NativeWeb('web'),video:new NativeWeb('video'),persist,record:()=>{}});
    searchService=new SearchService({searchPlatform,contextFor,importResource,parseInput,safeTrack,engine});
    lyricsService=new LyricsService({engine,contextFor});
    engine.on('state',state=>{for(const fn of stateListeners){try{fn(state);}catch{}}});engine.on('notice',notice);
    engine.state.libraryRecovery={locked:storageLocked,message:recoveryReason,canRestore:!!recoveryText};
    if(useLocal)persist(engine.snapshot());
    engine.publish();window.dispatchEvent(new CustomEvent('mixtunes-ready'));native('app-ready',{}).catch(()=>{});
    updateAccounts().catch(()=>{});return engine;
  })();
  async function invoke(fn){try{await ready;return await fn();}catch(error){return{ok:false,error:errorMessage(error)};}}
  async function recoverLibrary(text=recoveryText){
    if(!storageLocked)return{ok:true};
    if(!text)return importFile();
    if(!parseSaved(text))throw new Error('备份内容无效');
    if(!window.confirm('用此备份恢复歌单？原文件会保留。'))return{ok:true,canceled:true};
    await native('storage-recover',{json:text});
    try{localStorage.setItem(libraryKey,text);}catch{}
    window.location.reload();return{ok:true};
  }
  window.playerAPI={
    recoverLibrary:()=>invoke(()=>recoverLibrary()),
    sleepTimer:(action,payload={})=>native('sleep-timer-'+(action==='get'?'state':action),payload),
    background:(action,payload={})=>native(action==='pick'?'background-pick':action==='editor'?'background-editor':'storage-background-'+action,payload,{timeoutMs:action==='pick'?600000:30000}),
    getState:async()=>{await ready;return engine.snapshot();},
    command:(name,payload={})=>invoke(()=>command(name,payload)),
    importLinks:text=>invoke(()=>importLinks(text)),
    search:payload=>invoke(()=>searchService.search(payload)),
    addSearchResult:payload=>invoke(()=>{if(storageLocked)throw new Error('歌单处于只读状态，请先恢复备份');return searchService.add(payload);}),
    playSearchResult:payload=>invoke(async()=>{const request=++transportRequest;pendingVideo=null;videoRequest++;searchService.cancelPlayback?.();await native('playback-start',{});if(request!==transportRequest)return{ok:true,canceled:true};return searchService.play(payload);}),
    getLyrics:key=>invoke(()=>lyricsService.get(key)),
    importShareLink:input=>invoke(()=>importShareLink(input)),
    login:platform=>invoke(async()=>{if(!['qq','netease','bilibili'].includes(platform))throw new Error('不支持的平台');const result=await native('login',{platform});return{ok:true,...result};}),
    exportLibrary:()=>invoke(exportLibrary),importFile:()=>invoke(importFile),
    openSource:key=>invoke(async()=>{const track=engine.current()?.key===key?engine.current():engine.state.tracks.find(t=>t.key===key);if(!track)throw new Error('歌曲不存在');await native('open-external',{url:safeTrack(track).url});return{ok:true};}),
    openSearch:payload=>invoke(async()=>{await native('open-external',{url:searchUrl(payload.platform,payload.query)});return{ok:true};}),
    onState(fn){stateListeners.add(fn);return()=>stateListeners.delete(fn);},onNotice(fn){noticeListeners.add(fn);return()=>noticeListeners.delete(fn);}
  };
  window.__mixNativeEvent=event=>{
    if(typeof event==='string'){try{event=JSON.parse(event);}catch{return;}}
    ready.then(()=>{
      if(['audio','video','web'].includes(event?.type)&&event.event)engine.onEvent({...event.event,backend:event.type});
      else if(event?.type==='command')command(event.name,event.payload||{}).catch(notice);
      else if(event?.type==='accounts-refresh'){updateAccounts().catch(()=>{});window.dispatchEvent(new Event('mix-sleep-timer-refresh'));}
      else if(event?.type==='sleep-timer-expired'){
        searchService.cancelPlayback();pendingVideo=null;videoRequest++;transportRequest++;
        // The native host already stopped native audio; only ask the engine when it
        // still believes playback is active, so a manually paused player is untouched.
        if(shouldPause(engine.state.status))command('pause').catch(notice);
        window.dispatchEvent(new Event('mix-sleep-timer-expired'));
      }
      else if(event?.type==='video-panel-hidden'){pendingVideo=null;videoRequest++;engine.setVideoPanel({open:false}).catch(notice);}
      else if(event?.type==='video-panel-close')engine.closeVideo().catch(notice);
      else if(event?.type==='playlist-import-link')importShareLink(event.url).then(result=>notice(result.message)).catch(notice);
      else if(event?.type==='notice')notice(event.message);
    }).catch(()=>{});
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&engine)persist(engine.snapshot());});
})();
