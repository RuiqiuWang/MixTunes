'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {TrackExporter,extensionFor}=require('../src/track-export.cjs');
function fixture(t,options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-export-safe-')), directory=path.join(root,'downloads');fs.mkdirSync(directory);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const track={key:'netease:1',platform:'netease',sourceId:'1',title:'Song',artist:'Artist'};
  const exporter=new TrackExporter({directory,resolveTrack:async()=>({url:'https://m.music.126.net/a.mp3'}),contextFor:()=>({}),fetchMedia:async()=>new Response('new audio'),autoPrune:false,...options});
  return{root,directory,track,exporter};
}
test('downloads preserve pre-existing same-name user files',async t=>{
  const{directory,track,exporter}=fixture(t);const original=path.join(directory,'Artist - Song.mp3');fs.writeFileSync(original,'keep me');
  const result=await exporter.ensure(track);assert.equal(fs.readFileSync(original,'utf8'),'keep me');assert.notEqual(result.path,original);assert.equal(fs.readFileSync(result.path,'utf8'),'new audio');
});
test('concurrent same-name tracks reserve separate destinations',async t=>{
  const{track,exporter}=fixture(t);const results=await Promise.all([exporter.ensure(track),exporter.ensure({...track,key:'netease:2',sourceId:'2'})]);
  assert.notEqual(results[0].path,results[1].path);for(const r of results)assert.equal(fs.readFileSync(r.path,'utf8'),'new audio');
});
test('an oversized unknown-length response is stopped during streaming',async t=>{
  let produced=0,cancelled=false;
  const{track,exporter,directory}=fixture(t,{maxBytes:16,fetchMedia:async()=>new Response(new ReadableStream({pull(c){produced++;c.enqueue(new Uint8Array(16));if(produced===100)c.close();},cancel(){cancelled=true;}}))});
  await assert.rejects(exporter.ensure(track),/过大/);assert.ok(produced<10,`read ${produced} chunks before stopping`);assert.ok(cancelled);assert.deepEqual(fs.readdirSync(directory),[]);
});
test('untrusted index paths cannot read or prune outside the download directory',t=>{
  const{root,directory,track,exporter}=fixture(t,{maxBytes:1,autoPrune:true});const outside=path.join(root,'outside.mp3');fs.writeFileSync(outside,'keep');
  fs.writeFileSync(path.join(directory,'index.json'),JSON.stringify({files:{[track.key]:{file:'../outside.mp3',updatedAt:0}}}));
  assert.equal(exporter.cachedPath(track),null);exporter.prune();assert.equal(fs.readFileSync(outside,'utf8'),'keep');
});
test('cancelling a stream closes its upstream before returning',async t=>{
  let cancelled=false,produced=0;
  const{track,exporter,directory}=fixture(t,{fetchMedia:async()=>new Response(new ReadableStream({async pull(c){await new Promise(r=>setTimeout(r,10));produced++;c.enqueue(new Uint8Array(16));},cancel(){cancelled=true;}}))});
  const pending=exporter.ensure(track);while(!produced)await new Promise(r=>setTimeout(r,5));assert.equal(exporter.cancel(track.key),true);await assert.rejects(pending,/取消/);
  assert.ok(cancelled);assert.deepEqual(fs.readdirSync(directory),[]);
});
test('unknown URL extensions cannot produce executable download names',()=>{
  assert.equal(extensionFor({url:'https://m.music.126.net/music.exe'}),'mp3');
});
