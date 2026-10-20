'use strict';
const fs=require('node:fs');

// Reuses the existing menu actions; the tray never starts its own playback
// queue, it only drives the running player.
function trayMenuTemplate({onRestore,onToggle,onNext,onQuit}={}){
  return [
    {label:'打开播放器',click:onRestore},
    {label:'播放 / 暂停',click:onToggle},
    {label:'下一首',click:onNext},
    {type:'separator'},
    {label:'退出',click:onQuit}
  ];
}

// Creates at most one tray icon. A missing icon, an empty image or a failing
// Tray constructor must leave the player in normal windowed mode instead of
// hiding a window the user cannot reach again.
function createAppTray({electron,iconPath,template,restore,record=()=>{}}={}){
  let tray=null;
  const available=()=>Boolean(tray)&&!tray.isDestroyed();
  function ensure(){
    if(available())return tray;
    try{
      if(!fs.existsSync(iconPath)){record({type:'tray-unavailable',reason:'icon-missing'});return null;}
      const image=electron.nativeImage.createFromPath(iconPath);
      if(image.isEmpty()){record({type:'tray-unavailable',reason:'icon-empty'});return null;}
      tray=new electron.Tray(image);
      tray.setToolTip('MixTunes');
      tray.setContextMenu(electron.Menu.buildFromTemplate(template()));
      tray.on('double-click',restore);
      return tray;
    }catch(error){
      try{tray?.destroy();}catch{}
      tray=null;
      record({type:'tray-unavailable',reason:'create-failed',message:String(error?.message||error)});
      return null;
    }
  }
  function destroy(){
    try{tray?.destroy();}catch{}
    tray=null;
  }
  return {ensure,available,destroy,get:()=>tray};
}

module.exports={trayMenuTemplate,createAppTray};
