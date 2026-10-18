'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const {fetchMedia}=require('./providers.cjs');
const {fetchWithSession}=require('./session-fetch.cjs');

class AudioPlayer {
  constructor({ electron, sessionFor, onEvent, onDiagnostic=()=>{} }) {
    this.electron = electron; this.sessionFor = sessionFor; this.onEvent = onEvent;
    this.onDiagnostic=onDiagnostic;
    this.tokens = new Map(); this.slots = new Map(); this.window = null; this.ready = null;
    this.registered = new Set();
  }
  async init() {
    if (this.ready) return this.ready;
    // A failed boot must never be cached: the audio window lives in a private
    // partition, and Electron can fail the first asar file:// load there.
    this.ready = this.boot().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  teardownWindow() {
    if (this.listener) { this.electron.ipcMain?.removeListener('audio:event',this.listener); this.listener = null; }
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
  spawn(partition) {
    const { BrowserWindow, session, ipcMain } = this.electron;
    const ses = partition ? session.fromPartition(partition) : session.defaultSession;
    const scheme = 'mix-audio';
    if (!this.registered.has(ses)) {
      try { ses.protocol.handle(scheme, request => this.stream(request)); this.registered.add(ses); }
      catch (error) { if (!/already|registered/i.test(String(error.message||error))) throw error; }
    }
    this.window = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: {
      ...(partition ? { partition } : {}), preload: path.join(__dirname,'audio-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }});
    this.window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.listener = (event, payload) => {
      if (event.sender !== this.window?.webContents || !payload || !this.tokens.has(payload.token)) return;
      const token = this.tokens.get(payload.token);
      if (payload.key !== token.key || payload.generation !== token.generation) return;
      this.onEvent({ ...payload, backend:'audio' });
    };
    ipcMain.on('audio:event', this.listener);
  }
  async boot() {
    const html = path.join(__dirname,'../ui/audio.html');
    const plans = ['mixlink-audio', null];
    let lastError = null;
    for (const partition of plans) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.spawn(partition);
          await this.window.loadFile(html);
          if (partition !== 'mixlink-audio') this.onDiagnostic({type:'audio-boot-fallback',session:'default'});
          return;
        } catch (error) {
          lastError = error;
          this.onDiagnostic({type:'audio-boot-retry',session:partition||'default',attempt,message:String(error.message||error).slice(0,200)});
          this.teardownWindow();
          await new Promise(resolve => setTimeout(resolve,250));
        }
      }
    }
    throw lastError || new Error('Audio window unavailable');
  }
  async stream(request) {
    const token = new URL(request.url).pathname.slice(1);
    const resource = this.tokens.get(token);
    if (!resource) return new Response('Expired',{status:404});
    try {
      const headers = new Headers(resource.headers || {});
      const range = request.headers.get('Range');
      if (range) headers.set('Range',range);
      let response;
      for(const url of [...new Set([resource.url,...(resource.alternatives||[])])]){
        try{
          response=await fetchMedia(url,resource.platform,{fetch:async(target,options)=>{
            try{return await fetchWithSession(this.electron,this.sessionFor(resource.platform),target,options);}
            catch(error){
              this.onDiagnostic({type:'media-transport-error',platform:resource.platform,message:String(error.message||error).replace(/https?:\/\/\S+/g,'[resource]').slice(0,200)});
              if(!/ERR_BLOCKED_BY_CLIENT/.test(String(error.message||'')))throw error;
              // Chromium can reject a binary 206 fetch before exposing the body.
              // Node's HTTP transport keeps the same authorised URL, headers,
              // range and app-owned cookies; fetchMedia still validates each hop.
              const nodeHeaders=new Headers(options.headers);
              const cookies=await this.sessionFor(resource.platform).cookies.get({url:target});
              if(cookies.length)nodeHeaders.set('cookie',cookies.map(c=>`${c.name}=${c.value}`).join('; '));
              this.onDiagnostic({type:'media-node-transport',platform:resource.platform,host:new URL(target).hostname});
              return globalThis.fetch(target,{...options,headers:nodeHeaders});
            }
          }}, { headers, signal:request.signal });
          if([200,206,416].includes(response.status))break;
          await response.body?.cancel();
        }catch(error){
          this.onDiagnostic({type:'media-cdn-error',platform:resource.platform,host:new URL(url).hostname,error:error.details?.reason||error.name,message:String(error.message||'').replace(/https?:\/\/\S+/g,'[resource]').slice(0,200)});
          if(request.signal?.aborted)throw error;
        }
      }
      if(!response)throw new Error('All source CDNs unavailable');
      this.onDiagnostic({type:'media-response',platform:resource.platform,status:response.status,range:range||null,contentRange:response.headers.get('content-range'),contentType:response.headers.get('content-type')});
      if (![200,206,416].includes(response.status)) {
        return new Response('Source unavailable',{status:response.status >= 400 ? response.status : 502});
      }
      const forwarded = new Headers();
      for (const name of ['content-type','content-length','content-range','accept-ranges','cache-control']) {
        const value = response.headers.get(name); if (value) forwarded.set(name,value);
      }
      // Keep a stream, not a full-song buffer; Range/seek stays available.
      return new Response(response.body,{status:response.status,headers:forwarded});
    } catch(error) {
      this.onDiagnostic({type:'media-network-error',platform:resource.platform,error:error.name,code:error.code||null});
      return new Response('Source network error',{status:502});
    }
  }
  send(command) { if (this.window && !this.window.isDestroyed()) this.window.webContents.send('audio:command',command); }
  async load(track, generation, resolved, slot = 0, volume=.7, muted=false) {
    await this.init();
    const previous = this.slots.get(slot);
    if (previous) this.tokens.delete(previous.token);
    const token = crypto.randomUUID();
    this.tokens.set(token,{ ...resolved,platform:track.platform,key:track.key,generation });
    const entry={token,slot,key:track.key,generation}; this.slots.set(slot,entry);
    this.send({name:'load',...entry,url:`mix-audio://stream/${token}`,volume,muted,playRange:track.playRange||{startMs:0,endMs:null}});
    return entry;
  }
  activate(entry) { this.send({name:'play',...entry}); }
  pause(entry) { if (entry) this.send({name:'pause',...entry}); }
  seek(entry,positionMs) { if (entry) this.send({name:'seek',...entry,positionMs}); }
  setRange(entry,playRange) { if(entry)this.send({name:'range',...entry,playRange}); }
  stopAll() { this.send({name:'stop-all'}); }
  volume(volume,muted) { this.send({name:'volume-all',volume,muted}); }
  unload(entry) {
    if (!entry) return;
    this.send({name:'unload',...entry}); this.tokens.delete(entry.token);
    if (this.slots.get(entry.slot)?.token===entry.token) this.slots.delete(entry.slot);
  }
  destroy() {
    if (this.listener) this.electron.ipcMain.removeListener('audio:event',this.listener);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.tokens.clear(); this.window = null; this.ready = null; this.listener = null;
  }
}
module.exports={AudioPlayer};
