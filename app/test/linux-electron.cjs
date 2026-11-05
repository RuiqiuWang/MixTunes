'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright-core');

async function launch(t,args=[]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-linux-'));
  let instance;
  t.after(async()=>{
    await instance?.close().catch(()=>{});
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const executable=process.env.MIXTUNES_LINUX_EXECUTABLE;
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  instance=await _electron.launch({executablePath:executable||require('electron'),
    args:[...executable?[]:[path.resolve(__dirname,'..')],
      '--test-mode',`--data-dir=${profile}`,...args],env,timeout:60000});
  const exited=new Promise(resolve=>instance.process().once('exit',(code,signal)=>resolve({code,signal})));
  const page=await instance.firstWindow();
  // Wayland supplies frame callbacks only after the surface is mapped.
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await page.waitForFunction(()=>document.getElementById('connection-status')?.textContent==='已就绪',undefined,{polling:100});
  // Tray setup finishes after the renderer becomes ready.
  await page.waitForFunction(()=>window.playerAPI.getState().then(s=>Boolean(s.accounts)),undefined,{polling:100});
  const deadline=Date.now()+15000;
  while(!fs.existsSync(path.join(profile,'playback-events.jsonl'))||
    !fs.readFileSync(path.join(profile,'playback-events.jsonl'),'utf8').includes('"type":"app-ready"')){
    if(Date.now()>deadline)throw Error('Application did not finish startup');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  return {instance,page,profile,exited};
}
async function closeWindow(instance){
  await instance.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows().find(w=>/index\.html/.test(w.webContents.getURL()));
    setTimeout(()=>win.close(),0);
  });
}
async function cleanExit(exited){
  let timer;
  try{
    const result=await Promise.race([exited,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Application did not exit')),15000);
    })]);
    assert.deepEqual(result,{code:0,signal:null});
  }finally{clearTimeout(timer);}
}

test('Linux window closes normally with the default tray policy',
  {skip:process.platform!=='linux',timeout:90000},async t=>{
    const {instance,exited}=await launch(t);
    const settings=await instance.evaluate(({app,BrowserWindow})=>{
      const prefs=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {packaged:app.isPackaged,sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration};
    });
    assert.deepEqual(settings,{packaged:Boolean(process.env.MIXTUNES_LINUX_EXECUTABLE),sandbox:true,contextIsolation:true,nodeIntegration:false});
    await closeWindow(instance);await cleanExit(exited);
  });

test('Linux close-to-tray preserves state and second-instance restores the existing window',
  {skip:process.platform!=='linux',timeout:90000},async t=>{
    const {instance,page,exited}=await launch(t,['--close-to-tray']);
    const before=await page.evaluate(()=>window.playerAPI.getState());
    const hidden=await instance.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>/index\.html/.test(w.webContents.getURL()));
      win.close();return {id:win.id,destroyed:win.isDestroyed(),visible:win.isVisible()};
    });
    assert.equal(hidden.destroyed,false);assert.equal(hidden.visible,false);
    const after=await page.evaluate(()=>window.playerAPI.getState());
    for(const key of ['currentKey','positionMs','status','queue','tracks','playlists'])assert.deepEqual(after[key],before[key]);
    await instance.evaluate(({app})=>app.emit('second-instance'));
    const restored=await instance.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>/index\.html/.test(w.webContents.getURL()));
      return {id:win.id,visible:win.isVisible()};
    });
    assert.deepEqual(restored,{id:hidden.id,visible:true});
    await instance.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await cleanExit(exited);
  });

test('Linux close-to-tray with tray disabled exits cleanly',
  {skip:process.platform!=='linux',timeout:90000},async t=>{
    const {instance,exited}=await launch(t,['--close-to-tray','--no-tray']);
    await closeWindow(instance);await cleanExit(exited);
  });
