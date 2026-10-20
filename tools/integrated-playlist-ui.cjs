'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../app/node_modules/playwright-core');
const root=path.resolve(__dirname,'..');
test('integrated drag, volume, sidebar and mobile controls',async t=>{
  const browser=await chromium.launch({channel:process.env.MIXTUNES_TEST_BROWSER||'msedge',headless:true});t.after(()=>browser.close());
  async function fixture(mobile){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1240,height:840},hasTouch:mobile,isMobile:mobile});t.after(()=>page.close());
    const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));await page.route(/^https?:/,r=>r.abort());
    if(mobile)await page.route('http://integrated.test/**',route=>{
      const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
      const body=name==='runtime.js'?['search-match.js','sleep-timer.js','locate-playing.js','cover-background.js','background-image.js','background-settings.js'].map(file=>fs.readFileSync(path.join(root,'app/ui',file),'utf8')).join('\n'):fs.readFileSync(path.join(root,'android/web',name));
      return route.fulfill({body,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/javascript'});
    });
    await page.addInitScript(()=>{
      const tracks=[1,2,3].map(id=>({key:'netease:'+id,platform:'netease',sourceId:String(id),url:'https://music.163.com/song?id='+id,title:'测试歌曲 '+id,artist:'测试作者',durationMs:180000}));
      const keys=tracks.map(x=>x.key);window.calls=[];window.fixture={tracks,playlists:[{id:'source',name:'我的歌单',queue:[...keys]},{id:'other',name:'另一个歌单',queue:[...keys]}],activePlaylistId:'source',queue:[...keys],currentKey:keys[0],currentTrack:tracks[0],playbackPlaylistId:'source',playbackQueue:[...keys],status:'playing',generation:3,positionMs:40000,durationMs:180000,volume:.7,muted:false,videoPanel:{open:false,expanded:false}};
      let stateListener=()=>{};window.pushState=patch=>{Object.assign(window.fixture,patch);stateListener(structuredClone(window.fixture));};
      window.playerAPI={getState:async()=>structuredClone(fixture),onState:fn=>stateListener=fn,onNotice:()=>{},
        command:async(name,payload={})=>{calls.push({name,payload});
          if(name==='reorder'){fixture.queue=[...payload.keys];fixture.playlists.find(p=>p.id===payload.playlistId).queue=[...payload.keys];}
          if(name==='playlist-select'){fixture.activePlaylistId=payload.id;fixture.queue=[...fixture.playlists.find(p=>p.id===payload.id).queue];}
          if(name==='volume'){fixture.volume=payload.volume;}
          if(name==='video-panel')fixture.videoPanel=payload;
          window.pushState({});return{ok:true};},
        getLyrics:async key=>({ok:true,key,status:'synced',source:'网易云',lines:[{timeMs:0,text:'第一行歌词'},{timeMs:30000,text:'当前这行歌词'},{timeMs:60000,text:'下一行歌词'}]}),
        sleepTimer:async()=>({ok:true,active:false}),recoverLibrary:async()=>{calls.push({name:'recover'});return{ok:true,canceled:true};},
      };
    });
    await page.goto(mobile?'http://integrated.test/':pathToFileURL(path.join(root,'app/ui/index.html')).href);
    await page.waitForFunction(mobile?()=>!!window.mobileUI:()=>document.querySelector('#connection-status').textContent==='已就绪');return page;
  }
  await t.test('drop indicators agree with before/after insertion and stale playlist drags are rejected',async()=>{
    const page=await fixture(false);
    async function drag(source,target,after){await page.evaluate(({source,target,after})=>{
      const from=document.querySelector(`tr[data-key="${source}"]`),to=document.querySelector(`tr[data-key="${target}"]`),dataTransfer=new DataTransfer(),rect=to.getBoundingClientRect(),clientY=rect.top+rect.height*(after?.8:.2);
      from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientY}));
      if(to.classList.contains('drop-after')!==after)throw Error('Wrong insertion marker');
      to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY}));from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
    },{source,target,after});}
    await drag('netease:1','netease:2',false);assert.deepEqual(await page.evaluate(()=>fixture.queue),['netease:1','netease:2','netease:3']);
    await drag('netease:1','netease:2',true);assert.deepEqual(await page.evaluate(()=>fixture.queue),['netease:2','netease:1','netease:3']);
    await drag('netease:3','netease:2',false);assert.deepEqual(await page.evaluate(()=>fixture.queue),['netease:3','netease:2','netease:1']);
    const before=await page.evaluate(()=>calls.filter(c=>c.name==='reorder').length);
    await page.evaluate(()=>{document.querySelector('tr[data-key="netease:1"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));window.pushState({activePlaylistId:'other',queue:fixture.playlists[1].queue});document.querySelector('tr[data-key="netease:2"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));});
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='reorder').length),before);
  });
  for(const mobile of [false,true])await t.test((mobile?'Android':'Windows')+' volume keeps the dragged value until release despite intervening snapshots',async()=>{
    const page=await fixture(mobile);
    await page.locator('#volume').evaluate(node=>{node.value='.23';node.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>calls.some(c=>c.name==='volume'));
    await page.evaluate(()=>window.pushState({volume:.7,positionMs:41000}));assert.equal(Number(await page.locator('#volume').inputValue()),.23);
    await page.locator('#volume').evaluate(node=>{node.value='.45';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(()=>calls.filter(c=>c.name==='volume').some(c=>c.payload.save&&c.payload.volume===.45));assert.equal(Number(await page.locator('#volume').inputValue()),.45);
  });
  await t.test('desktop lyric sidebar follows current content; locate shortcut ignores text input',async()=>{
    const page=await fixture(false);await page.locator('#search-input').fill('l');await page.locator('#search-input').press('l');assert.equal(await page.locator('.located').count(),0);
    await page.locator('#search-input').fill('');await page.locator('body').click({position:{x:500,y:80}});await page.keyboard.press('l');await page.locator('tr.located').waitFor();
    await page.locator('#toggle-video-panel').click();await page.locator('#panel-lyrics .lyric-line').first().waitFor();assert.match(await page.locator('#panel-lyrics').textContent(),/当前这行歌词/);
    assert.equal(await page.evaluate(()=>fixture.positionMs),40000);
    const folder=process.env.MIXTUNES_REVIEW_ARTIFACTS;if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,'desktop-integrated.png')});}
  });
  await t.test('mobile search retains compact transport and read-only library offers explicit recovery',async()=>{
    const page=await fixture(true);await page.locator('[data-screen="search"]').click();assert.equal(await page.locator('#player').isVisible(),true);assert.equal(await page.locator('#player').evaluate(node=>node.classList.contains('compact')),true);assert.equal(await page.locator('#play-pause').isVisible(),true);
    await page.evaluate(()=>window.pushState({libraryRecovery:{locked:true,canRestore:true}}));assert.equal(await page.locator('#library-recovery').isVisible(),true);await page.locator('#library-recovery button').click();assert.ok(await page.evaluate(()=>calls.some(c=>c.name==='recover')));
    const folder=process.env.MIXTUNES_REVIEW_ARTIFACTS;if(folder)await page.screenshot({path:path.join(folder,'mobile-integrated.png')});
  });
});
