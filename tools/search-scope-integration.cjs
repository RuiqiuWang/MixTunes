'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium,_electron}=require('../app/node_modules/playwright-core');
const {installSearchFixture,initialLibrary,installNativeFixture}=require('./search-add-fixture.cjs');
const root=path.resolve(__dirname,'..');
function library(){
  const data=initialLibrary(),outside={key:'netease:901',platform:'netease',sourceId:'901',url:'https://music.163.com/song?id=901',title:'OutsideOnly',artist:'Other'};
  data.tracks.push(outside);data.playlists[1].queue=[outside.key];return data;
}
function instrument(SearchService,installer){
  installer(SearchService);globalThis.__p03Fixture.ids.netease='900';globalThis.__p06Requests=[];
  const previous=SearchService.prototype.search;
  SearchService.prototype.search=function(payload){globalThis.__p06Requests.push({...payload});return previous.call(this,payload);};
}
async function flow(page,mobile,requests){
  const local=page.locator(mobile?'#library-filter':'#search-input'),rows=page.locator(mobile?'.song-row':'#track-list tr');
  const results=page.locator(mobile?'.search-result':'.online-result');
  const state=()=>page.evaluate(()=>window.playerAPI.getState());
  await page.evaluate(()=>window.playerAPI.command('seek',{positionMs:17777}));const before=await state();
  await local.fill('OutsideOnly');assert.equal(await rows.count(),0);assert.deepEqual(await requests(),[]);
  await local.fill('');assert.equal(await rows.count(),1);assert.deepEqual(await requests(),[]);
  await local.fill('OutsideOnly');
  async function open(){
    if(mobile)await page.locator('[data-screen="search"]').click();
    else if(!await page.locator('#online-search-dialog').evaluate(n=>n.open))await page.locator('#open-online-search').click();
  }
  async function search(){
    await page.locator(mobile?'#search-query':'#online-search-query').fill(' ScopedQuery ');
    await page.locator(mobile?'#search-submit':'#online-search-submit').click();
    await page.locator(mobile?'.search-result[data-platform="netease"]':'.online-result[data-platform="netease"]').waitFor();
    await page.waitForFunction(mobile=>document.querySelector(mobile?'.search-result[data-platform="netease"] .result-add':'.online-result[data-platform="netease"] [data-testid="online-result-add"]')?.dataset.added==='1',mobile);
  }
  await open();assert.deepEqual(await requests(),[]);
  await page.locator(mobile?'[data-search-platform="netease"]':'[data-online-filter="netease"]').click();await search();
  assert.deepEqual((await requests()).sort((a,b)=>a.platform.localeCompare(b.platform)),['bilibili','netease','qq'].map(platform=>({query:'ScopedQuery',platform,page:1})));
  assert.equal(await results.count(),mobile?1:3);
  await page.locator(mobile?'[data-search-platform="all"]':'[data-online-filter="all"]').click();assert.equal(await results.count(),3);
  assert.equal((await requests()).length,3);
  await page.locator(mobile?'[data-screen="library"]':'#close-online-search').click();
  assert.equal(await local.inputValue(),'OutsideOnly');assert.equal(await rows.count(),0);
  await local.fill('');assert.equal(await rows.count(),1);
  for(const key of ['currentKey','status','positionMs','playbackQueue','playbackPlaylistId','tracks','playlists'])assert.deepEqual((await state())[key],before[key],key);
  await open();await page.evaluate(()=>window.playerAPI.command('playlist-select',{id:'b'}));
  if(mobile)assert.equal(await results.count(),3);
  else{assert.equal(await results.count(),0);assert.match(await page.locator('#online-search-message').textContent(),/歌单已切换.*重新搜索/);}
  await search();
  await page.locator(mobile?'[data-screen="library"]':'#close-online-search').click();
  assert.equal(await local.inputValue(),'');assert.equal(await rows.count(),1);assert.match(await rows.textContent(),/OutsideOnly/);
  const after=await state();assert.equal(after.activePlaylistId,'b');
  for(const key of ['currentKey','status','positionMs','playbackQueue','playbackPlaylistId','tracks','playlists'])assert.deepEqual(after[key],before[key],key);
}
test('packaged Windows scope labels preserve real search payloads, engine/store and P03 membership',{timeout:90000,skip:process.platform!=='win32'},async t=>{
  const exe=process.env.MIXTUNES_SCOPE_EXECUTABLE;assert.ok(exe&&fs.existsSync(exe),'Set MIXTUNES_SCOPE_EXECUTABLE to this branch EXE');
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-scope-'));fs.writeFileSync(path.join(data,'library.json'),JSON.stringify(library()));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:exe,args:['--test-mode','--data-dir='+data],env});t.after(()=>app.close().catch(()=>{}));
  const page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='已就绪');
  await app.evaluate(({app},{setup,installer})=>{
    const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
    eval('('+setup+')')(req('./src/search-service.cjs').SearchService,eval('('+installer+')'));
  },{setup:instrument.toString(),installer:installSearchFixture.toString()});
  await flow(page,false,()=>app.evaluate(()=>globalThis.__p06Requests));
  assert.equal(await app.evaluate(()=>globalThis.__p03Fixture.adds),0);
});
test('generated Android runtime keeps local scope separate and derives P03 marks from real engine data',{timeout:90000},async t=>{
  const browser=await chromium.launch({channel:process.env.MIXTUNES_TEST_BROWSER||'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:760},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());if(u.origin!=='http://mixtunes.test')return route.abort();
    const f=u.pathname.slice(1)||'index.html';if(!['index.html','styles.css','ui.js','runtime.js'].includes(f))return route.abort();
    return route.fulfill({body:fs.readFileSync(path.join(root,'android/web',f)),contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'application/javascript'});
  });
  const java=fs.readFileSync(path.join(root,'android/native/src/local/mixtunes/mobile/NativeBridge.java'),'utf8');
  await page.addInitScript(installNativeFixture,{library:library(),methods:[...java.matchAll(/case "([^"]+)"/g)].map(m=>m[1])});
  await page.goto('http://mixtunes.test/');await page.waitForFunction(()=>window.mobileUI&&window.playerAPI);
  await page.evaluate(({setup,installer})=>eval('('+setup+')')(window.__mixRequire('./search-service.cjs').SearchService,eval('('+installer+')')),{setup:instrument.toString(),installer:installSearchFixture.toString()});
  await flow(page,true,()=>page.evaluate(()=>window.__p06Requests));
  assert.equal(await page.evaluate(()=>window.__p03Fixture.adds),0);
});
