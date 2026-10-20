'use strict';
const fs=require('node:fs'),path=require('node:path');
const electron=require('electron');
const data=process.argv.find(a=>a.startsWith('--data-dir=')).slice(11);
electron.app.setPath('userData',data);electron.app.setPath('sessionData',data);electron.app.setName('MixTunes');
if(!electron.app.requestSingleInstanceLock()){electron.app.quit();}
else{
  const source=path.resolve(__dirname,'../app');
  const providers=require(path.join(source,'src/providers.cjs'));
  providers.resolveTrack=async track=>{
    if(!['netease:700000001','netease:700000002'].includes(track.key))throw new Error('Not a synthetic review track');
    return{url:'https://m.music.126.net/isolated-review.wav',quality:'Synthetic PCM WAV',codec:'wav'};
  };
  const {AudioPlayer}=require(path.join(source,'src/audio-player.cjs'));
  const baseLoad=AudioPlayer.prototype.load;
  AudioPlayer.prototype.load=async function(...args){global.__reviewAudio=this;return baseLoad.apply(this,args);};
  const bytes=Buffer.alloc(44+8000*2*12);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  AudioPlayer.prototype.stream=async function(request){
    const token=new URL(request.url).pathname.slice(1);
    if(!this.tokens.has(token))return new Response('Expired',{status:404});
    const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range')||'');
    const begin=range?Number(range[1]):0,end=range&&range[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;
    if(begin>=bytes.length)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});
    const body=bytes.subarray(begin,end+1),headers={'Content-Type':'audio/wav','Content-Length':String(body.length),'Accept-Ranges':'bytes'};
    if(range)headers['Content-Range']='bytes '+begin+'-'+end+'/'+bytes.length;
    return new Response(body,{status:range?206:200,headers});
  };
  const build=electron.Menu.buildFromTemplate;
  electron.Menu.buildFromTemplate=function(template){
    if(template.some(item=>item.label==='打开播放器'))global.__reviewTrayMenu=template;
    return build.call(this,template);
  };
  const {SearchService}=require(path.join(source,'src/search-service.cjs'));
  const search=SearchService.prototype.search;
  SearchService.prototype.search=async function(payload){
    this.searchPlatform=async()=>({items:[{platform:'netease',id:'700000002',url:'https://music.163.com/song?id=700000002',title:'Review PCM 2',artist:'Synthetic'}],total:1});
    this.importResource=()=>new Promise(resolve=>{global.__releaseImport=()=>resolve({tracks:[{key:'netease:700000002',platform:'netease',sourceId:'700000002',url:'https://music.163.com/song?id=700000002',title:'Review PCM 2',artist:'Synthetic'}]});});
    return search.call(this,payload);
  };
  require(path.join(source,'src/main.cjs'));
}
