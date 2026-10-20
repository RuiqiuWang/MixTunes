'use strict';
// Exercise the real Electron WebContentsView visibility change with local media.
// This verifies native hide/show audio continuity, not the live Bilibili website.
const {_electron}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const work=path.resolve(__dirname,'../dist/video-collapse-test');fs.mkdirSync(work,{recursive:true});
 const wav=Buffer.alloc(44+8000*12*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 fs.writeFileSync(path.join(work,'media.html'),'<video preload="auto" src="data:audio/wav;base64,'+wav.toString('base64')+'"></video>');
 const main=`const {app,BrowserWindow,WebContentsView}=require('electron');const {VideoPlayer}=require('../../src/video-player.cjs');app.setPath('userData',__dirname+'/profile');app.whenReady().then(async()=>{const host=new BrowserWindow({show:false,width:640,height:480});await host.loadURL('about:blank');const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});host.contentView.addChildView(view);view.webContents.setAudioMuted(true);const player=new VideoPlayer({electron:{},sessionFor:()=>null,getHostWindow:()=>host});clearInterval(player.timer);player.record={host,view,webContents:view.webContents,disposed:false};app.testVideo={host,view,player,navigations:0};view.webContents.on('did-start-navigation',()=>app.testVideo.navigations++);await view.webContents.loadFile(__dirname+'/media.html');app.testVideo.ready=true;});app.on('window-all-closed',()=>app.quit());`;
 fs.writeFileSync(path.join(work,'main.cjs'),main);
 const electron=await _electron.launch({executablePath:path.resolve(__dirname,'../node_modules/electron/dist/electron.exe'),args:[path.join(work,'main.cjs')],timeout:30000});
 try{
  for(let i=0;i<100&&!await electron.evaluate(({app})=>!!app.testVideo?.ready);i++)await new Promise(r=>setTimeout(r,50));
  await electron.evaluate(async({app})=>{app.testVideo.player.setLayout({visible:true,bounds:{x:0,y:0,width:500,height:300}});await app.testVideo.view.webContents.executeJavaScript('document.querySelector("video").play()');});
  const snapshot=()=>electron.evaluate(({app})=>app.testVideo.view.webContents.executeJavaScript('({paused:document.querySelector("video").paused,position:document.querySelector("video").currentTime})'));
  const before=await snapshot();assert.equal(before.paused,false);
  const hidden=await electron.evaluate(({app})=>app.testVideo.player.setLayout({visible:false}));assert.equal(hidden.visible,false);
  await new Promise(r=>setTimeout(r,650));const after=await snapshot();assert.equal(after.paused,false);assert.ok(after.position>before.position+.25);
  await electron.evaluate(({app})=>app.testVideo.player.setLayout({visible:true}));const shown=await snapshot();assert.equal(shown.paused,false);assert.ok(shown.position>=after.position);
  await electron.evaluate(async({app})=>{await app.testVideo.view.webContents.executeJavaScript('document.querySelector("video").pause()');app.testVideo.player.setLayout({visible:false});app.testVideo.player.setLayout({visible:true});});
  assert.equal((await snapshot()).paused,true);assert.equal(await electron.evaluate(({app})=>app.testVideo.navigations),1);
  console.log(JSON.stringify({ok:true,checks:['real Electron WebContentsView hide keeps audio advancing','same page on reopen','paused media stays paused'],mediaSource:'local WAV',liveBilibiliVerified:false}));
 }finally{await electron.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
