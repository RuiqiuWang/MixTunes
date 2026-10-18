'use strict';
// Local mobile UI integration check. The Android file picker/network are mocked;
// this verifies the actual bundled runtime and button handlers, not a real device.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MIXTUNES_PLAYWRIGHT_MODULE||'../app/node_modules/playwright-core');
const backup={schemaVersion:2,tracks:[{key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'导入测试歌曲',artist:'测试作者'}],playlists:[{id:'restore',name:'界面测试备份',queue:['netease:1'],mode:'sequential'}]};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.MIXTUNES_BROWSER?{executablePath:process.env.MIXTUNES_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(({backup})=>{
      window.__test={importResult:{text:JSON.stringify(backup)},saved:null,calls:[]};
      window.MixTunesBridge={
        crypto(text){const p=JSON.parse(text);if(p.op!=='randomUUID')throw new Error('Unexpected crypto operation');return JSON.stringify({ok:true,value:crypto.randomUUID()});},
        postMessage(text){
          const p=JSON.parse(text);window.__test.calls.push(p.method);let value=true,error=null;
          if(p.method==='storage-load')value={json:null};
          else if(p.method==='storage-save')window.__test.saved=p.payload.json;
          else if(p.method==='cookies')value=[];
          else if(p.method==='import')value=window.__test.importResult;
          else if(p.method==='fetch')error='集成测试不访问平台网络';
          queueMicrotask(()=>window.__mixNativeReply({id:p.id,ok:!error,value,error}));
        }
      };
    },{backup});
    await page.goto(pathToFileURL(path.join(__dirname,'web/index.html')).href);
    await page.waitForFunction(()=>!!window.playerAPI);
    await page.locator('[data-screen="settings"]').click();
    await page.locator('#import-file').click();
    await page.waitForFunction(()=>document.getElementById('notice-text').textContent.includes('恢复 1 个歌单'));
    assert.match(await page.locator('#notice-text').innerText(),/歌单列表/);
    const state=await page.evaluate(()=>window.playerAPI.getState());
    assert.equal(state.activePlaylistId,'default');
    assert.ok(state.playlists.some(p=>p.name==='界面测试备份'&&p.queue.length===1));
    await page.locator('[data-screen="library"]').click();
    await page.locator('#choose-playlist').click();
    await page.getByRole('button',{name:'打开 界面测试备份',exact:true}).click();
    assert.equal(await page.locator('#playlist-title').innerText(),'界面测试备份');
    assert.match(await page.locator('#queue-count').innerText(),/1/);
    // Exercise the bundled Android NativeWeb capability through a real command.
    await page.evaluate(async key=>{
      window.__test.calls=[];
      await window.playerAPI.command('play',{key});
    },backup.tracks[0].key);
    const playback=await page.evaluate(async()=>({state:await window.playerAPI.getState(),calls:window.__test.calls}));
    assert.equal(playback.state.status,'error');
    assert.equal(playback.state.error,'连接平台失败，请检查网络或稍后重试。');
    assert.ok(playback.calls.includes('fetch'));
    assert.ok(!playback.calls.some(method=>method==='web-load'||method==='login'));
    await page.locator('[data-screen="settings"]').click();
    // Navigation can already have cleared the previous success notice.
    if(await page.locator('#dismiss-notice').isVisible())await page.locator('#dismiss-notice').click();
    await page.evaluate(()=>{window.__test.importResult={canceled:true};});
    await page.locator('#import-file').click();
    await page.waitForFunction(()=>!document.getElementById('import-file').disabled);
    assert.equal(await page.locator('#notice').isVisible(),false);
    await page.evaluate(()=>{window.__test.importResult={text:'{broken'};});
    await page.locator('#import-file').click();
    await page.waitForFunction(()=>document.getElementById('notice').classList.contains('error'));
    const after=await page.evaluate(()=>window.playerAPI.getState());
    assert.ok(after.playlists.some(p=>p.name==='界面测试备份'&&p.queue.length===1));
    assert.deepEqual(errors,[]);
    const output=path.join(__dirname,'build');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'mobile-ui-import.png')});
    console.log(JSON.stringify({ok:true,checks:['restore message','restored playlist navigation','original playback error without unsupported web fallback','quiet cancel','invalid JSON keeps library','no page errors'],nativeFilePickerMocked:true,physicalDeviceUsed:false}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
