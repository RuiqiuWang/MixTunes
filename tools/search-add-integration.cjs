'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium,_electron}=require('../app/node_modules/playwright-core');
const {installSearchFixture,initialLibrary,installNativeFixture}=require('./search-add-fixture.cjs');
const root=path.resolve(__dirname,'..');

async function search(page,mobile){
  if(mobile){await page.locator('[data-screen="search"]').click();await page.locator('#search-query').fill('controlled');await page.locator('#search-submit').click();}
  else{
    if(!await page.locator('#online-search-dialog').evaluate(n=>n.open))await page.locator('#open-online-search').click();
    await page.locator('#online-search-query').fill('controlled');await page.locator('#online-search-submit').click();
  }
  const row=page.locator(`${mobile?'.search-result':'.online-result'}[data-platform="netease"]`).first();await row.waitFor();return row;
}
const addButton=(row,mobile)=>row.locator(mobile?'.result-add':'[data-testid="online-result-add"]');
async function mark(page,mobile,n){
  await page.waitForFunction(({mobile,n})=>{
    const b=document.querySelector(mobile?'.search-result[data-platform="netease"] .result-add':'.online-result[data-platform="netease"] [data-testid="online-result-add"]');
    return b&&b.dataset.added===String(n);
  },{mobile,n});
}
async function target(page,row,mobile){await addButton(row,mobile).click();await page.locator(mobile?'[data-target-add="a"]':'#search-add-playlist').waitFor({state:'visible'});}
async function closeTarget(page,mobile){
  if(mobile)await page.evaluate(()=>window.mobileUI.back());
  else if(await page.locator('#search-add-dialog').evaluate(n=>n.open))await page.locator('#search-add-cancel').click();
}
async function submit(page,mobile,id){
  if(mobile)await page.locator(`[data-target-add="${id}"]`).click();
  else{await page.locator('#search-add-playlist').selectOption(id);await page.locator('#search-add-submit').click();}
}
const snapshot=page=>page.evaluate(()=>window.playerAPI.getState());
async function flow(page,mobile,control){
  await page.evaluate(()=>window.playerAPI.command('seek',{positionMs:17777}));
  const before=await snapshot(page);let row=await search(page,mobile);await mark(page,mobile,0);
  await target(page,row,mobile);await closeTarget(page,mobile);
  assert.equal((await control({})).adds,0,'cancel before confirmation sends no add');await mark(page,mobile,0);
  await target(page,row,mobile);await submit(page,mobile,'a');await mark(page,mobile,1);await closeTarget(page,mobile);
  let state=await snapshot(page);assert.ok(state.playlists.find(p=>p.id==='a').queue.includes('netease:33894312'));
  const fixture=await control({});
  const repeated=await page.evaluate(request=>window.playerAPI.addSearchResult({...request,playlistId:'a'}),fixture.requests.netease);
  assert.equal(repeated.status,'exists');assert.equal(repeated.added,0);
  await control({mode:'error'});await target(page,row,mobile);await submit(page,mobile,'b');
  await page.waitForFunction(mobile=>{
    const b=document.querySelector(mobile?'.search-result[data-platform="netease"] .result-add':'.online-result[data-platform="netease"] [data-testid="online-result-add"]');return b?.dataset.failed==='true';
  },mobile);
  await mark(page,mobile,1);state=await snapshot(page);assert.deepEqual(state.playlists.find(p=>p.id==='b').queue,[]);
  assert.match(await page.locator(mobile?'#sheet':'#search-add-status').textContent(),/Controlled import failure/);
  await control({mode:'added'});await submit(page,mobile,'b');await mark(page,mobile,2);await closeTarget(page,mobile);
  state=await snapshot(page);assert.ok(state.playlists.find(p=>p.id==='b').queue.includes('netease:33894312'));
  await page.evaluate(()=>window.playerAPI.command('playlist-select',{id:'b'}));
  // Desktop originally clears its search session on a browsing-playlist change.
  // Preserve that behavior and derive membership again in the next search.
  if(!mobile){await page.waitForFunction(()=>document.getElementById('active-playlist-name').textContent==='Playlist B');await search(page,false);}
  await mark(page,mobile,2);
  await page.evaluate(()=>window.playerAPI.command('playlist-delete',{id:'b'}));
  if(!mobile){await page.waitForFunction(()=>document.getElementById('active-playlist-name').textContent==='Playlist A');await search(page,false);}
  await mark(page,mobile,1);
  await page.evaluate(()=>window.playerAPI.command('playlist-select',{id:'a'}));
  await page.evaluate(()=>window.playerAPI.command('remove',{key:'netease:33894312'}));await mark(page,mobile,0);
  row=await search(page,mobile);await mark(page,mobile,0);
  await target(page,row,mobile);await submit(page,mobile,'a');await mark(page,mobile,1);await closeTarget(page,mobile);
  // A different canonical source with identical metadata must not gain a false tick.
  await control({mode:'duplicate',ids:{netease:'33894313'}});row=await search(page,mobile);await mark(page,mobile,0);
  await target(page,row,mobile);await submit(page,mobile,'a');
  await page.waitForFunction(mobile=>{
    const b=document.querySelector(mobile?'.search-result[data-platform="netease"] .result-add':'.online-result[data-platform="netease"] [data-testid="online-result-add"]');return b?.dataset.duplicate==='true';
  },mobile);await mark(page,mobile,0);await closeTarget(page,mobile);
  assert.equal((await snapshot(page)).playlists[0].queue.includes('netease:33894313'),false);
  await control({mode:'added',ids:{netease:'33894312'}});await search(page,mobile);await mark(page,mobile,1);
  const after=await snapshot(page);
  for(const key of ['currentKey','status','positionMs','playbackQueue','playbackPlaylistId','mode'])assert.deepEqual(after[key],before[key],key);
}

test('packaged Windows uses real IPC/service/engine/store for feedback and survives restart',
  {skip:process.platform!=='win32',timeout:90000},async t=>{
    const exe=process.env.MIXTUNES_SEARCH_EXECUTABLE;assert.ok(exe&&fs.existsSync(exe),'Set MIXTUNES_SEARCH_EXECUTABLE to this branch EXE');
    const data=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-search-'));fs.writeFileSync(path.join(data,'library.json'),JSON.stringify(initialLibrary()));
    async function launch(){
      const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
      const app=await _electron.launch({executablePath:exe,args:['--test-mode',`--data-dir=${data}`],env,timeout:60000});t.after(()=>app.close().catch(()=>{}));
      const page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='已就绪');
      await app.evaluate(({app},installer)=>{
        const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
        eval('('+installer+')')(req('./src/search-service.cjs').SearchService);
      },installSearchFixture.toString());
      const control=values=>app.evaluate((_,values)=>{
        const f=globalThis.__p03Fixture;if(values.mode)f.mode=values.mode;if(values.ids)Object.assign(f.ids,values.ids);return JSON.parse(JSON.stringify(f));
      },values);
      return {app,page,control};
    }
    const first=await launch();await flow(first.page,false,first.control);await first.app.close();
    const second=await launch();await search(second.page,false);await mark(second.page,false,1);
    assert.equal((await second.control({})).adds,0,'restart derives membership without another add');
  });

test('generated Android runtime uses native storage/real service and derives marks after page reload',
  {timeout:90000},async t=>{
    const browser=await chromium.launch({channel:process.env.MIXTUNES_TEST_BROWSER||'msedge',headless:true});t.after(()=>browser.close());
    const page=await browser.newPage({viewport:{width:390,height:760},isMobile:true,hasTouch:true});t.after(()=>page.close());
    const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://mixtunes.test')return route.abort();
      const name=url.pathname.slice(1)||'index.html';if(!['index.html','styles.css','ui.js','runtime.js'].includes(name))return route.abort();
      return route.fulfill({body:fs.readFileSync(path.join(root,'android/web',name)),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/javascript'});
    });
    const java=fs.readFileSync(path.join(root,'android/native/src/local/mixtunes/mobile/NativeBridge.java'),'utf8');
    const methods=[...java.matchAll(/case "([^"]+)"/g)].map(m=>m[1]);
    await page.addInitScript(installNativeFixture,{library:initialLibrary(),methods});
    async function connect(){
      await page.waitForFunction(()=>window.mobileUI&&window.playerAPI);
      await page.evaluate(installer=>eval('('+installer+')')(window.__mixRequire('./search-service.cjs').SearchService),installSearchFixture.toString());
    }
    await page.goto('http://mixtunes.test/');await connect();
    const control=values=>page.evaluate(values=>{
      const f=window.__p03Fixture;if(values.mode)f.mode=values.mode;if(values.ids)Object.assign(f.ids,values.ids);return JSON.parse(JSON.stringify(f));
    },values);
    await flow(page,true,control);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('p03-library')||'{}').playlists?.some(p=>p.queue.includes('netease:33894312')));
    await page.reload();await connect();await search(page,true);await mark(page,true,1);
    assert.equal((await control({})).adds,0,'reload derives membership from native storage, not prior UI entries');
    assert.ok((await page.evaluate(()=>window.__nativeCalls)).includes('storage-load'));
  });
