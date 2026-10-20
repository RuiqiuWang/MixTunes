'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PlayerEngine}=require('../src/engine.cjs'),{shouldPause,cancelPendingPlayback}=require('../src/sleep-timer.cjs');
const tracks=['1','2'].map(id=>({key:'netease:'+id,sourceId:id,platform:'netease',url:'https://music.163.com/song?id='+id,title:'Synthetic '+id}));
test('desktop expiry cancels failed-track auto-advance without changing error state or later user intent',async t=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),fn=source.slice(source.indexOf('async function expireSleepTimer()'),source.indexOf('function setupTray()'));
  const engine=new PlayerEngine({library:{tracks,queue:tracks.map(t=>t.key)},resolveTrack:async()=>({url:'https://m.music.126.net/synthetic.mp3'}),contextFor:()=>({}),audio:{load:async(t,g,r,slot)=>({key:t.key,generation:g,slot}),activate(){},stopAll(){},unload(){},destroy(){},volume(){}},web:{pause(){},destroy(){}}});t.after(()=>engine.close());
  const context={engine,searchService:{cancelPlayback(){}},videoRequestSerial:0,pendingVideo:null,app:{},shouldPause,cancelPendingPlayback,publishSleepTimer(){},record(){},errorMessage:e=>e.message};vm.createContext(context);vm.runInContext(fn,context);
  await engine.playKey(tracks[0].key);await engine.fail(Error('Synthetic failure'),engine.generation);assert.ok(engine.skipTimer);await context.expireSleepTimer();assert.equal(engine.skipTimer,null);
  await new Promise(resolve=>setTimeout(resolve,1900));assert.equal(engine.queue.currentKey,tracks[0].key);assert.equal(engine.state.status,'error');
  await engine.playKey(tracks[1].key);assert.equal(engine.queue.currentKey,tracks[1].key);assert.equal(engine.state.status,'buffering');
});
test('Android expiry cancels a real runtime failed-track auto-advance',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../android/runtime/app-runtime.js'),'utf8'),listeners={};let loads=0;
  const stubs={'./providers.cjs':{resolveTrack:async()=>({url:'https://m.music.126.net/test.mp3'})},'./search-providers.cjs':{},'./search-service.cjs':{SearchService:class{cancelPlayback(){}}},'./lyrics.cjs':{LyricsService:class{invalidate(){}}},'./platform-auth.cjs':{restoredAccountState:()=>({}),inspectAccount:async()=>({})},'./share-link.cjs':{},'./playlist-transfer.cjs':{}};
  const window={__mixRequire:name=>stubs[name]||require('../src/'+name.slice(2)),__mixPlatform:{native:async(name,data)=>{
    if(name==='storage-load')return{json:JSON.stringify({tracks,queue:tracks.map(t=>t.key)})};if(name==='cookies')return[];
    if(name==='audio-load'){loads++;return{token:'synthetic',key:data.key,generation:data.generation,slot:data.slot};}return true;
  },nativeFetch:async()=>{throw Error('unexpected network');}},dispatchEvent(){}};
  vm.runInNewContext(source,{window,document:{addEventListener:(name,fn)=>listeners[name]=fn},localStorage:{getItem:()=>null,setItem(){}},Buffer,URL,CustomEvent:class{},Event:class{},setTimeout,clearTimeout,console});
  await window.playerAPI.getState();await window.playerAPI.command('play',{key:tracks[0].key});const state=await window.playerAPI.getState();
  window.__mixNativeEvent({type:'audio',event:{type:'error',key:tracks[0].key,generation:state.generation,message:'Synthetic failure'}});await new Promise(setImmediate);
  assert.equal((await window.playerAPI.getState()).status,'error');window.__mixNativeEvent({type:'sleep-timer-expired'});await new Promise(resolve=>setTimeout(resolve,1900));
  const after=await window.playerAPI.getState();assert.equal(after.currentKey,tracks[0].key);assert.equal(after.status,'error');assert.equal(loads,1);
});
