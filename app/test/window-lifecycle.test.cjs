'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {closeAction,restoreMainWindow,installMainWindowLifecycle}=require('../src/window-lifecycle.cjs');

class FakeWindow extends EventEmitter{
  constructor(){super();this.destroyed=false;this.visible=true;this.minimized=false;this.shows=0;this.focuses=0;this.restores=0;this.hides=0;}
  isDestroyed(){return this.destroyed;}
  isMinimized(){return this.minimized;}
  hide(){this.visible=false;this.hides++;}
  show(){this.visible=true;this.shows++;}
  focus(){this.focuses++;}
  restore(){this.minimized=false;this.restores++;}
  close(){
    const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    this.emit('close',event);
    if(!event.defaultPrevented){this.destroyed=true;this.emit('closed');}
    return event;
  }
}

function lifecycle(win,{trayAvailable=true,quitting=false}={}){
  const state={quitting,quits:0,notices:0};
  installMainWindowLifecycle(win,{
    trayAvailable:()=>trayAvailable,
    isQuitting:()=>state.quitting,
    onQuit:()=>{state.quits++;},
    onFirstHide:()=>{state.notices++;}
  });
  return state;
}

test('closeAction hides only when a tray exists and the app is not quitting',()=>{
  assert.equal(closeAction({trayAvailable:true,quitting:false}),'hide');
  assert.equal(closeAction({trayAvailable:false,quitting:false}),'close');
  assert.equal(closeAction({trayAvailable:true,quitting:true}),'close');
  assert.equal(closeAction({trayAvailable:false,quitting:true}),'close');
  assert.equal(closeAction(),'close');
});

test('closing with a tray hides the window and keeps the app alive',()=>{
  const win=new FakeWindow();const state=lifecycle(win);
  const event=win.close();
  assert.equal(event.defaultPrevented,true);
  assert.equal(win.isDestroyed(),false);
  assert.equal(win.visible,false);
  assert.equal(state.quits,0);
  assert.equal(state.notices,1);
});

test('closing without a tray closes the window and quits',()=>{
  const win=new FakeWindow();const state=lifecycle(win,{trayAvailable:false});
  const event=win.close();
  assert.equal(event.defaultPrevented,false);
  assert.equal(win.isDestroyed(),true);
  assert.equal(state.quits,1);
});

test('a real quit is never turned back into a hide',()=>{
  const win=new FakeWindow();const state=lifecycle(win);
  state.quitting=true;
  const event=win.close();
  assert.equal(event.defaultPrevented,false);
  assert.equal(win.isDestroyed(),true);
  assert.equal(win.hides,0);
  assert.equal(state.quits,0);
});

test('the background notice is shown once across repeated hides',()=>{
  const win=new FakeWindow();const state=lifecycle(win);
  win.close();win.close();win.close();
  assert.equal(win.isDestroyed(),false);
  assert.equal(win.hides,3);
  assert.equal(state.notices,1);
});

test('restore shows the existing window, restoring it when minimized',()=>{
  const win=new FakeWindow();
  assert.equal(restoreMainWindow(win),true);
  assert.equal(win.shows,1);assert.equal(win.focuses,1);assert.equal(win.restores,0);
  win.minimized=true;
  assert.equal(restoreMainWindow(win),true);
  assert.equal(win.restores,1);assert.equal(win.shows,2);
  win.destroyed=true;
  assert.equal(restoreMainWindow(win),false);
  assert.equal(win.shows,2);
  assert.equal(restoreMainWindow(null),false);
});

test('installing twice keeps a single handler pair and never duplicates the window',()=>{
  const win=new FakeWindow();
  assert.equal(installMainWindowLifecycle(win,{trayAvailable:()=>true,isQuitting:()=>false,onQuit:()=>{}}),true);
  assert.equal(installMainWindowLifecycle(win,{trayAvailable:()=>false,isQuitting:()=>false,onQuit:()=>{}}),false);
  assert.equal(win.listenerCount('close'),1);
  assert.equal(win.listenerCount('closed'),1);
  win.close();win.close();
  assert.equal(win.hides,2);
  assert.equal(win.isDestroyed(),false);
});

test('hiding and restoring preserve an active or paused engine without backend commands',async t=>{
  const {PlayerEngine}=require('../src/engine.cjs');
  const calls=[];
  const audio={
    async load(track,generation){calls.push('load');return {key:track.key,generation,token:String(generation)};},
    activate(){calls.push('activate');},stopAll(){calls.push('stop');},pause(){calls.push('pause');},
    seek(){calls.push('seek');},volume(){},unload(){},destroy(){}
  };
  const track={key:'netease:1',platform:'netease',sourceId:'1',title:'Isolated fixture',url:'https://music.163.com/song?id=1'};
  const engine=new PlayerEngine({library:{tracks:[track],queue:[track.key]},audio,
    web:{destroy(){}},contextFor:()=>({}),resolveTrack:async()=>({url:'https://m.music.126.net/test.mp3'})});
  t.after(()=>engine.close());
  await engine.playKey(track.key);
  engine.onEvent({type:'playing',key:track.key,generation:engine.generation});
  engine.onEvent({type:'progress',key:track.key,generation:engine.generation,positionMs:12345,durationMs:180000});
  const win=new FakeWindow();lifecycle(win);
  for(const status of ['playing','paused']){
    if(status==='paused')await engine.pause();
    const before=engine.snapshot(),commands=[...calls];
    assert.equal(before.status,status);
    assert.equal(before.positionMs,12345);
    win.close();restoreMainWindow(win);
    assert.deepEqual(engine.snapshot(),before);
    assert.deepEqual(calls,commands);
  }
});
