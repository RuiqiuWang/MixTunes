'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'src/local/mixtunes/mobile/QqMobileLogin.java'),'utf8');
const desktopScript=JSON.parse(source.match(/static String desktopScript\(\) \{\s*return ("(?:\\.|[^"\\])*");/)[1]);
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
