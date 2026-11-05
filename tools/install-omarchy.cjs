'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform!=='linux'||process.arch!=='x64')throw Error('This local build requires Linux x64.');
const binary=path.join(root,'app/dist/linux-unpacked/mixtunes');
fs.accessSync(binary,fs.constants.X_OK);
const binDir=path.join(os.homedir(),'.local/bin');
const dataDir=process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share');
const launcher=path.join(binDir,'mixtunes');
const desktop=path.join(dataDir,'applications/mixtunes.desktop');
const icon=path.join(dataDir,'icons/hicolor/256x256/apps/mixtunes.png');
const shellQuote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const desktopQuote=value=>'"'+value.replace(/[\\"`$]/g,'\\$&')+'"';
const marker='Managed by MixTunes tools/install-omarchy.cjs';
for(const target of [launcher,desktop]){
  if(fs.existsSync(target)&&!fs.readFileSync(target,'utf8').includes(marker))throw Error(`Existing user file: ${target}`);
}
for(const dir of [binDir,path.dirname(desktop),path.dirname(icon)])fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(launcher,`#!/bin/sh\n# ${marker}\nexec env -u ELECTRON_RUN_AS_NODE ${shellQuote(binary)} --ozone-platform=wayland --enable-wayland-ime --wayland-text-input-version=3 --close-to-tray "$@"\n`,{mode:0o755});
fs.chmodSync(launcher,0o755);
fs.copyFileSync(path.join(root,'app/ui/icons/app.png'),icon);
fs.writeFileSync(desktop,`[Desktop Entry]\n# ${marker}\nType=Application\nName=MixTunes\nComment=QQ 音乐、网易云音乐与 Bilibili 混合歌单播放器\nExec=${desktopQuote(launcher)}\nIcon=mixtunes\nTerminal=false\nCategories=AudioVideo;Audio;Player;\nKeywords=music;audio;playlist;音乐;歌单;\nStartupWMClass=mixtunes\nStartupNotify=true\n`);
for(const [command,args] of [['update-desktop-database',[path.dirname(desktop)]],['gtk-update-icon-cache',['-f','-t',path.join(dataDir,'icons/hicolor')]]]){
  const result=spawnSync(command,args,{stdio:'pipe'});
  if(result.error?.code!=='ENOENT'&&(result.error||result.status))console.warn(`${command}: ${result.error?.message||result.stderr?.toString()}`);
}
console.log(`Installed ${launcher}\nInstalled ${desktop}`);
