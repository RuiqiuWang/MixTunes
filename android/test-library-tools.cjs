'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {chromium}=require('../app/node_modules/playwright-core');
const tracks=[1,2,3].map(id=>({key:'netease:'+id,platform:'netease',sourceId:String(id),url:'https://music.163.com/song?id='+id,title:id===3?'保留歌曲':'筛选歌曲'+id,artist:'测试作者',durationMs:90000}));
const qq={key:'qq:mid',platform:'qq',sourceId:'mid',url:'https://y.qq.com/n/ryqq/songDetail/mid',title:'QQ 网页歌曲',extra:{qqRawSong:{mid:'mid',id:10,name:'QQ 网页歌曲'}}};
const library={schemaVersion:2,tracks:[...tracks,qq],playlists:[{id:'source',name:'来源歌单',queue:tracks.map(t=>t.key),mode:'sequential'},{id:'target',name:'目标歌单',queue:[tracks[0].key,qq.key],mode:'sequential'}],activePlaylistId:'source'};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.MIXTUNES_BROWSER?{executablePath:process.env.MIXTUNES_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(({library})=>{
   window.__test={calls:[],saves:[],token:0};
   window.MixTunesBridge={crypto(text){const p=JSON.parse(text);return JSON.stringify({ok:true,value:crypto.randomUUID()});},postMessage(text){
    const p=JSON.parse(text),d=p.payload;window.__test.calls.push(p);let value=true,error=null;
    if(p.method==='storage-load')value={json:JSON.stringify(library)};
    else if(p.method==='storage-save')window.__test.saves.push(JSON.parse(d.json));
    else if(p.method==='cookies')value=[];
    else if(p.method==='fetch')error='测试不连接平台';
    queueMicrotask(()=>window.__mixNativeReply({id:p.id,ok:!error,value,error}));
   }};
  },{library});
  await page.goto(pathToFileURL(path.join(__dirname,'web/index.html')).href);
  await page.waitForFunction(()=>!!window.playerAPI);await page.waitForFunction(()=>document.querySelectorAll('.song-row').length===3);
  // A single batch entry supports either action, and only the selected subset
  // is copied. Canceling confirmation keeps the selection for another action.
  assert.equal(await page.locator('#copy-playlist').count(),0);
  assert.equal(await page.locator('#copy-selected').isVisible(),false);
  await page.locator('#batch-manage').click();
  assert.equal(await page.locator('#copy-selected').isDisabled(),true);assert.equal(await page.locator('#remove-selected').isDisabled(),true);
  await page.locator('#library-filter').fill('筛选歌曲');await page.locator('#select-visible').check();
  assert.equal(await page.locator('#selected-count').innerText(),'已选2首');
  await page.setViewportSize({width:320,height:700});
  assert.equal(await page.locator('.batch-actions').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  fs.mkdirSync(path.join(__dirname,'build'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'build/mobile-batch-selection.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#copy-selected').click();
  assert.equal(await page.locator('[data-copy-target="source"]').count(),0);
  await page.locator('[data-copy-target="target"]').click();
  assert.match(await page.locator('#sheet-body').innerText(),/选中的 2 首/);
  await page.locator('#cancel-copy').click();await page.locator('#close-sheet').click();
  assert.equal(await page.locator('#selected-count').innerText(),'已选2首');
  assert.equal((await page.evaluate(()=>window.playerAPI.getState())).playlists.find(p=>p.id==='target').queue.length,2);
  await page.locator('#copy-selected').click();await page.locator('[data-copy-target="target"]').click();
  await page.screenshot({path:path.join(__dirname,'build/mobile-batch-copy.png')});
  await page.locator('#confirm-copy').click();await page.waitForFunction(()=>document.getElementById('sheet-layer').hidden);
  let state=await page.evaluate(()=>window.playerAPI.getState());
  assert.deepEqual(state.playlists.find(p=>p.id==='source').queue,tracks.map(t=>t.key));
  assert.deepEqual(state.playlists.find(p=>p.id==='target').queue,['netease:2','netease:1',qq.key]);
  assert.equal(await page.locator('#selected-count').innerText(),'已选0首');assert.equal(await page.locator('#copy-selected').isDisabled(),true);
  // Select only visible matches; remove from source while target remains intact.
  await page.locator('#select-visible').check();
  assert.equal(await page.locator('#selected-count').innerText(),'已选2首');
  await page.locator('#remove-selected').click();await page.locator('#confirm-batch-delete').click();
  await page.waitForFunction(()=>document.getElementById('sheet-layer').hidden);
  state=await page.evaluate(()=>window.playerAPI.getState());
  assert.deepEqual(state.playlists.find(p=>p.id==='source').queue,['netease:3']);assert.equal(state.playlists.find(p=>p.id==='target').queue.length,3);
  await page.locator('#library-filter').fill('');await page.locator('#batch-manage').click();
  await page.locator('#batch-manage').click();await page.getByRole('checkbox',{name:'选择 保留歌曲',exact:true}).check();
  // Native event is authoritative for playback animation; the chosen QQ route
  // never asks for a direct audio URL, even when network calls are unavailable.
  await page.evaluate(()=>window.playerAPI.command('playlist-select',{id:'target'}));
  assert.equal(await page.locator('#batch-actions').isVisible(),false);assert.equal(await page.locator('#selected-count').innerText(),'已选0首');
  await page.evaluate(()=>{window.__test.calls=[];});
  const playing=await page.evaluate(async key=>{
   await window.playerAPI.command('play',{key});const s=await window.playerAPI.getState();
   window.__mixNativeEvent({type:'web',event:{type:'playing',key,generation:s.generation,positionMs:1000,durationMs:90000}});return s;
  },qq.key);
  await page.waitForFunction(()=>!!document.querySelector('.playing-bars.animated'));
  const methods=await page.evaluate(()=>window.__test.calls.map(c=>c.method));assert.ok(methods.includes('web-load'));assert.ok(!methods.includes('audio-load'));assert.ok(!methods.includes('fetch'));
  const payload=await page.evaluate(()=>window.__test.calls.find(c=>c.method==='web-load').payload);assert.equal(payload.qqSong.songid,10);assert.equal(payload.expectedId,'mid');
  const height=await page.locator('#main-content').evaluate(e=>e.clientHeight);
  for(const name of ['settings','search']){
   await page.locator('[data-screen="'+name+'"]').click();assert.equal(await page.locator('#player').isVisible(),false);
   assert.ok((await page.locator('#main-content').evaluate(e=>e.clientHeight))>height+100);
   assert.equal((await page.evaluate(()=>window.playerAPI.getState())).status,'playing');
  }
  await page.locator('[data-screen="library"]').click();assert.equal(await page.locator('#player').isVisible(),true);
  await page.evaluate(()=>{window.__test.calls=[];window.__test.saves=[];const s=document.getElementById('volume');s.value='.18';s.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(()=>window.__test.calls.some(c=>c.method==='web-volume'&&c.payload.volume===.18));
  assert.equal(await page.evaluate(()=>window.__test.saves.length),0);
  await page.evaluate(()=>{const s=document.getElementById('volume');for(const v of [.4,.6,.82]){s.value=v;s.dispatchEvent(new Event('input',{bubbles:true}));}s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>window.__test.saves.some(s=>s.volume===.82));assert.equal((await page.evaluate(()=>window.playerAPI.getState())).volume,.82);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.playing-bars i').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.evaluate(()=>window.playerAPI.command('pause'));await page.waitForFunction(()=>!document.querySelector('.playing-bars.animated'));
  assert.deepEqual(errors,[]);fs.mkdirSync(path.join(__dirname,'build'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'build/mobile-library-tools.png')});
  console.log(JSON.stringify({ok:true,checks:['one batch entry with two actions','empty selection disables actions','only selected songs copied with deduplication','cancel preserves selection','copy completion clears selection','320px batch layout','filtered batch remove isolation','single QQ web route and song payload','native playing animation','player hidden with layout space reclaimed','live volume before release and final persistence','paused marker'],nativeBridgeMocked:true,physicalDeviceUsed:false}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
