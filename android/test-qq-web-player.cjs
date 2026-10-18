'use strict';
// Real browser media, with the official QQ API modeled locally. Does not prove
// an actual QQ account can log in or that its licensed songs are available.
const assert=require('node:assert/strict');
const {chromium}=require('../app/node_modules/playwright-core');
const {pageBootstrap}=require('../app/src/web-player.cjs');
const {mobileQqBootstrap}=require('./runtime/qq-player.cjs');
const wav=Buffer.alloc(44+8000*6*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=user-gesture-required'],...(process.env.MIXTUNES_BROWSER?{executablePath:process.env.MIXTUNES_BROWSER}:{})});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://mixtunes.test/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<audio preload="auto" src="data:audio/wav;base64,${wav.toString('base64')}"></audio><script>
      const media=document.querySelector('audio');
      const api={info:{},setPlayerList(auto,list){this.list=list;},getSongInfoObj(){return this.info;},pausePlayer(){media.pause();},playAnyPos(){this.info=this.list[0];media.play();},setVolumn(value){media.volume=value/100;}};
      window.require=()=>({interFace:api});
      (${pageBootstrap.toString()})('bridge');(${mobileQqBootstrap.toString()})(window.bridge);
      window.bridge.configure({track:{platform:'qq',durationMs:6000},expectedId:'target',generation:1,qqSong:{songmid:'target',songid:1},range:{startMs:500,endMs:4500}});
      </script>`}));
    await page.goto('http://mixtunes.test/');
    const cdp=await page.context().newCDPSession(page);
    const initial=await cdp.send('Runtime.evaluate',{expression:'(async()=>{for(let i=0;i<100&&document.querySelector("audio").readyState<1;i++)await new Promise(r=>setTimeout(r,20));await window.bridge.command("play");await new Promise(r=>setTimeout(r,500));return window.bridge.snapshot();})()',awaitPromise:true,returnByValue:true,userGesture:false});
    assert.equal(initial.result.value.needsGesture,true,JSON.stringify(initial.result.value));
    await page.waitForFunction(()=>window.bridge.snapshot().needsGesture);
    let state=await page.evaluate(()=>window.bridge.snapshot());assert.equal(state.paused,true);assert.equal(state.error,'');
    await page.getByRole('button',{name:'点击播放QQ音乐',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('audio').paused&&!window.bridge.needsGesture);
    state=await page.evaluate(()=>window.bridge.snapshot());assert.equal(state.needsGesture,false);assert.equal(state.matches,true);assert.ok(state.positionMs>=500);
    await page.evaluate(()=>window.bridge.command('volume',.23));
    assert.equal(await page.evaluate(()=>document.querySelector('audio').volume),.23);
    await page.evaluate(async()=>{await window.bridge.command('pause');await window.bridge.command('seek',2100);});
    assert.equal(await page.evaluate(()=>window.bridge.snapshot().paused),true);
    assert.ok(Math.abs((await page.evaluate(()=>window.bridge.snapshot().positionMs))-2100)<80);
    await page.evaluate(()=>window.bridge.command('play'));
    await page.waitForFunction(()=>window.bridge.endSent);
    state=await page.evaluate(()=>window.bridge.snapshot());assert.equal(state.events.filter(e=>e.type==='ended').length,1);assert.equal(state.paused,true);
    // A later track cannot inherit the old media identity or gesture affordance.
    await page.evaluate(()=>window.bridge.configure({track:{platform:'qq'},expectedId:'new',generation:2,qqSong:{songmid:'new',songid:2}}));
    assert.equal(await page.evaluate(()=>window.bridge.snapshot().media),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['blocked autoplay requests trusted tap','trusted tap plays browser audio','official song identity','live volume','paused seek','clip end once','new track identity'],qqSiteModeled:true,physicalDeviceUsed:false}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
