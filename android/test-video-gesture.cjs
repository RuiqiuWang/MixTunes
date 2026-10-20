'use strict';
// Real browser media/activation check; this does not exercise Android WebView.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MIXTUNES_PLAYWRIGHT_MODULE||'../app/node_modules/playwright-core');
const java=fs.readFileSync(path.join(__dirname,'native/src/local/mixtunes/mobile/OfficialWebViews.java'),'utf8');
const expression=java.match(/private String bootstrap\(JSONObject request\) \{\s*return ([\s\S]*?);\s*\}\s*void playVideo/)[1].replaceAll('request.toString()','JSON.stringify(config)');
const source=vm.runInNewContext(expression,{config:{startMs:500,endMs:3000,volume:.2}});
const wav=Buffer.alloc(44+8000*4*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=user-gesture-required'],...(process.env.MIXTUNES_BROWSER?{executablePath:process.env.MIXTUNES_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:260}});
  await page.route('http://mixtunes.test/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><video preload="auto" src="data:audio/wav;base64,'+wav.toString('base64')+'"></video><script>'+source+'</script>'}));
  await page.goto('http://mixtunes.test/');
  // Playwright evaluation can grant user activation. CDP explicitly avoids it,
  // matching a native evaluateJavascript command rather than a real page tap.
  const cdp=await page.context().newCDPSession(page);
  const result=await cdp.send('Runtime.evaluate',{expression:'(async()=>{for(let i=0;i<100&&!window.__mixMobileVideo.snapshot().ready;i++)await new Promise(r=>setTimeout(r,20));window.__mixMobileVideo.play();await new Promise(r=>setTimeout(r,1000));return window.__mixMobileVideo.snapshot();})()',awaitPromise:true,returnByValue:true,userGesture:false});
  const blocked=result.result.value;
  assert.equal(blocked.needsGesture,true,JSON.stringify(blocked));
  assert.equal(blocked.error,'');assert.equal(blocked.paused,true);
  await page.getByRole('button',{name:'点击播放B站视频',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').currentTime>.6);
  const playing=await page.evaluate(()=>window.__mixMobileVideo.snapshot());
  assert.equal(playing.needsGesture,false);assert.equal(playing.error,'');
  await page.evaluate(()=>window.__mixMobileVideo.pause());
  assert.equal(await page.evaluate(()=>document.querySelector('video').paused),true);
  console.log(JSON.stringify({ok:true,checks:['real NotAllowedError','trusted page tap resumes native browser media','clip start applied','pause'],physicalDeviceUsed:false}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
