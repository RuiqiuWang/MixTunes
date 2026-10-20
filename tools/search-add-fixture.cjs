'use strict';
// Controlled platform boundary; real SearchService, canonical parsing,
// deduplication, PlayerEngine and application persistence remain in use.
function installSearchFixture(SearchService){
  const fixture=globalThis.__p03Fixture={mode:'added',imports:0,adds:0,requests:{},ids:{qq:'0016IKty1sTxqi',netease:'33894312',bilibili:'BV17x411w7KC'}};
  const url=(platform,id)=>platform==='qq'?'https://y.qq.com/n/ryqq/songDetail/'+id:platform==='netease'?'https://music.163.com/song?id='+id:'https://www.bilibili.com/video/'+id;
  const originalSearch=SearchService.prototype.search,originalAdd=SearchService.prototype.add;
  SearchService.prototype.search=async function(payload){
    this.searchPlatform=async platform=>({items:[{id:fixture.ids[platform],platform,title:'Controlled '+platform,artist:'Fixture artist',url:url(platform,fixture.ids[platform])}],total:1,hasMore:false});
    this.importResource=async resource=>{
      fixture.imports++;
      if(fixture.mode==='error')throw Error('Controlled import failure');
      return {tracks:[{key:resource.platform+':'+resource.id,sourceId:resource.id,platform:resource.platform,url:resource.url,
        title:fixture.mode==='duplicate'?'Baseline':'Controlled '+resource.platform,artist:'Fixture artist',durationMs:180000}]};
    };
    const result=await originalSearch.call(this,payload);
    for(const record of result.results)if(record.items?.length)fixture.requests[record.platform]={requestId:result.requestId,platform:record.platform,id:record.items[0].id};
    return result;
  };
  SearchService.prototype.add=function(payload){fixture.adds++;return originalAdd.call(this,payload);};
}
function initialLibrary(){
  const track={key:'netease:900',platform:'netease',sourceId:'900',url:'https://music.163.com/song?id=900',title:'Baseline',artist:'Fixture artist',durationMs:180000};
  return {schemaVersion:2,tracks:[track],playlists:[{id:'a',name:'Playlist A',queue:[track.key],currentKey:track.key,mode:'sequential'},{id:'b',name:'Playlist B',queue:[],mode:'sequential'}],activePlaylistId:'a',queue:[track.key],currentKey:track.key,volume:0,muted:true};
}
// Browser-only native transport substitute. The generated runtime and mobile UI
// execute unchanged; storage uses the page's real localStorage across reloads.
function installNativeFixture({library,methods}){
  window.__nativeCalls=[];
  let serial=0;
  window.MixTunesBridge={postMessage(text){
    const {id,method,payload}=JSON.parse(text);window.__nativeCalls.push(method);
    let value=true,error;
    if(!methods.includes(method))error='Unsupported original native method: '+method;
    else if(method==='storage-load')value={json:localStorage.getItem('p03-library')||JSON.stringify(library)};
    else if(method==='storage-save')localStorage.setItem('p03-library',payload.json);
    else if(method==='cookies')value=[];
    else if(method==='fetch'||method==='share-fetch')error='Network disabled in isolated fixture';
    queueMicrotask(()=>window.__mixNativeReply({id,ok:!error,value,error}));
  },crypto(text){
    const request=JSON.parse(text);
    if(request.op==='randomUUID')return JSON.stringify({ok:true,value:'00000000-0000-4000-8000-'+String(++serial).padStart(12,'0')});
    return JSON.stringify({ok:false,error:'Unimplemented fixture crypto operation'});
  }};
}
module.exports={installSearchFixture,initialLibrary,installNativeFixture};
