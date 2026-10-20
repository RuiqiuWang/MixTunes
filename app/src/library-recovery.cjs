'use strict';
const {validateLibraryFile,normaliseLibrary}=require('./store.cjs');
function parseSaved(text){if(typeof text!=='string')return null;try{const value=JSON.parse(text);validateLibraryFile(value);return value;}catch{return null;}}
function savedTime(value){return Number.isSafeInteger(value?._mixtunesSavedAt)&&value._mixtunesSavedAt>0?value._mixtunesSavedAt:0;}
function chooseLibrary({nativeText=null,localText=null,nativeError=null,localError=null,nativeBackup=null}){
  const primary=parseSaved(nativeText),local=parseSaved(localText),backup=parseSaved(nativeBackup);
  const candidate=local||backup,candidateText=local?localText:backup?nativeBackup:null;
  const failed=!!nativeError||!!localError||(nativeText!==null&&!primary)||(localText!==null&&!local);
  if(failed||(!primary&&local))return{library:normaliseLibrary(primary||candidate||{}),locked:true,candidateText,reason:'歌单读取异常，已停止自动保存。请检查文件或恢复备份。',savedAt:savedTime(primary||candidate)};
  const useLocal=!!(primary&&local&&savedTime(local)>savedTime(primary));
  const library=useLocal?local:primary||{};
  return{library:normaliseLibrary(library),locked:false,candidateText:null,reason:'',savedAt:savedTime(library),useLocal};
}
module.exports={parseSaved,savedTime,chooseLibrary};
