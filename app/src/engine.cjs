'use strict';
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {QueueModel}=require('./queue.cjs');
const {normaliseLibrary,safeTrack}=require('./store.cjs');
const {trackMetadataIdentity}=require('./track-identity.cjs');
const {normaliseQualitySettings,isQualitySupported}=require('./quality.cjs');
const {validatePlayRange,effectivePlayRange,clampToPlayRange}=require('./play-range.cjs');

const LABELS={qq:'QQ 音乐',netease:'网易云',bilibili:'B 站'};
function errorMessage(error) {
  const message=String(error?.message || error || '播放失败');
  // Never return signed resource URLs or credentials in user-visible logs/state.
  return message.replace(/https?:\/\/\S+/g,'[来源地址]').replace(/(?:cookie|authorization|privateKey)\s*[:=]\s*\S+/gi,'[登录信息]').slice(0,400);
}
class PlayerEngine extends EventEmitter {
  constructor({library,resolveTrack,contextFor,audio,web,video=null,persist=()=>{},record=()=>{}}) {
    super();
    const safe=normaliseLibrary(library);
    this.queue=new QueueModel({keys:safe.queue,mode:safe.mode});
    this.queue.currentKey=safe.currentKey;
    this.playbackPlaylistId=safe.activePlaylistId;
    this.playbackTracks=new Map(safe.tracks.filter(track=>safe.queue.includes(track.key)).map(track=>[track.key,track]));
    this.audioLoadTail=Promise.resolve();this.seekRevision=0;this.seekTarget=null;this.seekPosition=null;
    this.state={...safe,currentKey:safe.currentKey,status:safe.currentKey?'paused':'idle',positionMs:0,durationMs:0,
      accounts:{qq:false,netease:false,bilibili:false},error:null,backend:null,playbackQuality:null,videoOpen:false,videoPanel:{open:false,expanded:false},videoAuth:null,videoPreview:null};
    this.resolveTrack=resolveTrack;this.contextFor=contextFor;this.audio=audio;this.web=web;this.video=video;this.videoMode=false;
    this.persist=persist;this.record=record;this.serial=0;this.generation=0;
    this.active=null;this.prepared=null;this.preparing=null;this.failedKeys=new Set();this.endedGeneration=null;
    this.wantsPlayback=false;
  }
  syncActivePlaylist() {
    const playing=this.state.playlists.find(p=>p.id===this.playbackPlaylistId);
    if(playing&&this.queue.currentKey){playing.mode=this.queue.mode;if(playing.queue.includes(this.queue.currentKey))playing.currentKey=this.queue.currentKey;}
    const browsing=this.playlist();
    this.state.queue=[...browsing.queue];this.state.mode=this.queue.currentKey?this.queue.mode:browsing.mode;this.state.currentKey=this.queue.currentKey;
  }
  snapshot() {
    this.syncActivePlaylist();
    return {...this.state,playlists:this.state.playlists.map(p=>({...p,queue:[...p.queue]})),
      queue:[...this.state.queue],mode:this.state.mode,browseMode:this.playlist().mode,currentKey:this.queue.currentKey,
      currentTrack:this.current()||null,playbackPlaylistId:this.playbackPlaylistId,playbackQueue:[...this.queue.keys],generation:this.generation};
  }
  publish(save=false) { const state=this.snapshot();if(save)this.persist(state);this.emit('state',state); }
  notice(message) {this.emit('notice',message);this.record({type:'notice',message});}
  track(key) {return this.playbackTracks.get(key)||this.state.tracks.find(t=>t.key===key);}
  current() {return this.track(this.queue.currentKey);}
  capturePlaylist(id) {
    const playlist=this.playlist(id);
    if(this.playbackPlaylistId!==id||playlist.mode!==this.queue.mode||playlist.queue.length!==this.queue.keys.length||playlist.queue.some((key,index)=>key!==this.queue.keys[index])){
      this.cancelPrepared();this.queue=new QueueModel({keys:playlist.queue,mode:playlist.mode});
    }
    this.playbackPlaylistId=id;
    this.playbackTracks=new Map(playlist.queue.map(key=>[key,this.state.tracks.find(track=>track.key===key)]).filter(([,track])=>track));
  }
  async playTemporary(candidate) {
    const track=safeTrack(candidate);if(!track)throw new Error('搜索结果歌曲无效');
    this.cancelPrepared();this.playbackPlaylistId=null;this.playbackTracks=new Map([[track.key,track]]);
    this.queue=new QueueModel({keys:[track.key],mode:'sequential'});
    await this.playKey(track.key,{resume:false,fromPlayback:true});
    return track;
  }
  clearSeek() {clearTimeout(this.seekTimer);this.seekTimer=null;this.seekTarget=null;}
  desiredPosition(generation,fallback) {return this.seekPosition?.generation===generation?this.seekPosition.positionMs:fallback;}
  loadAudio(track,generation,resolved,slot,valid) {
    // A preload awaiting init/load must finish and dispose itself before a newer
    // foreground load can reuse its physical slot.
    const task=this.audioLoadTail.then(async()=>{
      if(!valid())return null;
      const entry=await this.audio.load(track,generation,resolved,slot,this.state.volume,this.state.muted);
      if(!valid()){this.audio.unload(entry);return null;}
      return entry;
    });
    this.audioLoadTail=task.catch(()=>{});return task;
  }
  clearTimer() {clearTimeout(this.loadTimer);clearTimeout(this.skipTimer);this.loadTimer=null;this.skipTimer=null;}
  async stopBackends() {this.audio.stopAll();await Promise.allSettled([Promise.resolve().then(()=>this.web.pause()),Promise.resolve().then(()=>this.video?.pause())]);}
  browserBackend(){return this.active?.backend==='video'?this.video:this.web;}
  range(track=this.current()){return effectivePlayRange(track,track?.key===this.queue.currentKey?this.state.durationMs:undefined);}
  async prepareBrowserRange(generation,positionMs){
    // Loading can await page navigation, metadata and seeking. A user edit in
    // any of those waits must win over the range captured by load().
    while(this.generation===generation&&this.wantsPlayback){
      const revision=this.rangeRevision||0,seekRevision=this.seekRevision;const backend=this.browserBackend();
      const track=this.current();const range=this.range(track);
      await backend.setRange?.(track.playRange||{startMs:0,endMs:null});
      if(this.generation!==generation||!this.wantsPlayback)return false;
      if(revision!==(this.rangeRevision||0))continue;
      const requested=this.desiredPosition(generation,positionMs);
      const target=clampToPlayRange(requested,range);
      if(target>0||positionMs>0)await backend.seek?.(target);
      if(this.generation!==generation||!this.wantsPlayback)return false;
      if(revision!==(this.rangeRevision||0)||seekRevision!==this.seekRevision)continue;
      this.state.positionMs=target;return true;
    }
    return false;
  }
  cancelPrepared() {if(this.prepared)this.audio.unload(this.prepared.entry);this.prepared=null;this.preparing=null;}
  async playKey(key,{resume=true,manual=true,startAtMs,playlistId,fromPlayback=false}={}) {
    if(!key&&this.queue.currentKey){key=this.queue.currentKey;fromPlayback=true;}
    if(!fromPlayback){const playlist=this.playlist(playlistId||this.state.activePlaylistId);key||=playlist.queue[0];if(!key)return;if(!playlist.queue.includes(key))throw new Error('歌曲不在指定歌单中');this.capturePlaylist(playlist.id);}
    if(!key)key=this.queue.keys[0];
    if(!key)return;
    const track=this.track(key);
    if(!track||!this.queue.keys.includes(key))throw new Error('歌曲不在当前歌单中');
    if(resume && key===this.queue.currentKey && this.active && this.state.status==='paused' && this.active.requestedSetting===this.state.qualitySettings[track.platform]) {
      const generation=this.generation;this.wantsPlayback=true;
      this.state.status='buffering';this.publish();
      if(this.active.backend==='audio')this.audio.activate(this.active.entry);else await this.browserBackend().play(generation);
      return;
    }
    if(manual)this.failedKeys.clear();
    this.clearTimer();
    const leavingVideo=this.active?.backend==='video';
    const useVideo=this.videoMode&&track.platform==='bilibili'&&this.video;
    if(track.platform!=='bilibili')this.videoMode=false;
    const prepared=!useVideo&&this.prepared?.key===key?this.prepared:null;
    if(!prepared)this.cancelPrepared();
    this.prepared=null;this.preparing=null;
    const generation=prepared?prepared.generation:++this.serial;
    this.generation=generation;this.endedGeneration=null;
    this.clearSeek();this.seekPosition=null;
    this.wantsPlayback=true;
    this.queue.select(key);
    this.state.currentKey=key;this.state.durationMs=track.durationMs||0;
    const range=this.range(track);
    const initialPosition=clampToPlayRange(startAtMs??(this.pendingResume?.key===key?this.pendingResume.positionMs:range.startMs),range);
    this.pendingResume=null;this.state.positionMs=initialPosition;
    this.state.error=null;this.state.status='loading';this.state.backend=null;this.state.playbackQuality=null;this.state.videoOpen=!!useVideo;this.active=null;
    this.publish(true);this.record({type:'load',platform:track.platform,key,generation});
    await this.stopBackends();
    if(this.generation!==generation)return;
    if(leavingVideo&&!useVideo){await this.video?.close?.();if(this.generation!==generation)return;}
    const timeoutMs=useVideo?45000:25000;
    this.loadTimer=setTimeout(()=>this.fail(new Error(`等待播放超过 ${timeoutMs/1000} 秒，请检查网络或登录后重试`),generation),timeoutMs);
    try {
      if(useVideo){
        this.active={backend:'video',key,generation,requestedSetting:this.state.qualitySettings[track.platform]};this.state.backend='video';
        this.state.playbackQuality={requested:this.active.requestedSetting,actual:'web',label:'Bilibili 原站视频音质',fallbackReason:''};this.publish();
        await this.video.load(track,generation,range);
        if(this.generation!==generation||!this.wantsPlayback)return;
        this.active.ready=true;
        await this.video.setVolume(this.state.muted?0:this.state.volume);
        if(this.generation!==generation||!this.wantsPlayback)return;
        if(!await this.prepareBrowserRange(generation,initialPosition))return;
        await this.video.play(generation);return;
      }
      let resolved;
      try {
        resolved=prepared?.resolved||await this.resolveTrack(track,this.contextFor(track.platform));
        if(resolved.preview)throw new Error('当前来源只提供试听，请登录并确认歌曲权限');
      } catch(error) {
        if(this.generation!==generation)return;
        if(!['qq','netease'].includes(track.platform)||this.web.supported===false)throw error;
        this.active={backend:'web',key,generation,requestedSetting:this.state.qualitySettings[track.platform]};this.state.backend='web';this.state.playbackQuality={requested:this.active.requestedSetting,actual:'web',label:'原站网页音质',fallbackReason:'音频直连不可用，使用官方网页设置'};this.publish();
        this.notice(`${LABELS[track.platform]}：正在尝试官方网页播放；需要时可点击对应登录按钮。`);
        await this.web.load(track,generation,range);
        if(this.generation!==generation)return;
        this.active.ready=true;
        await this.web.setVolume(this.state.muted?0:this.state.volume);
        if(this.generation!==generation||!this.wantsPlayback)return;
        if(!await this.prepareBrowserRange(generation,initialPosition))return;
        await this.web.play(generation);return;
      }
      if(this.generation!==generation)return;
      const oldSlot=this.lastSlot??1;
      const entry=prepared?.entry||await this.loadAudio(track,generation,resolved,1-oldSlot,()=>this.generation===generation);
      if(!entry||this.generation!==generation){if(entry)this.audio.unload(entry);return;}
      this.lastSlot=entry.slot;
      this.active={backend:'audio',entry,key,generation,requestedSetting:resolved.requestedQuality||this.state.qualitySettings[track.platform]};this.state.backend='audio';
      this.state.playbackQuality={requested:resolved.requestedQuality||this.state.qualitySettings[track.platform],actual:resolved.actualQuality||'unknown',label:resolved.quality||'平台音质',fallbackReason:resolved.qualityFallbackReason||'',codec:resolved.codec||'',bitrate:resolved.bitrate||0};
      this.record({type:'quality',platform:track.platform,key,...this.state.playbackQuality});
      this.state.status='buffering';this.publish();
      const latestRange=this.range(track);this.audio.setRange?.(entry,track.playRange||{startMs:0,endMs:null});
      const latestPosition=clampToPlayRange(this.desiredPosition(generation,initialPosition),latestRange);
      if(latestPosition!==range.startMs||latestRange.startMs!==range.startMs||this.seekTarget)this.audio.seek(entry,latestPosition);
      this.state.positionMs=latestPosition;
      this.audio.activate(entry);
    }catch(error){this.fail(error,generation);}
  }
  onEvent(event) {
    if(this.prepared && event.generation===this.prepared.generation && event.key===this.prepared.key) {
      if(event.type==='ready')this.prepared.buffered=true;
      if(event.type==='error'){this.prepareFailure={key:event.key,until:Date.now()+10000};this.cancelPrepared();}
      return;
    }
    if(event.generation!==this.generation || event.key!==this.queue.currentKey)return;
    if(event.backend&&this.active&&event.backend!==this.active.backend)return;
    const pendingSeek=this.seekTarget?.generation===this.generation?this.seekTarget:null;
    if(pendingSeek&&['progress','metadata','ready','playing','seeked','ended'].includes(event.type)){
      if(Number.isFinite(event.durationMs)&&event.durationMs>0)this.state.durationMs=event.durationMs;
      const target=clampToPlayRange(pendingSeek.positionMs,this.range());
      if(Number.isFinite(event.positionMs)&&Math.abs(event.positionMs-target)<=350)this.clearSeek();
      else {
        // Metadata can describe a shorter source and must still reset an invalid
        // clip, but stale positions/end events must not undo an in-flight seek.
        if(event.type!=='metadata'&&!event.rangeReset){this.publish();return;}
        event={...event,positionMs:undefined};
      }
    }
    if(event.backend==='video'){
      if(event.auth)this.state.videoAuth={isLogin:event.auth.isLogin===true,status:String(event.auth.status||'unknown')};
      if(event.preview)this.state.videoPreview={isPreview:typeof event.preview.isPreview==='boolean'?event.preview.isPreview:null,source:String(event.preview.source||'unknown')};
      if(event.type==='notice'){this.notice(errorMessage(event.message));return;}
    }
    if(event.type==='closed'&&event.backend==='video'){
      this.closeVideo().catch(error=>this.notice(errorMessage(error)));return;
    }
    if(event.type==='error'){
      this.record({type:'media-error',backend:event.backend,key:event.key,code:event.code,positionMs:event.positionMs,durationMs:event.durationMs});
      if(!this.wantsPlayback&&this.state.status==='paused')return;
      if(this.active?.backend==='audio'&&this.web.supported!==false&&['qq','netease'].includes(this.current()?.platform)&&this.webFallbackGeneration!==event.generation){
        this.fallbackToWeb(event.generation);return;
      }
      this.fail(new Error(event.message||'播放器返回错误'),event.generation);return;
    }
    if(event.type==='playing'){
      if(!this.wantsPlayback){this.stopBackends();return;}
      clearTimeout(this.loadTimer);this.state.status='playing';this.state.error=null;this.failedKeys.clear();
      this.record({type:'playing',platform:this.current()?.platform,key:event.key,generation:event.generation});
      this.prepareNext();
    }else if(event.type==='paused'){
      if(this.state.status==='playing'||this.state.status==='buffering')this.state.status=this.wantsPlayback?'buffering':'paused';
    }else if(event.type==='buffering'){
      if(this.state.status!=='paused')this.state.status='buffering';
    }else if(event.type==='progress'||event.type==='metadata'||event.type==='ready'||event.type==='seeked'){
      if(Number.isFinite(event.durationMs)&&event.durationMs>0)this.state.durationMs=event.durationMs;
      let range=this.range();
      if(range.endMs!==null&&range.startMs>=range.endMs){
        const track=this.current();track.playRange={startMs:0,endMs:null};range=this.range();
        if(this.active?.backend==='audio')this.audio.setRange?.(this.active.entry,track.playRange);
        else this.seek(0).catch(error=>this.notice(errorMessage(error)));
        this.notice('设定起点超过实际时长，已恢复整首播放。');this.publish(true);
      }
      if(event.rangeReset&&this.active?.backend==='audio')this.audio.setRange?.(this.active.entry,this.current().playRange||{startMs:0,endMs:null});
      if(Number.isFinite(event.positionMs)){
        this.state.positionMs=clampToPlayRange(event.positionMs,range);
        if(this.active?.backend!=='audio'&&event.positionMs<range.startMs-100){this.seek(range.startMs).catch(error=>this.notice(errorMessage(error)));}
        if(this.wantsPlayback&&range.endMs!==null&&event.positionMs>=range.endMs){this.finishRange(event.generation,event.key);return;}
      }
      if(this.state.status==='playing')this.prepareNext();
    }else if(event.type==='ended'){
      this.finishRange(event.generation,event.key);return;
    }
    this.publish();
  }
  finishRange(generation,key){
    if(!this.wantsPlayback||generation!==this.generation||this.endedGeneration===generation)return;
    this.endedGeneration=generation;this.record({type:'ended',key,generation});
    this.next({natural:true}).catch(error=>this.notice(errorMessage(error)));
  }
  async fallbackToWeb(generation){
    if(generation!==this.generation||!this.wantsPlayback)return;
    this.webFallbackGeneration=generation;const track=this.current();
    this.cancelPrepared();this.audio.stopAll();
    this.active={backend:'web',key:track.key,generation,requestedSetting:this.state.qualitySettings[track.platform]};this.state.backend='web';this.state.status='loading';this.state.playbackQuality={requested:this.active.requestedSetting,actual:'web',label:'原站网页音质',fallbackReason:'音频解码或连接失败，使用官方网页设置'};this.publish();
    this.notice(`${LABELS[track.platform]}音频直连未成功，正在尝试官方网页。`);
    try{
      const range=this.range(track);
      await this.web.load(track,generation,range);
      if(this.generation!==generation||!this.wantsPlayback)return;
      this.active.ready=true;
      await this.web.setVolume(this.state.muted?0:this.state.volume);
      if(this.generation!==generation||!this.wantsPlayback)return;
      if(!await this.prepareBrowserRange(generation,this.state.positionMs))return;
      await this.web.play(generation);
    }catch(error){this.fail(error,generation);}
  }
  async prepareNext() {
    if(this.videoMode)return;
    // Signed media links must not sit prepared for an entire long Bilibili video.
    const end=this.range().endMs;
    if(end!==null&&end>90000&&end-this.state.positionMs>45000)return;
    const generation=this.generation;
    const key=this.queue.peekNext({natural:true});
    if(this.prepareFailure?.key===key&&this.prepareFailure.until>Date.now())return;
    if(!key||key===this.queue.currentKey||this.prepared?.key===key||this.preparing?.key===key)return;
    this.cancelPrepared();
    const marker={key,fromGeneration:generation};this.preparing=marker;
    const track=this.track(key);if(!track){this.preparing=null;return;}
    try{
      const resolved=await this.resolveTrack(track,this.contextFor(track.platform));
      if(resolved.preview || this.preparing!==marker || this.generation!==generation || this.queue.peekNext()!==key)return;
      const nextGeneration=++this.serial;
      const slot=this.active?.backend==='audio'?1-this.active.entry.slot:0;
      const entry=await this.loadAudio(track,nextGeneration,resolved,slot,()=>this.preparing===marker&&this.generation===generation);
      if(!entry||this.preparing!==marker||this.generation!==generation){if(entry)this.audio.unload(entry);return;}
      this.prepared={key,generation:nextGeneration,resolved,entry,buffered:false};this.preparing=null;
    }catch{if(this.preparing===marker)this.prepareFailure={key,until:Date.now()+10000};}
    finally{if(this.preparing===marker)this.preparing=null;}
  }
  async fail(error,generation) {
    if(generation!==this.generation||this.failedGeneration===generation)return;
    this.failedGeneration=generation;this.clearTimer();
    this.wantsPlayback=false;
    this.state.error=errorMessage(error);this.state.status='error';
    this.failedKeys.add(this.queue.currentKey);this.active=null;
    await this.stopBackends();
    if(generation!==this.generation)return;
    this.publish();this.notice(this.state.error);this.record({type:'error',key:this.queue.currentKey,message:this.state.error});
    if(this.queue.keys.length>1 && this.failedKeys.size<this.queue.keys.length){
      this.skipTimer=setTimeout(()=>{if(this.generation===generation)this.next({natural:false,failed:true}).catch(()=>{});},1800);
    }
  }
  async pause() {
    this.clearTimer();
    this.wantsPlayback=false;
    if(this.state.status==='loading'){
      this.pendingResume={key:this.queue.currentKey,positionMs:this.state.positionMs};
      this.generation=++this.serial;this.active=null;this.cancelPrepared();
    }
    this.clearSeek();
    const generation=this.generation;
    await this.stopBackends();
    if(this.generation!==generation)return;
    this.state.status=this.queue.currentKey?'paused':'idle';this.publish(true);
  }
  async next({natural=false,failed=false}={}) {
    this.clearTimer();
    if(!this.queue.currentKey){if(!this.playlist().queue.length)return;this.capturePlaylist(this.state.activePlaylistId);}
    if(!natural&&!failed)this.failedKeys.clear();
    let key=this.queue.next({natural,failed});
    if(failed){
      for(let i=0;i<this.queue.keys.length&&key&&this.failedKeys.has(key);i++)key=this.queue.next({natural:false,failed:true});
      if(key&&this.failedKeys.has(key))key=null;
    }
    if(!key){
      this.wantsPlayback=false;this.generation=++this.serial;this.active=null;this.cancelPrepared();await this.stopBackends();
      this.state.status=failed?'error':'idle';this.publish(true);return;
    }
    await this.playKey(key,{resume:false,manual:!natural&&!failed,fromPlayback:true});
  }
  async previous() {const key=this.queue.previous();if(key)await this.playKey(key,{resume:false,fromPlayback:true});}
  async seek(positionMs) {
    if(!Number.isFinite(positionMs))throw new Error('跳转位置无效');
    if(!this.current())return;
    positionMs=clampToPlayRange(positionMs,this.range());
    const generation=this.generation,revision=++this.seekRevision;
    this.clearSeek();this.seekTarget={generation,positionMs,revision};
    this.seekPosition={generation,positionMs};
    this.seekTimer=setTimeout(()=>{if(this.seekTarget?.revision===revision){this.clearSeek();this.notice('跳转仍在缓冲，请稍候或重试。');}},12000);this.seekTimer.unref?.();
    this.state.positionMs=positionMs;
    if(this.active?.backend==='audio')this.audio.seek(this.active.entry,positionMs);
    else if(['web','video'].includes(this.active?.backend)&&this.active.ready)await this.browserBackend().seek(positionMs);
    if(this.generation!==generation||this.seekRevision!==revision)return;
    this.publish();
  }
  async setVolume(volume,muted=this.state.muted) {
    this.state.volume=Math.max(0,Math.min(1,Number(volume)||0));this.state.muted=!!muted;
    this.audio.volume(this.state.volume,this.state.muted);
    if(['web','video'].includes(this.active?.backend))await this.browserBackend().setVolume(this.state.muted?0:this.state.volume);
    this.publish(true);
  }
  setMode(mode) {this.queue.setMode(mode);if(!this.queue.currentKey)this.playlist().mode=mode;this.cancelPrepared();this.publish(true);if(this.state.status==='playing')this.prepareNext();}
  setQuality(platform,quality) {
    if(!isQualitySupported(platform,quality))throw new Error('不支持的音质设置');
    this.state.qualitySettings=normaliseQualitySettings({...this.state.qualitySettings,[platform]:quality});
    this.cancelPrepared();this.publish(true);
  }
  renameTrack(key,title){
    const track=this.state.tracks.find(t=>t.key===key);if(!track)throw new Error('歌曲不存在');
    if(typeof title!=='string'||!title.trim()||title.trim().length>500)throw new Error('歌曲名称须为 1 到 500 个字符');
    if(title.trim()===track.title)delete track.displayTitle;else track.displayTitle=title.trim();
    this.publish(true);
  }
  async setPlayRange(key,value){
    const track=this.track(key);if(!track)throw new Error('歌曲不存在');
    track.playRange=validatePlayRange(value,key===this.queue.currentKey?this.state.durationMs||track.durationMs:track.durationMs);
    this.rangeRevision=(this.rangeRevision||0)+1;
    this.cancelPrepared();
    if(key===this.queue.currentKey){
      const generation=this.generation;
      const range=this.range(track);
      if(this.active?.backend==='audio')this.audio.setRange?.(this.active.entry,track.playRange);
      else if(['web','video'].includes(this.active?.backend)&&this.active.ready)await this.browserBackend().setRange?.(track.playRange);
      if(this.generation!==generation||this.queue.currentKey!==key){this.publish(true);return;}
      const position=this.state.positionMs;
      if(position<range.startMs||range.endMs!==null&&position>=range.endMs){
        if(['web','video'].includes(this.active?.backend)&&!this.active.ready)this.state.positionMs=range.startMs;
        else await this.seek(range.startMs);
      }
    }
    this.publish(true);
  }
  async openVideo(key=this.queue.currentKey,{playlistId}={}){
    const track=playlistId?this.state.tracks.find(t=>t.key===key):this.track(key);
    if(!this.video)throw new Error('视频窗口暂不可用');
    if(track?.platform!=='bilibili')throw new Error('只有 Bilibili 曲目可以打开视频');
    const fromPlayback=!playlistId&&key===this.queue.currentKey;
    if(!fromPlayback&&!this.playlist(playlistId||this.state.activePlaylistId).queue.includes(key))throw new Error('歌曲不在当前歌单中');
    this.state.videoPanel={open:true,expanded:!!this.state.videoPanel.expanded};
    this.state.videoAuth=null;this.state.videoPreview=null;
    const position=fromPlayback?this.state.positionMs:effectivePlayRange(track).startMs;
    this.videoMode=true;await this.playKey(key,{resume:false,startAtMs:position,fromPlayback,playlistId});
  }
  async setVideoPanel({open,expanded=false}){
    if(typeof open!=='boolean'||typeof expanded!=='boolean')throw new Error('视频侧栏参数无效');
    if(!open)await this.closeVideo();
    this.state.videoPanel={open,expanded:open&&expanded};this.publish();
  }
  async closeVideo(){
    this.videoMode=false;this.state.videoOpen=false;this.state.videoPanel={open:false,expanded:false};
    if(this.active?.backend!=='video'){this.publish();return;}
    this.pendingResume={key:this.queue.currentKey,positionMs:this.state.positionMs};
    this.wantsPlayback=false;this.clearTimer();this.generation=++this.serial;this.active=null;this.cancelPrepared();
    const generation=this.generation;
    // A native closed event arrives after its webContents has been destroyed.
    // Pausing that page can reject; local playback cleanup must still finish.
    try{await this.video?.pause();}catch{}
    try{await this.video?.close?.();}catch{}
    if(this.generation!==generation)return;
    this.state.backend=null;this.state.status='paused';this.state.playbackQuality=null;this.publish(true);
  }
  playlist(id=this.state.activePlaylistId) {
    const playlist=this.state.playlists.find(p=>p.id===id);
    if(!playlist)throw new Error('歌单不存在');
    return playlist;
  }
  playlistName(name) {
    if(typeof name!=='string'||!name.trim())throw new Error('请输入歌单名称');
    if(name.trim().length>100)throw new Error('歌单名称不能超过 100 个字符');
    return name.trim();
  }
  pruneTracks() {
    this.syncActivePlaylist();
    const referenced=new Set(this.state.playlists.flatMap(p=>p.queue));
    this.state.tracks=this.state.tracks.filter(track=>referenced.has(track.key));
  }
  async createPlaylist(name) {
    name=this.playlistName(name);
    const id=randomUUID();
    this.state.playlists.push({id,name,queue:[],mode:'sequential',currentKey:null});
    await this.selectPlaylist(id);
    return id;
  }
  async selectPlaylist(id) {
    this.playlist(id);
    if(id===this.state.activePlaylistId)return;
    this.syncActivePlaylist();
    this.state.activePlaylistId=id;
    this.publish(true);
  }
  renamePlaylist(id,name) {
    this.playlist(id).name=this.playlistName(name);this.publish(true);
  }
  async deletePlaylist(id) {
    this.playlist(id);
    if(this.state.playlists.length===1)throw new Error('至少需要保留一个歌单');
    this.syncActivePlaylist();
    this.state.playlists=this.state.playlists.filter(p=>p.id!==id);
    if(id===this.state.activePlaylistId)this.state.activePlaylistId=this.state.playlists[0].id;
    this.pruneTracks();this.publish(true);
  }
  addTracks(tracks,playlistId=this.state.activePlaylistId) {
    return this.addTracksDetailed(tracks,playlistId).added;
  }
  addTracksDetailed(tracks,playlistId=this.state.activePlaylistId) {
    return this.addTracksToPlaylist(tracks,playlistId,true);
  }
  addTracksToPlaylist(tracks,playlistId,save) {
    this.syncActivePlaylist();
    const playlist=this.playlist(playlistId);
    const catalog=new Map(this.state.tracks.map(t=>[t.key,t]));
    const known=new Set(playlist.queue);
    const metadata=new Set(playlist.queue.map(key=>trackMetadataIdentity(catalog.get(key))).filter(identity=>identity!==null));
    const accepted=[];const result={added:0,existingKey:0,duplicateMetadata:0};
    for(const track of tracks){
      if(known.has(track.key)){result.existingKey++;continue;}
      const canonical=catalog.get(track.key)||track;
      const identity=trackMetadataIdentity(canonical);
      if(identity!==null&&metadata.has(identity)){result.duplicateMetadata++;continue;}
      known.add(track.key);if(identity!==null)metadata.add(identity);
      if(!catalog.has(track.key)){this.state.tracks.push(track);catalog.set(track.key,track);}
      accepted.push(track.key);result.added++;
    }
    if(accepted.length){
      playlist.queue=[...accepted,...playlist.queue];
      if(save)this.publish(true);
    }
    return result;
  }
  importBackup(data) {
    const source=normaliseLibrary(data);
    const byKey=new Map(source.tracks.map(track=>[track.key,track]));
    const result={added:0,existingKey:0,duplicateMetadata:0,playlistsCreated:0};
    const isMultiple=data?.schemaVersion===2||Array.isArray(data?.playlists);
    if(!isMultiple){
      Object.assign(result,this.addTracksDetailed(source.queue.map(key=>byKey.get(key))));
      return result;
    }
    this.syncActivePlaylist();
    const names=new Set(this.state.playlists.map(playlist=>playlist.name));
    for(const sourcePlaylist of source.playlists){
      let name=sourcePlaylist.name;
      for(let suffix=1;names.has(name);suffix++){
        const tail=suffix===1?'（导入）':`（导入 ${suffix}）`;
        name=sourcePlaylist.name.slice(0,100-tail.length)+tail;
      }
      names.add(name);
      const playlist={id:randomUUID(),name,queue:[],mode:sourcePlaylist.mode,currentKey:null};
      this.state.playlists.push(playlist);
      const added=this.addTracksToPlaylist(sourcePlaylist.queue.map(key=>byKey.get(key)),playlist.id,false);
      for(const key of ['added','existingKey','duplicateMetadata'])result[key]+=added[key];
      const selected=byKey.get(sourcePlaylist.currentKey);
      if(playlist.queue.includes(sourcePlaylist.currentKey))playlist.currentKey=sourcePlaylist.currentKey;
      else if(selected){
        const identity=trackMetadataIdentity(selected);
        if(identity!==null)playlist.currentKey=playlist.queue.find(key=>trackMetadataIdentity(this.state.tracks.find(track=>track.key===key))===identity)||null;
      }
      result.playlistsCreated++;
    }
    this.publish(true);return result;
  }
  async remove(key) {
    const playlist=this.playlist();if(!playlist.queue.includes(key))return;
    playlist.queue=playlist.queue.filter(k=>k!==key);
    if(playlist.currentKey===key)playlist.currentKey=null;
    this.pruneTracks();this.publish(true);
  }
  async clear() {
    const playlist=this.playlist();playlist.queue=[];playlist.currentKey=null;
    this.pruneTracks();this.publish(true);
  }
  reorder(keys) {
    const playlist=this.playlist();
    if(!Array.isArray(keys)||keys.length!==playlist.queue.length||new Set(keys).size!==keys.length||keys.some(k=>!playlist.queue.includes(k)))throw new Error('排序内容与歌单不一致');
    playlist.queue=[...keys];this.publish(true);
  }
  close(){this.generation=++this.serial;this.clearTimer();this.clearSeek();this.cancelPrepared();this.audio.destroy();this.web.destroy();this.video?.destroy();}
}
module.exports={PlayerEngine,errorMessage};
