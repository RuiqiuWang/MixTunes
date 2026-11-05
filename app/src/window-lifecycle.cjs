'use strict';

// Closing hides to the tray only when enabled and a tray exists. Linux opts
// in explicitly because a Tray object can exist without a visible tray host.
function closeAction({trayAvailable=false,quitting=false,closeToTray=true}={}){
  if(quitting||!closeToTray)return 'close';
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
function installMainWindowLifecycle(win,{trayAvailable,isQuitting,onQuit,onFirstHide,closeToTray=true}={}){
  if(!win||installed.has(win))return false;
  installed.add(win);
  let noticeShown=false;
  win.on('close',event=>{
    const action=closeAction({trayAvailable:Boolean(trayAvailable?.()),quitting:Boolean(isQuitting?.()),closeToTray});
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
