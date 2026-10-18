'use strict';
const { contextBridge, ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('playerAPI',{
  getState:()=>ipcRenderer.invoke('app:state'),
  appearance:()=>ipcRenderer.invoke('app:appearance'),
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
  onState(fn){ const listener=(_event,state)=>fn(state);ipcRenderer.on('app:state',listener);return()=>ipcRenderer.removeListener('app:state',listener); },
  onNotice(fn){ const listener=(_event,notice)=>fn(notice);ipcRenderer.on('app:notice',listener);return()=>ipcRenderer.removeListener('app:notice',listener); }
});
