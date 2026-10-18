'use strict';
// Desktop UI contract regression: native playback/network are replaced by a small IPC fixture.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.addInitScript(()=>{
  const tracks=[['netease','1','云端歌曲'],['qq','2','QQ 歌曲'],['bilibili','BV17x411w7KC','B站音乐']].map(([platform,sourceId,title])=>({platform,sourceId,title,key:platform+':'+sourceId,artist:'测试歌手',durationMs:120000,url:platform==='bilibili'?'https://www.bilibili.com/video/'+sourceId:'https://music.163.com/song?id='+sourceId,coverUrl:'https://p1.music.126.net/test.jpg'}));
  const state={tracks,playlists:[{id:'a',name:'我的歌单',queue:tracks.map(t=>t.key),mode:'sequential'}],activePlaylistId:'a',queue:tracks.map(t=>t.key),currentKey:tracks[0].key,currentTrack:tracks[0],status:'playing',durationMs:120000,positionMs:1500,mode:'sequential',volume:.8,muted:false,videoPanel:{open:false,expanded:false}};
  window.fixture={state,calls:[],lyricsCalls:[],emit:null,publish(){this.emit({...state});}};
  window.playerAPI={getState:async()=>state,onState:cb=>fixture.emit=cb,onNotice:()=>{},command:async(name,p={})=>{fixture.calls.push({name,p});
   if(name==='volume'){await new Promise(r=>setTimeout(r,40));state.volume=p.volume;}
   if(name==='video-panel')state.videoPanel=p;
   if(name==='video-open'){state.videoPanel={open:true,expanded:false};state.videoOpen=true;}
   if(name==='remove-many'){state.queue=state.queue.filter(k=>!p.keys.includes(k));state.playlists[0].queue=state.queue;}
   if(name==='seek')state.positionMs=p.positionMs;
   fixture.publish();return {ok:true};
  },getLyrics:async key=>{fixture.lyricsCalls.push(key);await new Promise(r=>setTimeout(r,50));return {key,status:'synced',source:'测试歌词',lines:[{timeMs:0,text:'第一行 '+key},{timeMs:2000,text:'第二行 '+key}]};}};
 });
 await page.route('https://p1.music.126.net/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#7e8d78"/><circle cx="100" cy="100" r="60" fill="#d8e3cd"/></svg>'}));
 await page.goto('file:///'+path.resolve(__dirname,'../ui/index.html').replaceAll('\\','/'));
 await page.waitForSelector('[data-testid="track-row"]');
 assert.equal(await page.locator('#cycle-mode').count(),0);
 assert.equal(await page.locator('.playing-indicator.animated').count(),1);
 assert.equal(await page.locator('#play-mode option').count(),4);
 await page.locator('#search-input').fill('云端');
 await page.locator('#batch-select').click();await page.locator('#select-visible').check();
 assert.match(await page.locator('#selected-count').textContent(),/1/);
 await page.locator('#search-input').fill('');
 assert.equal(await page.locator('.track-index input:checked').count(),1);
 page.once('dialog',d=>d.accept());await page.locator('#delete-selected').click();
 await page.waitForFunction(()=>fixture.state.queue.length===2);
 assert.equal(await page.locator('[data-testid="track-row"]').count(),2);
 // Volume must reach the native bridge before a change/release event, and keep the last rapid input.
 await page.locator('#volume').evaluate(el=>{for(const v of [.1,.25,.37]){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}});
 await page.waitForFunction(()=>fixture.state.volume===.37);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='volume').at(-1).p.volume),.37);
 await page.locator('#batch-select').click();
 await page.locator('#toggle-video-panel').click();
 await page.waitForSelector('#panel-lyrics .lyric-line');
 assert.equal(await page.locator('#panel-lyrics .lyric-line.active').count(),1);
 await page.evaluate(()=>{fixture.state.positionMs=2500;fixture.publish();});
 await page.waitForFunction(()=>document.querySelector('#panel-lyrics .lyric-line.active')?.textContent.includes('第二行'));
 await page.locator('#panel-lyrics .lyric-line').first().click();
 await page.waitForFunction(()=>fixture.calls.some(c=>c.name==='seek'&&c.p.positionMs===0));
 await page.locator('#expand-video-panel').click();
 await page.waitForSelector('.app.video-panel-expanded');
 await page.screenshot({path:path.resolve(__dirname,'../dist/windows-expanded-lyrics.png')});
 await page.locator('#current-cover').click();
 await page.waitForSelector('#lyrics-dialog[open] .lyrics-body');
 await page.locator('#close-lyrics').click();
 await page.waitForSelector('#panel-lyrics .lyrics-body');
 await page.locator('#shrink-video-panel').click();
 await page.evaluate(()=>{fixture.state.currentKey=fixture.state.tracks[1].key;fixture.state.currentTrack=fixture.state.tracks[1];fixture.publish();});
 await page.waitForFunction(()=>document.querySelector('#panel-lyrics .lyric-line')?.textContent.includes('qq:2'));
 await page.evaluate(()=>{fixture.state.currentKey=fixture.state.tracks[2].key;fixture.state.currentTrack=fixture.state.tracks[2];fixture.state.videoOpen=true;fixture.publish();});
 assert.equal(await page.locator('#video-surface').isVisible(),true);
 assert.equal(await page.locator('#panel-lyrics').isVisible(),false);
 await page.evaluate(()=>{fixture.state.currentKey=fixture.state.tracks[1].key;fixture.state.currentTrack=fixture.state.tracks[1];fixture.state.videoOpen=false;fixture.publish();});
 await page.waitForSelector('#panel-lyrics .lyric-line');
 await page.locator('#close-video-panel').click();await page.locator('#toggle-video-panel').click();
 await page.waitForSelector('#panel-lyrics .lyric-line');
 await page.screenshot({path:path.resolve(__dirname,'../dist/windows-sidebar-review.png')});
 // Guard against a hidden panel dropping the only pending lyric response.
 await page.evaluate(()=>{fixture.state.currentKey=fixture.state.tracks[0].key;fixture.state.currentTrack=fixture.state.tracks[0];fixture.publish();});
 await page.locator('#close-video-panel').click();await page.waitForTimeout(80);await page.locator('#toggle-video-panel').click();
 await page.waitForFunction(()=>document.querySelector('#panel-lyrics .lyric-line')?.textContent.includes('netease:1'));
 assert.deepEqual(errors,[]);console.log('PASS Windows UI: batch filtered selection/removal, live final volume, mode dropdown, animation, synchronized lyrics, platform/panel/dialog transitions.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
