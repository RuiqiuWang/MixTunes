'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {trayMenuTemplate,createAppTray}=require('../src/tray.cjs');

const iconPath=path.join(__dirname,'..','ui','tray.png');

class FakeTray extends EventEmitter{
  static count=0;
  constructor(image){super();FakeTray.count++;this.image=image;this.destroyed=false;this.balloons=[];this.menu=null;}
  isDestroyed(){return this.destroyed;}
  setToolTip(value){this.tooltip=value;}
  setContextMenu(menu){this.menu=menu;}
  displayBalloon(options){this.balloons.push(options);}
  destroy(){this.destroyed=true;}
}

function fakeElectron({empty=false,fail=false}={}){
  const image={isEmpty:()=>empty};
  return {
    nativeImage:{createFromPath:()=>image},
    Menu:{buildFromTemplate:template=>template},
    Tray:class extends FakeTray{constructor(img){if(fail)throw new Error('托盘创建失败');super(img);}}
  };
}

function make(options={}){
  const records=[];
  const controller=createAppTray({electron:fakeElectron(options),iconPath,template:()=>trayMenuTemplate({}),restore:options.restore||(()=>{}),record:value=>records.push(value)});
  return {controller,records};
}

test('the tray menu keeps the existing four actions',()=>{
  const calls=[];
  const template=trayMenuTemplate({onRestore:()=>calls.push('restore'),onToggle:()=>calls.push('toggle'),onNext:()=>calls.push('next'),onQuit:()=>calls.push('quit')});
  assert.deepEqual(template.map(item=>item.label||item.type),['打开播放器','播放 / 暂停','下一首','separator','退出']);
  for(const item of template)item.click?.();
  assert.deepEqual(calls,['restore','toggle','next','quit']);
});

test('ensure reuses the single tray icon and never creates a second one',()=>{
  FakeTray.count=0;
  const {controller}=make();
  const first=controller.ensure();
  assert.ok(first);
  assert.equal(controller.available(),true);
  assert.equal(controller.ensure(),first);
  controller.ensure();
  assert.equal(FakeTray.count,1);
  assert.equal(controller.get(),first);
});

test('double-click restores the existing window',()=>{
  FakeTray.count=0;
  let restored=0;
  const {controller}=make({restore:()=>{restored++;}});
  controller.ensure().emit('double-click');
  assert.equal(restored,1);
});

test('a missing icon falls back instead of hiding the window',()=>{
  FakeTray.count=0;
  const records=[];
  const controller=createAppTray({electron:fakeElectron(),iconPath:path.join(__dirname,'missing-tray.png'),template:()=>[],record:value=>records.push(value)});
  assert.equal(controller.ensure(),null);
  assert.equal(controller.available(),false);
  assert.equal(FakeTray.count,0);
  assert.deepEqual(records,[{type:'tray-unavailable',reason:'icon-missing'}]);
});

test('an empty icon image is treated as unavailable',()=>{
  FakeTray.count=0;
  const {controller,records}=make({empty:true});
  assert.equal(controller.ensure(),null);
  assert.equal(controller.available(),false);
  assert.equal(FakeTray.count,0);
  assert.deepEqual(records,[{type:'tray-unavailable',reason:'icon-empty'}]);
});

test('a Tray constructor failure is recorded and keeps normal windowed mode',()=>{
  FakeTray.count=0;
  const {controller,records}=make({fail:true});
  assert.equal(controller.ensure(),null);
  assert.equal(controller.available(),false);
  assert.equal(records.length,1);
  assert.equal(records[0].type,'tray-unavailable');
  assert.equal(records[0].reason,'create-failed');
  assert.match(records[0].message,/托盘创建失败/);
});

test('destroy clears the icon so a real quit leaves no tray behind',()=>{
  FakeTray.count=0;
  const {controller}=make();
  const tray=controller.ensure();
  controller.destroy();
  assert.equal(tray.isDestroyed(),true);
  assert.equal(controller.available(),false);
  assert.equal(controller.get(),null);
});
