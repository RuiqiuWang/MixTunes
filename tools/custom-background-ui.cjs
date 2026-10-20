'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('../app/node_modules/playwright-core');
test('shared background import/crop/opacity UI on desktop, phone, landscape and tablet', {timeout:90000}, async t => {
  const browser = await chromium.launch({channel:'msedge',headless:true}); t.after(()=>browser.close());
  for (const mobile of [false,true]) await t.test(mobile?'Android touch UI':'Windows mouse UI',async t=>{
    const page=await browser.newPage({viewport:mobile?{width:375,height:812}:{width:1240,height:840},hasTouch:mobile,isMobile:mobile});t.after(()=>page.close());
    let saved=null, choice={canceled:true}, failSave=false, failLoad=false;const calls=[];
    await page.exposeFunction('backgroundCall',async(action,value)=>{
      calls.push(action);
      if(action==='pick')return choice;
      if(action==='load'){if(failLoad)throw Error('损坏的文件');return saved;}
      if(action==='save'){if(failSave)throw Error('磁盘已满');saved=value;return saved;}
      if(action==='delete'){saved=null;return true;}
      throw Error('Unexpected action');
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
    await page.route('http://background.test/**',route=>{
      const name=new URL(route.request().url()).pathname.slice(1);
      if(name==='index.html')return route.fulfill({contentType:'text/html',body:'<html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--text:#202124;--surface:#fff;--border:#ccc;--muted:#565861}body{background:#f7f7f8;font:16px sans-serif;margin:16px}.app{max-width:640px}button,select{font:inherit}html[data-theme=dark]{--text:#eee;--surface:#202123;--muted:#bbb}</style><link rel="stylesheet" href="cover-background.css"></head><body><div id="cover-background" class="cover-background"></div><main class="app"><label><input id="legacy" type="checkbox">旧开关</label><p id="status"></p></main><script src="cover-background.js"></script><script src="background-image.js"></script><script src="background-settings.js"></script></body></html>'});
      return route.fulfill({body:fs.readFileSync(path.join(__dirname,'../app/ui',name)),contentType:name.endsWith('css')?'text/css':'application/javascript'});
    });
    async function start(){await page.goto('http://background.test/index.html');await page.evaluate(()=>{
      window.controller=mixTunesCoverBackground.create({container:document.getElementById('cover-background')});
      window.settings=mixTunesBackgroundSettings.mount({controller,api:{background:backgroundCall},status:document.getElementById('status'),legacy:document.getElementById('legacy')});return settings.ready;
    });}
    await start();
    const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');x.fillStyle='#f02535';x.fillRect(0,0,600,800);x.fillStyle='#2468df';x.fillRect(600,0,600,800);return c.toDataURL('image/jpeg',.95);});
    choice={image:photo};
    await page.locator('#background-pick').click();await page.locator('#background-crop-dialog').waitFor({state:'visible'});
    assert.equal(saved,null,'unconfirmed import must not write');
    await page.locator('#background-zoom').fill('2');await page.locator('#background-zoom').dispatchEvent('input');
    const stage=page.locator('#background-crop-stage'),box=await stage.boundingBox();
    if(mobile){
      const session=await page.context().newCDPSession(page), x=box.x+box.width/2,y=box.y+box.height/2;
      const touches=(gap)=>[{x:x-gap,y,id:1},{x:x+gap,y,id:2}];
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(15)});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(25)});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.ok(Number(await page.locator('#background-zoom').inputValue())>2);
      await page.locator('#background-zoom').fill('2');await page.locator('#background-zoom').dispatchEvent('input');
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+35,y:y+20,id:1}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+20,{steps:4});await page.mouse.up();
    }
    await page.locator('#background-confirm').click();await page.locator('#background-crop-dialog').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.documentElement.classList.contains('has-cover-background'));
    assert.equal(saved.crop.zoom,2);assert.ok(saved.image.startsWith('data:image/jpeg;base64,'));
    const first=structuredClone(saved);
    await page.evaluate(()=>{document.querySelector('#background-crop-stage img').decode=()=>new Promise(resolve=>{window.resolveCropDecode=resolve;});});
    await page.locator('#background-recrop').click();await page.waitForFunction(()=>typeof resolveCropDecode==='function');
    assert.equal(await page.evaluate(()=>settings.back()),true);
    await page.evaluate(()=>{resolveCropDecode();delete document.querySelector('#background-crop-stage img').decode;});
    await page.waitForTimeout(30);assert.equal(await page.locator('#background-crop-dialog').evaluate(node=>node.open),false);assert.deepEqual(saved,first);
    await page.evaluate(()=>{window.originalImage=document.querySelector('#cover-background img');window.loads=0;new MutationObserver(m=>{window.loads+=m.filter(x=>x.type==='childList').length;}).observe(document.getElementById('cover-background'),{childList:true});});
    for(const opacity of [50,0,100]){await page.locator('#background-opacity').fill(String(opacity));await page.locator('#background-opacity').dispatchEvent('input');assert.equal(await page.locator('#background-opacity-value').textContent(),opacity+'%');}
    assert.equal(await page.evaluate(()=>originalImage===document.querySelector('#cover-background img')&&loads===0),true);
    await page.locator('#background-opacity').fill('45');await page.locator('#background-opacity').dispatchEvent('input');
    for(const viewport of [{width:320,height:640},{width:812,height:375},{width:768,height:1024}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(50);
      assert.equal(await page.evaluate(()=>originalImage===document.querySelector('#cover-background img')),true);
      const bounds=await page.locator('#cover-background img').boundingBox();assert.ok(bounds.x<=1&&bounds.y<=1&&bounds.x+bounds.width>=viewport.width-1&&bounds.y+bounds.height>=viewport.height-1);
    }
    await page.locator('#background-recrop').click();await page.locator('#background-reset').click();await page.locator('#background-cancel').click();assert.deepEqual(saved,first);
    choice={canceled:true};await page.locator('#background-pick').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已取消'),null,{timeout:3000}).catch(async error=>{console.log({status:await page.locator('#status').textContent(),errors,calls});throw error;});assert.deepEqual(saved,first);
    choice={image:photo};failSave=true;await page.locator('#background-pick').click();await page.locator('#background-confirm').click();await page.waitForFunction(()=>document.getElementById('background-crop-status').textContent.includes('保存失败'));assert.deepEqual(saved,first);await page.locator('#background-cancel').click();failSave=false;
    await page.locator('#background-mode').selectOption('theme');assert.ok(saved);await start();
    assert.equal(await page.locator('#background-mode').inputValue(),'theme');assert.equal(await page.locator('#background-opacity').inputValue(),'45');
    await page.locator('#background-mode').selectOption('custom');await page.waitForFunction(()=>document.documentElement.classList.contains('has-cover-background'));assert.deepEqual(saved,first);
    await start();await page.waitForFunction(()=>document.documentElement.classList.contains('has-cover-background'));assert.equal(await page.locator('#background-mode').inputValue(),'custom');
    // The stored copy survives even when the picker no longer has an original file.
    choice={canceled:true};await page.locator('#background-recrop').click();
    for(const viewport of [{width:320,height:640},{width:812,height:375}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.documentElement.style.fontSize='28px');await page.waitForTimeout(50);await page.locator('#background-confirm').scrollIntoViewIfNeeded();const b=await page.locator('#background-confirm').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width&&b.y+b.height<=viewport.height);}
    await page.locator('#background-cancel').click();
    // Insert a real EXIF orientation=6 segment into an authored JPEG.
    const jpeg=Buffer.from(photo.split(',')[1],'base64'), exif=Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000','hex');
    const marker=Buffer.alloc(4);marker.writeUInt16BE(0xffe1);marker.writeUInt16BE(exif.length+2,2);
    choice={image:'data:image/jpeg;base64,'+Buffer.concat([jpeg.subarray(0,2),marker,exif,jpeg.subarray(2)]).toString('base64')};
    await page.locator('#background-pick').click();await page.locator('#background-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#cover-background img')?.naturalWidth===800&&document.querySelector('#cover-background img')?.naturalHeight===1200);
    for(const mime of ['image/png','image/webp']){
      choice={image:await page.evaluate(mime=>{const c=document.createElement('canvas');c.width=3000;c.height=1500;c.getContext('2d').fillRect(0,0,3000,1500);return c.toDataURL(mime);},mime)};
      await page.locator('#background-pick').click();await page.locator('#background-confirm').click();
      await page.waitForFunction(()=>document.querySelector('#cover-background img')?.naturalWidth===2560);
      assert.ok(saved.image.length<4*1024*1024*4/3+32);
    }
    const lastSaved=structuredClone(saved);
    await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Quota exceeded','QuotaExceededError');};});
    await page.locator('#background-mode').selectOption('theme');assert.ok((await page.locator('#status').textContent()).includes('仅本次生效'));
    await page.locator('#background-mode').selectOption('custom');assert.ok((await page.locator('#status').textContent()).includes('仅本次生效'));
    await page.evaluate(()=>{Storage.prototype.setItem=originalSetItem;});
    choice={image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,192,0,11,8,0,4,0,4,1,1,17,0,255,217]).toString('base64')};
    await page.locator('#background-pick').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('无法解码'));assert.deepEqual(saved,lastSaved);
    await page.locator('#background-delete').click();assert.equal(saved,null);assert.equal(await page.locator('#background-mode').inputValue(),'theme');
    choice={image:'data:image/svg+xml;base64,PHN2Zy8+'};await page.locator('#background-pick').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('无效'));assert.equal(saved,null);
    await page.evaluate(()=>localStorage.setItem('mixtunes-background-mode','custom'));failLoad=true;await start();assert.equal(await page.locator('#background-mode').inputValue(),'theme');
    assert.deepEqual(errors,[]);assert.ok(calls.includes('save'));
  });
});
