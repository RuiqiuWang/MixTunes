'use strict';
const {randomUUID}=require('node:crypto');
const PLATFORMS=['qq','netease','bilibili'];

function searchQuery(value){
  if(typeof value!=='string')throw new Error('请输入搜索词');
  const query=value.trim();
  if(!query||query.length>100||/[\u0000-\u001f\u007f]/.test(query))throw new Error('搜索词需为 1～100 个字符');
  return query;
}
function searchUrl(platform,value){
  const query=searchQuery(value);let url;
  if(platform==='qq'){url=new URL('https://y.qq.com/n/ryqq/search');url.search=new URLSearchParams({w:query,t:'song'}).toString();}
  else if(platform==='netease'){url=new URL('https://music.163.com/');url.hash='/search/m/?'+new URLSearchParams({s:query,type:'1'}).toString();}
  else if(platform==='bilibili'){url=new URL('https://search.bilibili.com/video');url.search=new URLSearchParams({keyword:query}).toString();}
  else throw new Error('不支持的平台');
  return url.href;
}

class SearchService{
  constructor({searchPlatform,contextFor,importResource,parseInput,safeTrack,engine,timeoutMs=12000,now=Date.now}){
    Object.assign(this,{searchPlatform,contextFor,importResource,parseInput,safeTrack,engine,timeoutMs,now});
    this.batches=new Map();this.inFlight=0;this.controllers=new Set();this.addQueue=Promise.resolve();this.closed=false;this.playSerial=0;
  }
  prune(){
    for(const [id,batch]of this.batches)if(this.now()-batch.at>20*60*1000)this.batches.delete(id);
    while(this.batches.size>30)this.batches.delete(this.batches.keys().next().value);
  }
  async provider(platform,query,page){
    const controller=new AbortController();this.controllers.add(controller);let timer;
    try{
      return await Promise.race([
        Promise.resolve().then(()=>this.searchPlatform(platform,query,this.contextFor(platform),{page,pageSize:20,signal:controller.signal})),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('搜索超时，请重试'));},this.timeoutMs);})
      ]);
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async search(payload={}){
    if(this.closed)throw new Error('播放器已退出');
    if(!payload||typeof payload!=='object')throw new Error('搜索参数无效');
    const query=searchQuery(payload.query),platform=payload.platform??'all',page=payload.page??1;
    if(platform!=='all'&&!PLATFORMS.includes(platform))throw new Error('不支持的平台');
    if(!Number.isInteger(page)||page<1||page>10)throw new Error('搜索页码无效');
    if(this.inFlight>=6)throw new Error('搜索正在进行，请稍候');
    this.inFlight++;const requestId=randomUUID();
    try{
      const targets=platform==='all'?PLATFORMS:[platform];
      const settled=await Promise.allSettled(targets.map(p=>this.provider(p,query,page)));
      const items=new Map();
      const results=settled.map((entry,index)=>{
        const p=targets[index];
        if(entry.status==='rejected')return{platform:p,ok:false,items:[],page,total:0,hasMore:false,error:String(entry.reason?.message||'暂时无法搜索').replace(/https?:\/\/\S+/g,'[链接]').slice(0,300)};
        const data=entry.value;
        const accepted=[];
        for(const item of Array.isArray(data?.items)?data.items.slice(0,20):[]){
          if(!item||item.platform!==p||typeof item.id!=='string'||!item.id||item.id.length>128)continue;
          try{
            const resources=this.parseInput(item.url);
            if(resources.length!==1||resources[0].platform!==p||!['track','video'].includes(resources[0].kind))continue;
            const cacheKey=p+':'+item.id;if(items.has(cacheKey))continue;
            const safe={id:item.id,platform:p,title:String(item.title||'').slice(0,500),artist:String(item.artist||'').slice(0,300),coverUrl:typeof item.coverUrl==='string'?item.coverUrl:'',durationMs:Number.isFinite(item.durationMs)&&item.durationMs>0?item.durationMs:null,url:resources[0].url};
            items.set(cacheKey,safe);accepted.push(safe);
          }catch{}
        }
        return{platform:p,ok:true,items:accepted,total:Number.isFinite(data?.total)&&data.total>=0?data.total:accepted.length,page,hasMore:page<10&&data?.hasMore===true};
      });
      this.batches.set(requestId,{query,at:this.now(),items});this.prune();
      return{ok:true,query,requestId,results};
    }finally{this.inFlight--;}
  }
  resultItem(payload={}){
    if(this.closed)throw new Error('播放器已退出');
    if(!payload||typeof payload!=='object')throw new Error('搜索结果参数无效');
    this.prune();const batch=this.batches.get(payload.requestId);
    const item=batch?.items.get(payload.platform+':'+payload.id);
    if(!item)throw new Error('搜索结果已过期，请重新搜索');
    return item;
  }
  async canonicalTrack(item){
    const resources=this.parseInput(item.url);
    if(resources.length!==1||resources[0].platform!==item.platform||!['track','video'].includes(resources[0].kind))throw new Error('搜索结果来源无效');
    const resource=resources[0];
    const imported=await this.importResource(resource,this.contextFor(item.platform));
    if(this.closed)throw new Error('播放器已退出');
    const tracks=(imported?.tracks||[]).map(this.safeTrack).filter(t=>t&&t.platform===item.platform&&
      (t.sourceId===resource.id||item.platform==='qq'&&/^\d+$/.test(resource.id)&&String(t.extra?.songId||'')===resource.id));
    if(tracks.length!==1)throw new Error('这条内容暂时无法读取，请重新搜索');
    return tracks[0];
  }
  async play(payload={}){
    const item=this.resultItem(payload),serial=++this.playSerial;
    const canceled=()=>({ok:true,canceled:true,message:'已取消此次搜索结果播放'});
    let track;
    try{track=await this.canonicalTrack(item);}catch(error){if(serial!==this.playSerial)return canceled();throw error;}
    if(serial!==this.playSerial)return canceled();
    this.resultItem(payload);
    await this.engine.playTemporary(track);
    if(serial!==this.playSerial)return canceled();
    if(this.closed)throw new Error('播放器已退出');
    return{ok:true,key:track.key,platform:track.platform,message:'正在播放搜索结果，尚未加入歌单'};
  }
  cancelPlayback(){this.playSerial++;}
  async add(payload={}){
    if(this.closed)throw new Error('播放器已退出');
    if(!payload||typeof payload!=='object')throw new Error('添加参数无效');
    const item=this.resultItem(payload);
    const playlistId=payload.playlistId;
    if(typeof playlistId!=='string'||!this.engine.snapshot().playlists.some(p=>p.id===playlistId))throw new Error('目标歌单已不存在，请重新搜索');
    // Re-read canonical metadata instead of trusting titles, URLs or rights from
    // the renderer. The engine's existing dedup and prepend rules stay central.
    const task=async()=>{
      if(this.closed)throw new Error('播放器已退出');
      if(!this.engine.snapshot().playlists.some(p=>p.id===playlistId))throw new Error('目标歌单已不存在，请重新搜索');
      this.resultItem(payload);
      const track=await this.canonicalTrack(item);
      this.resultItem(payload);
      const result=this.engine.addTracksDetailed([track],playlistId);
      const playlist=this.engine.snapshot().playlists.find(p=>p.id===playlistId);
      const key=track.key;
      let status;
      if(result.added>0)status='added';
      else if(result.existingKey>0)status='exists';
      else if(result.duplicateMetadata>0)status='duplicate';
      else if(playlist?.queue.includes(key))status='exists';
      // No counter moved and the canonical track is not in the playlist: the
      // write is unconfirmed, so report failure instead of a false success.
      else throw new Error('歌单未更新，添加未生效，请重试');
      const message=status==='added'?'已加入歌单':status==='exists'?'已在歌单中':'歌单中已有同名同作者歌曲，未重复添加';
      return{ok:true,status,...result,key,playlistId,message};
    };
    const result=this.addQueue.then(task,task);this.addQueue=result.catch(()=>{});return result;
  }
  close(){this.cancelPlayback();this.closed=true;for(const controller of this.controllers)controller.abort();this.batches.clear();}
}
module.exports={SearchService,searchQuery,searchUrl};
