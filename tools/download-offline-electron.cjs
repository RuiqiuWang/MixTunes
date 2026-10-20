'use strict';
// Real main/preload/download/filesystem/PCM playback. Remote provider responses
// are local fixtures; no personal profile, account or platform media is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('../app/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-download-e2e-'));
const tracks=[1,2].map(id=>({platform:'netease',sourceId:String(id),key:'netease:'+id,url:'https://music.163.com/song?id='+id,title:'Fixture '+id,artist:'Test',durationMs:60000}));
const library={schemaVersion:2,tracks,playlists:[{id:'p',name:'Fixture',queue:tracks.map(t=>t.key),mode:'sequential',currentKey:null}],activePlaylistId:'p'};
fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify(library));
const pcm=Buffer.alloc(44+8000*2*60);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(8000,24);pcm.writeUInt32LE(16000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);fs.writeFileSync(path.join(directory,'fixture.wav'),pcm);
const packaged=process.env.MIXTUNES_REVIEW_EXECUTABLE;
if(packaged){const folder=path.join(directory,'downloads');fs.mkdirSync(folder);fs.copyFileSync(path.join(directory,'fixture.wav'),path.join(folder,'cached.wav'));fs.writeFileSync(path.join(folder,'downloads.json'),JSON.stringify({files:Object.fromEntries(tracks.map(track=>[track.key,{file:'cached.wav',updatedAt:Date.now()}]))}));}
const bootstrap=path.join(directory,'bootstrap.cjs');
// Resolve Electron's builtin from the launched runtime, not its npm executable locator.
fs.writeFileSync(bootstrap,`const fs=require('node:fs'),{app}=require('electron');
const p=require(${JSON.stringify(path.join(root,'app/src/providers.cjs'))});
const state={offline:false,resolves:0,fetches:0,drag:[]};app.__mixDownloadFixture=state;
p.resolveTrack=async track=>{state.resolves++;if(state.offline)throw Error('Fixture offline');return{url:'https://m.music.126.net/fixture'+track.sourceId+'.wav',codec:'wav',quality:'Fixture'};};
p.fetchMedia=async url=>{state.fetches++;if(state.offline)throw Error('Unexpected network');const bytes=fs.readFileSync(${JSON.stringify(path.join(directory,'fixture.wav'))});
if(url.includes('fixture2'))return new Response(new ReadableStream({async pull(c){await new Promise(r=>setTimeout(r,50));c.enqueue(new Uint8Array(1024));}}));return new Response(bytes,{headers:{'content-length':String(bytes.length)}});};
require(${JSON.stringify(path.join(root,'app/src/main.cjs'))});`);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let app;const checks=[];try{
 app=await _electron.launch({executablePath:packaged||require('../app/node_modules/electron'),args:[...packaged?[]:[bootstrap],'--test-mode','--data-dir='+directory],timeout:60000});
 const page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('connection-status')?.textContent==='已就绪');
 const call=(method,...args)=>page.evaluate(({method,args})=>window.playerAPI[method](...args),{method,args});
 const downloads=path.join(directory,'downloads');fs.mkdirSync(downloads,{recursive:true});const existing=path.join(downloads,'Test - Fixture 1.wav');fs.writeFileSync(existing,'keep original');
 const result=await call('trackDownload','netease:1');assert.equal(result.ok,true);assert.notEqual(result.path,existing);assert.deepEqual(fs.readFileSync(result.path),pcm);assert.equal(fs.readFileSync(existing,'utf8'),'keep original');checks.push('download and same-name preservation');
 if(packaged){
  assert.equal(result.cached,true);await call('command','play',{key:'netease:1',playlistId:'p'});
  await page.waitForFunction(()=>window.playerAPI.getState().then(s=>s.status==='playing'&&s.positionMs>250),undefined,{timeout:15000});
  let state=await call('getState');assert.equal(state.playbackQuality.actual,'local');const generation=state.generation;
  await call('command','seek',{positionMs:5000});await page.waitForFunction(()=>window.playerAPI.getState().then(s=>s.status==='playing'&&s.positionMs>=5000));state=await call('getState');assert.equal(state.generation,generation);
  const report={passed:true,checks:['packaged download cache is reused','packaged real decoded local playback and seek preserve generation'],actualDecoderUsed:true,preseededDownload:true,personalProfileUsed:false};if(process.env.MIXTUNES_DOWNLOAD_REPORT)fs.writeFileSync(process.env.MIXTUNES_DOWNLOAD_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
 }
 const before=await app.evaluate(({app})=>({...app.__mixDownloadFixture}));
 const prepared=await call('prepareTrackFile','netease:1');assert.equal(prepared.path,result.path);assert.equal(prepared.cached,true);assert.equal((await call('trackFileStatus',['netease:1'])).ready[0],'netease:1');assert.equal((await app.evaluate(({app})=>app.__mixDownloadFixture.fetches)),before.fetches);checks.push('export reuses permanent download without duplicate network/cache');
 await app.evaluate(({app,BrowserWindow})=>{const state=app.__mixDownloadFixture;state.offline=true;BrowserWindow.getAllWindows().find(w=>/index\.html/.test(w.webContents.getURL())).webContents.startDrag=payload=>state.drag.push(payload.file);});
 await call('startTrackDrag','netease:1');await delay(100);assert.equal((await app.evaluate(({app})=>app.__mixDownloadFixture.drag))[0],result.path);checks.push('trusted native drag IPC selects downloaded file (OS gesture mocked)');
 await call('command','play',{key:'netease:1',playlistId:'p'});await page.waitForFunction(()=>window.playerAPI.getState().then(s=>s.status==='playing'&&s.positionMs>250),undefined,{timeout:15000});
 let state=await call('getState');assert.equal(state.playbackQuality.actual,'local');const generation=state.generation;
 await call('command','seek',{positionMs:5000});await page.waitForFunction(()=>window.playerAPI.getState().then(s=>s.status==='playing'&&s.positionMs>=5000));state=await call('getState');assert.equal(state.generation,generation);assert.equal((await app.evaluate(({app})=>app.__mixDownloadFixture.fetches)),before.fetches);checks.push('real decoded offline playback and seek preserve generation');
 await call('command','pause');await app.evaluate(({app})=>{app.__mixDownloadFixture.offline=false;});
 const pending=page.evaluate(()=>{window.__downloadPending=window.playerAPI.trackDownload('netease:2');return true;});await pending;await delay(160);
 const change=await call('chooseDownloads');assert.equal(change.ok,false);assert.match(change.error,/完成或取消/);
 const cancel=await call('trackDownloadCancel','netease:2');assert.equal(cancel.stopped,true);const cancelled=await page.evaluate(()=>window.__downloadPending);assert.equal(cancelled.cancelled,true);assert.equal(fs.readdirSync(downloads).some(n=>n.endsWith('.part')),false);checks.push('cancel closes file and directory changes are blocked during download');
 const report={passed:true,checks,actualDecoderUsed:true,remoteResponsesMocked:true,osDragGestureMocked:true,personalProfileUsed:false};if(process.env.MIXTUNES_DOWNLOAD_REPORT)fs.writeFileSync(process.env.MIXTUNES_DOWNLOAD_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error);process.exitCode=1;}finally{if(app)await app.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}})();
