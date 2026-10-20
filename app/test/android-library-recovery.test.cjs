'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=fs.readFileSync(path.resolve(__dirname,'../../android/runtime/app-runtime.js'),'utf8');
for(const scenario of ['both-corrupt','read-failed-with-old-cache'])test('Android keeps original storage after '+scenario,async()=>{
  const original=scenario==='both-corrupt'?'{broken':JSON.stringify({schemaVersion:2,tracks:[],playlists:[{id:'new',name:'New',queue:[]}]});
  let disk=original,local=scenario==='both-corrupt'?'{bad':JSON.stringify({tracks:[],_mixtunesSavedAt:1}),writes=0;
  const listeners={},stubs={'./providers.cjs':{},'./search-providers.cjs':{},'./search-service.cjs':{SearchService:class{}},'./lyrics.cjs':{LyricsService:class{invalidate(){}}},'./platform-auth.cjs':{restoredAccountState:()=>({}),inspectAccount:async()=>({})},'./share-link.cjs':{},'./playlist-transfer.cjs':{}};
  const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn};
  const window={__mixRequire:name=>stubs[name]||require('../src/'+name.slice(2)),__mixPlatform:{native:async(name,data)=>{
    if(name==='storage-load'){if(scenario==='read-failed-with-old-cache')throw Error('read failed');return{json:disk};}
    if(name==='storage-save'){disk=data.json;writes++;}if(name==='cookies')return[];return true;
  },nativeFetch:async()=>{throw Error('unexpected network');}},dispatchEvent(){}};
  vm.runInNewContext(runtime,{window,document,localStorage:{getItem:()=>local,setItem:(_k,v)=>local=v},Buffer,URL,CustomEvent:class{},Event:class{},setTimeout,clearTimeout,console});
  const state=await window.playerAPI.getState();assert.equal(state.libraryRecovery.locked,true);await new Promise(setImmediate);
  document.hidden=true;listeners.visibilitychange();await window.playerAPI.command('volume',{volume:.5});await new Promise(setImmediate);
  assert.equal(writes,0);assert.equal(disk,original);
  const result=await window.playerAPI.command('playlist-create',{name:'Blocked'});assert.equal(result.ok,false);
});
