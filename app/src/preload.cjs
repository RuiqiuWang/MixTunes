'use strict';
const { contextBridge, ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('playerAPI',{
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
  getBackground:()=>ipcRenderer.invoke('app:background-get'),
  chooseBackground:theme=>ipcRenderer.invoke('app:background-choose',theme),
  setBackground:payload=>ipcRenderer.invoke('app:background-set',payload),
  clearBackground:()=>ipcRenderer.invoke('app:background-clear'),
  trackFileStatus:keys=>ipcRenderer.invoke('app:track-file-status',keys),
  prepareTrackFile:key=>ipcRenderer.invoke('app:track-prepare',key),
  saveTrackFile:key=>ipcRenderer.invoke('app:track-save-as',key),
  // Must stay a plain send: Electron only attaches a native file drag while the
  // renderer's dragstart is still being handled, not after an await.
  startTrackDrag:key=>ipcRenderer.send('app:track-drag-out',key),
  onState(fn){ const listener=(_event,state)=>fn(state);ipcRenderer.on('app:state',listener);return()=>ipcRenderer.removeListener('app:state',listener); },
  onBackground(fn){ const listener=(_event,value)=>fn(value);ipcRenderer.on('app:background',listener);return()=>ipcRenderer.removeListener('app:background',listener); },
  onNotice(fn){ const listener=(_event,notice)=>fn(notice);ipcRenderer.on('app:notice',listener);return()=>ipcRenderer.removeListener('app:notice',listener); }
});
