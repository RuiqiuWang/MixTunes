'use strict';
const { contextBridge, ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('playerAPI',{
  sleepTimer:(action,payload={})=>ipcRenderer.invoke('app:sleep-timer',action,payload),
  onSleepTimer(fn){const listener=(_event,state)=>fn(state);ipcRenderer.on('app:sleep-timer',listener);return()=>ipcRenderer.removeListener('app:sleep-timer',listener);},
  background:(action,payload)=>ipcRenderer.invoke('app:background',action,payload),
  getState:()=>ipcRenderer.invoke('app:state'),
  importLinks:text=>ipcRenderer.invoke('app:import-links',text),
  command:(name,payload={})=>ipcRenderer.invoke('app:command',name,payload),
  login:platform=>ipcRenderer.invoke('app:login',platform),
  exportLibrary:()=>ipcRenderer.invoke('app:export'),
  importFile:()=>ipcRenderer.invoke('app:import-file'),
  openSource:key=>ipcRenderer.invoke('app:source',key),
  search:payload=>ipcRenderer.invoke('app:search',payload),
  addSearchResult:payload=>ipcRenderer.invoke('app:search-add',payload),
  playSearchResult:payload=>ipcRenderer.invoke('app:search-play',payload),
  getLyrics:key=>ipcRenderer.invoke('app:lyrics',key),
  startPlaylistShare:()=>ipcRenderer.invoke('app:share-start'),
  stopPlaylistShare:()=>ipcRenderer.invoke('app:share-stop'),
  openSearch:payload=>ipcRenderer.invoke('app:search-open',payload),
  trackFileStatus:keys=>ipcRenderer.invoke('app:track-file-status',keys),
  trackDownloadStatus:keys=>ipcRenderer.invoke('app:track-download-status',keys),
  trackDownload:key=>ipcRenderer.invoke('app:track-download',key),
  trackDownloadCancel:key=>ipcRenderer.invoke('app:track-download-cancel',key),
  trackReveal:key=>ipcRenderer.invoke('app:track-reveal',key),
  downloadsInfo:()=>ipcRenderer.invoke('app:downloads-info'),
  chooseDownloads:()=>ipcRenderer.invoke('app:downloads-choose'),
  openDownloads:()=>ipcRenderer.invoke('app:downloads-open'),
  onDownloadProgress(fn){ const listener=(_event,value)=>fn(value);ipcRenderer.on('app:download-progress',listener);return()=>ipcRenderer.removeListener('app:download-progress',listener); },
  prepareTrackFile:key=>ipcRenderer.invoke('app:track-prepare',key),
  saveTrackFile:key=>ipcRenderer.invoke('app:track-save-as',key),
  // Must stay a plain send: Electron only attaches a native file drag while the
  // renderer's dragstart is still being handled, not after an await.
  startTrackDrag:key=>ipcRenderer.send('app:track-drag-out',key),
  onState(fn){ const listener=(_event,state)=>fn(state);ipcRenderer.on('app:state',listener);return()=>ipcRenderer.removeListener('app:state',listener); },
  onNotice(fn){ const listener=(_event,notice)=>fn(notice);ipcRenderer.on('app:notice',listener);return()=>ipcRenderer.removeListener('app:notice',listener); }
});
