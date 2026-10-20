'use strict';
(() => {
  const slots = new Map();
  // 倍速：整窗共享一个值，新加载的音频元素也要继承。
  let currentRate = 1;
  const rateValue = () => currentRate;
  function emit(command, type, audio, extra = {}) {
    window.audioBridge.event({ type, key: command.key, generation: command.generation,
      token: command.token, slot: command.slot, positionMs: Math.round((audio.currentTime || 0) * 1000),
      durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0, ...extra });
  }
  function rangeFor(entry) {
    const range=entry.range||{startMs:0,endMs:null};
    const duration=Number.isFinite(entry.audio.duration)?entry.audio.duration*1000:null;
    return {startMs:Math.max(0,Number(range.startMs)||0),endMs:duration===null?range.endMs:Math.min(range.endMs??duration,duration)};
  }
  function stopTimer(entry){clearInterval(entry.timer);entry.timer=null;}
  function finish(entry){
    if(entry.endedSent||entry.disposed||!entry.positioned||entry.pendingPosition!==null&&entry.pendingPosition!==undefined)return;
    entry.endedSent=true;entry.wantPlay=false;stopTimer(entry);entry.audio.pause();
    emit(entry.command,'ended',entry.audio);
  }
  function checkBoundary(entry){
    const range=rangeFor(entry);
    if(entry.wantPlay&&entry.positioned&&range.endMs!==null&&entry.audio.currentTime*1000>=range.endMs)finish(entry);
  }
  async function start(entry){
    if(!entry.wantPlay||!entry.positioned||entry.disposed)return;
    if(entry.audio.currentTime*1000<rangeFor(entry).startMs-100){position(entry,rangeFor(entry).startMs);return;}
    checkBoundary(entry);if(!entry.wantPlay)return;
    try{await entry.audio.play();if(entry.wantPlay&&!entry.disposed){stopTimer(entry);entry.timer=setInterval(()=>checkBoundary(entry),50);}}
    catch(error){
      if(error.name==='AbortError'&&entry.audio.paused)return;
      emit(entry.command,'error',entry.audio,{message:error.name==='NotAllowedError'?'自动播放被阻止，请再次点击播放':'音频未能开始播放',code:error.name});
    }
  }
  function position(entry,positionMs){
    entry.pendingPosition=positionMs;entry.positioned=false;
    if(entry.audio.readyState<1)return;
    const range=rangeFor(entry);
    if(Number.isFinite(entry.audio.duration)&&range.startMs>=entry.audio.duration*1000){
      entry.wantPlay=false;emit(entry.command,'error',entry.audio,{message:'播放起点超过音频实际时长',code:'INVALID_RANGE'});return;
    }
    const target=Math.max(range.startMs,Math.min(range.endMs??Infinity,positionMs));entry.pendingPosition=target;
    if(Math.abs(entry.audio.currentTime*1000-target)<50){entry.positioned=true;entry.pendingPosition=null;start(entry);return;}
    try{entry.audio.currentTime=target/1000;}
    catch{entry.wantPlay=false;emit(entry.command,'error',entry.audio,{message:'音频无法跳转到指定起点',code:'RANGE_SEEK_FAILED'});}
  }
  window.audioBridge.onCommand(async command => {
    if (command.name === 'load') {
      const old = slots.get(command.slot);
      if (old) { old.disposed=true;old.wantPlay=false;stopTimer(old);old.audio.pause(); old.audio.removeAttribute('src'); old.audio.load(); old.audio.remove(); }
      // A new element for every load keeps delayed events tied to the old generation.
      const audio = document.createElement('audio');
      audio.preload = 'auto'; audio.volume = command.volume ?? .7;
      audio.muted = !!command.muted;
      audio.playbackRate = Math.max(.5,Math.min(2,Number(command.rate)||rateValue()));
      document.body.append(audio);
      const entry = { audio, command, range:command.playRange||{startMs:0,endMs:null},wantPlay:false,positioned:false,endedSent:false };
      slots.set(command.slot, entry);
      audio.addEventListener('loadedmetadata',()=>{
        const range=rangeFor(entry);const reset=Number.isFinite(audio.duration)&&range.startMs>=audio.duration*1000;
        if(reset){entry.rangeBlocked=true;entry.positioned=false;audio.pause();}
        emit(command,'metadata',audio,{rangeReset:reset});
        if(!reset)position(entry,entry.pendingPosition??rangeFor(entry).startMs);
      });
      audio.addEventListener('seeked',()=>{
        if(entry.pendingPosition!==null&&entry.pendingPosition!==undefined&&Math.abs(audio.currentTime*1000-entry.pendingPosition)>150)return;
        entry.pendingPosition=null;entry.positioned=true;emit(command,'seeked',audio);start(entry);
      });
      audio.addEventListener('timeupdate',()=>{checkBoundary(entry);emit(command,'progress',audio);});
      audio.addEventListener('ended',()=>finish(entry));
      audio.addEventListener('playing',()=>{
        if(!entry.wantPlay||!entry.positioned){audio.pause();return;}
        checkBoundary(entry);if(entry.wantPlay)emit(command,'playing',audio);
      });
      for (const [event,type] of [['canplay','ready'],['pause','paused'],['waiting','buffering']]) {
        audio.addEventListener(event, () => {if(event==='pause')stopTimer(entry);emit(command,type,audio);});
      }
      audio.addEventListener('error', () => emit(command,'error',audio,{
        message: `音频加载失败（媒体错误 ${audio.error?.code || 0}）`, code: audio.error?.code || 0
      }));
      audio.src = command.url;
      audio.load();
      return;
    }
    if (command.name === 'stop-all') {
      slots.forEach(entry => {entry.wantPlay=false;stopTimer(entry);entry.audio.pause();}); return;
    }
    if (command.name === 'volume-all') {
      slots.forEach(({audio}) => { audio.volume = command.volume; audio.muted = !!command.muted; }); return;
    }
    if (command.name === 'rate-all') {
      currentRate = Math.max(0.5, Math.min(2, Number(command.rate) || 1));
      slots.forEach(({audio}) => { try { audio.playbackRate = currentRate; } catch {} }); return;
    }
    const entry = slots.get(command.slot);
    if (!entry || (command.token && command.token !== entry.command.token)) return;
    const {audio} = entry;
    if (command.name === 'play') {
      slots.forEach(other => { if (other !== entry) {other.wantPlay=false;stopTimer(other);other.audio.pause();} });
      entry.wantPlay=true;entry.endedSent=false;
      if(entry.positioned)start(entry);else position(entry,entry.pendingPosition??rangeFor(entry).startMs);
    } else if (command.name === 'pause') {entry.wantPlay=false;stopTimer(entry);audio.pause();}
    else if (command.name === 'seek' && Number.isFinite(command.positionMs)) {
      entry.endedSent=false;position(entry,command.positionMs);
    } else if(command.name==='range'){
      entry.range=command.playRange||{startMs:0,endMs:null};entry.endedSent=false;
      const range=rangeFor(entry);const now=audio.currentTime*1000;
      if(entry.rangeBlocked||now<range.startMs||range.endMs!==null&&now>=range.endMs){entry.rangeBlocked=false;position(entry,range.startMs);}
      else checkBoundary(entry);
    } else if (command.name === 'unload') {
      entry.disposed=true;entry.wantPlay=false;stopTimer(entry);audio.pause(); audio.removeAttribute('src'); audio.load(); audio.remove(); slots.delete(command.slot);
    }
  });
})();
