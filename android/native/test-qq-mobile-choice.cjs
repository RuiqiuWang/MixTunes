'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'src/local/mixtunes/mobile/QqMobileLogin.java'),'utf8');
const script=JSON.parse(source.match(/static String choiceScript\(\) \{\s*return ("(?:\\.|[^"\\])*");/)[1]);
const desktopScript=JSON.parse(source.match(/static String desktopScript\(\) \{\s*return ("(?:\\.|[^"\\])*");/)[1]);
function context(url,loaded=true){const location=new URL(url);const calls=[];const window={Music:loaded?{userLogin:options=>calls.push(options)}:{}};return {context:vm.createContext({location,window,URLSearchParams}),calls,window};}
test('QQ more-login opens the official component once and retains its own QQ/WeChat selection',()=>{const c=context('https://i2.y.qq.com/n3/other/pages/myqq/index.html?outsideLogin=1');assert.equal(vm.runInContext(script,c.context),true);assert.equal(c.calls.length,1);assert.equal(c.calls[0].noConfirm,true);assert.equal(vm.runInContext(script,c.context),true);assert.equal(c.calls.length,1);});
test('choice script does not execute on lookalike, callback, other platform, or ordinary homepage',()=>{for(const url of ['https://i2.y.qq.com.evil.test/n3/other/pages/myqq/index.html?outsideLogin=1','https://y.qq.com/m/login/redirect.html','https://music.163.com/m/login/','https://passport.bilibili.com/h5-app/passport/login','https://i2.y.qq.com/n3/other/pages/myqq/index.html']){const c=context(url);assert.equal(vm.runInContext(script,c.context),false);assert.equal(c.calls.length,0);}});
test('missing official component returns failure so native can retry or report unavailable',()=>{const c=context('https://i2.y.qq.com/n3/other/pages/myqq/index.html?outsideLogin=1',false);assert.equal(vm.runInContext(script,c.context),false);assert.equal(c.window.__mixQqChoiceOpened,undefined);});

test('desktop entry opens the sites own login component once without constructing authorization parameters',()=>{
  for(const route of ['/n/ryqq/profile','/n/ryqq_v2/profile']){
  let clicks=0;const window={},context=vm.createContext({window,location:new URL('https://y.qq.com'+route),document:{querySelector:selector=>{assert.equal(selector,'.profile_unlogin__btn');return{click(){clicks++;}};}}});
  assert.equal(vm.runInContext(desktopScript,context),true);assert.equal(vm.runInContext(desktopScript,context),true);assert.equal(clicks,1);
  }
});

test('desktop login script retries missing controls and ignores unrelated origins and pages',()=>{
  for(const url of ['https://y.qq.com.evil.test/n/ryqq/profile','https://y.qq.com/n/ryqq/','https://music.163.com/m/login/','http://y.qq.com/n/ryqq/profile']){
    const context=vm.createContext({window:{},location:new URL(url),document:{querySelector(){throw new Error('must not touch another page');}}});assert.equal(vm.runInContext(desktopScript,context),false);
  }
  const context=vm.createContext({window:{},location:new URL('https://y.qq.com/n/ryqq/profile'),document:{querySelector:()=>null}});assert.equal(vm.runInContext(desktopScript,context),false);
});
test('non-QQ native entries and session behavior are retained',()=>{const java=fs.readFileSync(path.join(__dirname,'src/local/mixtunes/mobile/OfficialWebViews.java'),'utf8');assert.ok(java.includes('platform.equals("netease") ? "https://music.163.com/m/login/" : "https://passport.bilibili.com/h5-app/passport/login"'));assert.ok(java.includes('if (platform.equals("netease")) return NativeNetwork.suffix(host, "163.com") || NativeNetwork.suffix(host, "126.net") || NativeNetwork.suffix(host, "qq.com") || NativeNetwork.suffix(host, "weibo.com")'));assert.ok(java.includes('CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)'));assert.ok(java.includes('if (!platform.equals("qq") || login != view) return;'));});
