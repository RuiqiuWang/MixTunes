'use strict';
// Run with node --test tools/windows-tray-electron.cjs on Windows.
// MIXTUNES_TRAY_EXECUTABLE optionally selects an unpacked packaged executable.
// All profiles and the missing-icon fixture are new temporary directories.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('../app/node_modules/playwright-core');
const source=path.resolve(__dirname,'../app');
const sourceElectron=require('../app/node_modules/electron');
const executable=process.env.MIXTUNES_TRAY_EXECUTABLE;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor(check,message){
  const end=Date.now()+30000;
  while(Date.now()<end){if(await check())return;await delay(100);}
  throw new Error(message);
}
async function launch(t,{missingIcon=false,smoke=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-tray-'));
  let appDir=source;
  if(missingIcon){
    appDir=path.join(root,'app');fs.mkdirSync(appDir);
    for(const entry of ['src','ui','package.json','LICENSE']){
      fs.cpSync(path.join(source,entry),path.join(appDir,entry),{
        recursive:true,filter:file=>file!==path.join(source,'ui/tray.png')
      });
    }
    assert.equal(fs.existsSync(path.join(appDir,'ui/tray.png')),false);
  }
  const data=path.join(root,'data');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const packaged=Boolean(executable)&&!missingIcon;
  const app=await _electron.launch({
    executablePath:packaged?executable:sourceElectron,
    args:[...packaged?[]:[appDir],'--test-mode',`--data-dir=${data}`,...smoke?['--smoke-test']:[]],
    env,timeout:60000
  });
  const child=app.process();
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{await app.close().catch(()=>{});});
  await waitFor(()=>{
    const file=path.join(data,'playback-events.jsonl');
    return fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('"type":"app-ready"');
  },'Application did not finish startup');
  return {app,data,exited,packaged};
}
async function cleanExit(exited){
  let timeout;
  try{
    const result=await Promise.race([exited,new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(new Error('Application did not exit')),15000);
    })]);
    assert.equal(result.code,0);assert.equal(result.signal,null);
  }finally{clearTimeout(timeout);}
}

test('real Electron hides and restores the same window without changing player state, then exits',
  {skip:process.platform!=='win32',timeout:90000},async t=>{
    const {app,exited,packaged}=await launch(t);
    assert.equal(await app.evaluate(({app})=>app.isPackaged),packaged);
    const page=await app.firstWindow();
    const before=await page.evaluate(()=>window.playerAPI.getState());
    const id=await app.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MixTunes');
      win.show();return win.id;
    });
    for(let i=0;i<3;i++){
      const hidden=await app.evaluate(({BrowserWindow})=>{
        const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MixTunes');
        win.close();return {id:win.id,visible:win.isVisible(),destroyed:win.isDestroyed(),count:BrowserWindow.getAllWindows().length};
      });
      assert.deepEqual(hidden,{id,visible:false,destroyed:false,count:1});
      const after=await page.evaluate(()=>window.playerAPI.getState());
      for(const key of ['currentKey','positionMs','status','queue','playbackQueue','playbackPlaylistId','tracks','playlists']){
        assert.deepEqual(after[key],before[key],`Closing changed ${key}`);
      }
      await app.evaluate(({app,BrowserWindow})=>{
        const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MixTunes');
        win.minimize();app.emit('second-instance');
      });
      await waitFor(()=>app.evaluate(({BrowserWindow})=>{
        const windows=BrowserWindow.getAllWindows();
        return windows.length===1&&windows[0].isVisible()&&!windows[0].isMinimized();
      }),'Existing window was not restored');
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].id),id);
    }
    await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});
    await cleanExit(exited);
  });

test('real Electron without its tray image closes normally instead of becoming unreachable',
  {skip:process.platform!=='win32',timeout:90000},async t=>{
    const {app,data,exited}=await launch(t,{missingIcon:true});
    const events=fs.readFileSync(path.join(data,'playback-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e=>e.type==='tray-unavailable'&&e.reason==='icon-missing'));
    await app.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='MixTunes');
      win.show();setTimeout(()=>win.close(),0);
    });
    await cleanExit(exited);
  });

test('smoke startup reports an available tray and finishes with a real quit',
  {skip:process.platform!=='win32',timeout:90000},async t=>{
    const {data,exited,packaged}=await launch(t,{smoke:true});
    await cleanExit(exited);
    const result=JSON.parse(fs.readFileSync(path.join(data,'smoke-result.json'),'utf8'));
    assert.equal(result.ok,true);assert.equal(result.packaged,packaged);assert.equal(result.trayAvailable,true);
  });
