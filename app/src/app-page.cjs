'use strict';
const path=require('node:path');
const {fileURLToPath}=require('node:url');

// Electron and Node can spell the same file URL differently (for example,
// brackets, a tilde, or a Windows drive letter). Compare the exact file path.
function createAppPageGuard(uiPath){
  const canonical=value=>process.platform==='win32'?value.replace(/^([a-z]):/i,(_,drive)=>drive.toUpperCase()+':'):value;
  const expected=canonical(path.resolve(uiPath));
  function matchesUrl(value){
    try{
      if(typeof value!=='string'||/[\u0000-\u0020\\?#]/.test(value)||/%(?:2f|5c)/i.test(value))return false;
      // Only a local absolute file URL, without a host or network share.
      if(process.platform==='win32'?!/^file:\/\/[\/]([a-z]):\//i.test(value):!/^file:\/\/(\/[^/])/.test(value))return false;
      const url=new URL(value);
      if(url.protocol!=='file:'||url.hostname||url.username||url.password||url.port||url.search||url.hash)return false;
      return canonical(fileURLToPath(url))===expected;
    }catch{return false;}
  }
  function accepts(event,contents){
    try{
      if(!contents||contents.isDestroyed()||event?.sender!==contents)return false;
      const frame=event.senderFrame,main=contents.mainFrame;
      if(!frame||!main||frame.isDestroyed()||main.isDestroyed()||frame.detached||main.detached||frame.parent!==null)return false;
      for(const key of ['processId','routingId','frameTreeNodeId']){
        if(!Number.isInteger(frame[key])||frame[key]!==main[key])return false;
      }
      return matchesUrl(frame.url)&&matchesUrl(main.url);
    }catch{return false;}
  }
  return{matchesUrl,accepts};
}
module.exports={createAppPageGuard};
