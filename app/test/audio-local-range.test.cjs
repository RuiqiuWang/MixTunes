'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');const {AudioPlayer}=require('../src/audio-player.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-local-range-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'sample.mp3');fs.writeFileSync(file,'0123456789');const audio=new AudioPlayer({electron:{},sessionFor:()=>{},onEvent:()=>{}});return{audio,url:pathToFileURL(file).href};}
test('offline suffix ranges return the requested tail and preserve normal seeks',async t=>{
 const{audio,url}=fixture(t);for(const [range,text,header]of[['bytes=-3','789','bytes 7-9/10'],['bytes=3-5','345','bytes 3-5/10'],['bytes=7-','789','bytes 7-9/10']]){
  const result=audio.streamLocal(new Request('mix-audio://stream/test',{headers:{range}}),{url});assert.equal(result.status,206);assert.equal(result.headers.get('content-range'),header);assert.equal(await result.text(),text);
 }
});
test('invalid offline ranges return 416 without opening an unrelated span',async t=>{
 const{audio,url}=fixture(t);for(const range of ['bytes=-','bytes=0-1,4-5','bytes=10-','bytes=-0'])assert.equal(audio.streamLocal(new Request('mix-audio://stream/test',{headers:{range}}),{url}).status,416);
});
test('speed chosen before audio initialization reaches the loaded renderer',async()=>{
 const audio=new AudioPlayer({electron:{},sessionFor:()=>{},onEvent:()=>{}}),commands=[];audio.send=command=>commands.push(command);audio.init=async()=>{};audio.rate(1.75);
 await audio.load({key:'netease:1',platform:'netease'},1,{url:'file:///fixture.mp3'});assert.equal(commands.find(c=>c.name==='load').rate,1.75);
});
