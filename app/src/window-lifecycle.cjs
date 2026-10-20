'use strict';

// Closing the Windows player means "hide to the tray and keep playing" while a
// tray exists. Without a tray, or during a real quit, the close must proceed so
// the app can never be left running without a way to reach it.
function closeAction({trayAvailable=false,quitting=false}={}){
  if(quitting)return 'close';
  return trayAvailable?'hide':'close';
}

// Used by the tray menu, tray double-click and the single-instance wake-up.
// Restoring never creates a window: it only reveals the existing instance.
function restoreMainWindow(win){
  if(!win||typeof win.isDestroyed!=='function'||win.isDestroyed())return false;
  if(typeof win.isMinimized==='function'&&win.isMinimized())win.restore();
  win.show();
  win.focus();
  return true;
}

const installed=new WeakSet();

// Wires close/closed once per window. `trayAvailable` and `isQuitting` are
// read at event time so the handlers follow the live tray and quit state.
function installMainWindowLifecycle(win,{trayAvailable,isQuitting,onQuit,onFirstHide}={}){
  if(!win||installed.has(win))return false;
  installed.add(win);
  let noticeShown=false;
  win.on('close',event=>{
    const action=closeAction({trayAvailable:Boolean(trayAvailable?.()),quitting:Boolean(isQuitting?.())});
    if(action!=='hide')return;
    event.preventDefault();
    win.hide();
    if(noticeShown)return;
    noticeShown=true;
    try{onFirstHide?.();}catch{}
  });
  win.on('closed',()=>{
    if(isQuitting?.())return;
    onQuit?.();
  });
  return true;
}

module.exports={closeAction,restoreMainWindow,installMainWindowLifecycle};
