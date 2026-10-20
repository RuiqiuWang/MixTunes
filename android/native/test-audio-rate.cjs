'use strict';
// Execute the production applyRate method against a MediaPlayer double that
// deliberately models setPlaybackParams(nonzero) starting prepared playback.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'src/local/mixtunes/mobile/AudioController.java'),'utf8');
const start=source.indexOf('    private void applyRate(Entry entry)');let depth=0,end;
for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth){end=i+1;break;}}
if(start<0||!end)throw Error('Production method missing');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-native-rate-'));
const java=String.raw`class RateSafety {
 float rate=1.5f; Entry active;
 static class Params {float speed;Params setSpeed(float value){speed=value;return this;}}
 static class Player {boolean playing;int calls;float speed=1;boolean isPlaying(){return playing;}Params getPlaybackParams(){return new Params();}void setPlaybackParams(Params p){calls++;speed=p.speed;playing=true;}}
 static class Entry {boolean released,prepared=true,wantsPlay=true,positioned=true;Player player=new Player();}
 ${source.slice(start,end)}
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 public static void main(String[] args){
  RateSafety host=new RateSafety();Entry current=new Entry();host.active=current;
  host.applyRate(current);check(!current.player.playing&&current.player.calls==0,"paused entry started");
  current.player.playing=true;Entry preload=new Entry();host.applyRate(preload);check(!preload.player.playing&&preload.player.calls==0,"preload started");
  current.wantsPlay=false;host.applyRate(current);check(current.player.calls==0,"ignored pause intent");
  current.wantsPlay=true;host.applyRate(current);check(current.player.calls==1&&current.player.speed==1.5f,"active speed not applied");
  System.out.println("PASS native rate: paused, preloaded, pause intent and active playback");
 }
}`;
try{fs.writeFileSync(path.join(directory,'RateSafety.java'),java);const jdk=process.env.JAVA_HOME;if(!jdk)throw Error('JAVA_HOME required');execFileSync(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','-d',directory,path.join(directory,'RateSafety.java')]);process.stdout.write(execFileSync(path.join(jdk,'bin/java.exe'),['-cp',directory,'RateSafety']));}
finally{fs.rmSync(directory,{recursive:true,force:true});}
