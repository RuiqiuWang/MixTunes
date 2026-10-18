'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {normaliseLibrary,LibraryStore}=require('../src/store.cjs');
const track=sourceId=>({key:`netease:${sourceId}`,platform:'netease',sourceId,url:`https://music.163.com/song?id=${sourceId}`,title:`Song ${sourceId}`});
test('backup import rejects unsupported URLs and merges valid identities without executable paths',()=>{
  const result=normaliseLibrary({tracks:[
    {platform:'netease',sourceId:'1',key:'ne:1',url:'https://music.163.com/song?id=1',title:'A'},
    {platform:'netease',sourceId:'1',key:'ne:1',url:'https://music.163.com/song?id=1',title:'duplicate'},
    {platform:'qq',sourceId:'evil',url:'file:///C:/Windows/system32/cmd.exe'},
    {platform:'bilibili',sourceId:'BVabc',url:'https://bilibili.com.evil.example/'}
  ],queue:['unknown','ne:1'],volume:99,mode:'bad'});
  assert.equal(result.tracks.length,1); assert.deepEqual(result.queue,['ne:1']);
  assert.equal(result.volume,1); assert.equal(result.mode,'sequential');
});
test('schema one migrates every legacy member and its exact order, selection and mode into one playlist',()=>{
  const tracks=['1','2','3'].map(track);
  const migrated=normaliseLibrary({schemaVersion:1,tracks,queue:['netease:3','netease:1'],mode:'shuffle',currentKey:'netease:1',volume:.23,muted:true});
  assert.equal(migrated.schemaVersion,2);
  assert.deepEqual(migrated.queue,['netease:3','netease:1','netease:2']);
  assert.deepEqual(migrated.playlists,[{id:'default',name:'我的歌单',queue:migrated.queue,mode:'shuffle',currentKey:'netease:1'}]);
  assert.equal(migrated.activePlaylistId,'default');assert.equal(migrated.volume,.23);assert.equal(migrated.muted,true);
});
test('schema two retains independent membership and empty playlists without filling from the catalog',()=>{
  const result=normaliseLibrary({schemaVersion:2,tracks:['1','2','3'].map(track),activePlaylistId:'second',
    queue:['netease:3'],mode:'repeat-all',currentKey:'netease:3',playlists:[
      {id:'first',name:'First',queue:['netease:2','netease:1','netease:2','missing'],mode:'shuffle',currentKey:'netease:1'},
      {id:'second',name:'Second',queue:[],mode:'repeat-one',currentKey:'netease:3'}]});
  assert.equal(result.tracks.length,3);assert.deepEqual(result.queue,[]);assert.equal(result.currentKey,null);assert.equal(result.mode,'repeat-one');
  assert.deepEqual(result.playlists[0].queue,['netease:2','netease:1']);
  assert.equal(result.playlists[0].currentKey,'netease:1');
  const empty=normaliseLibrary({schemaVersion:2,tracks:['1'].map(track),playlists:[]});
  assert.deepEqual(empty.queue,[]);assert.equal(empty.tracks.length,1);
});
test('legacy load creates an exact one-time backup before migration and never replaces it',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  const original='{"schemaVersion":1,"tracks":'+JSON.stringify(['1','2'].map(track))+',"queue":["netease:2","netease:1"],"mode":"repeat-all","currentKey":"netease:2"}\n';
  fs.writeFileSync(store.file,original);
  const migrated=store.load();assert.equal(migrated.schemaVersion,2);
  const backup=path.join(directory,'library-v1-before-migration.json');
  assert.equal(fs.readFileSync(backup,'utf8'),original);
  assert.equal(fs.readFileSync(store.file,'utf8'),original,'load leaves the legacy source intact until a real save');
  fs.writeFileSync(store.file,JSON.stringify({schemaVersion:1,tracks:[track('3')]}));store.load();
  assert.equal(fs.readFileSync(backup,'utf8'),original);
  store.save(migrated);assert.deepEqual(store.load(),migrated);assert.equal(fs.readFileSync(backup,'utf8'),original);
});
test('a migration backup failure is visible and leaves the legacy library untouched',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-failure-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);const original=JSON.stringify({schemaVersion:1,tracks:[track('1')]});
  fs.writeFileSync(store.file,original);fs.mkdirSync(path.join(directory,'library-v1-before-migration.json'));
  assert.throws(()=>store.load(),/旧版歌单备份失败/);
  assert.equal(fs.readFileSync(store.file,'utf8'),original);
});
test('schema two survives atomic save and restart with independent modes, order and active aliases',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-v2-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  const data={schemaVersion:2,tracks:['1','2','3'].map(track),activePlaylistId:'two',volume:.42,muted:true,playlists:[
    {id:'one',name:'One',queue:['netease:2','netease:1'],mode:'shuffle',currentKey:'netease:1'},
    {id:'two',name:'Two',queue:['netease:3','netease:2'],mode:'repeat-one',currentKey:'netease:2'}]};
  store.save(data);const loaded=store.load();assert.deepEqual(loaded,normaliseLibrary(data));
  assert.deepEqual(loaded.queue,['netease:3','netease:2']);assert.equal(loaded.mode,'repeat-one');assert.equal(loaded.currentKey,'netease:2');
  assert.equal(fs.existsSync(path.join(directory,'library-v1-before-migration.json')),false);
});

test('a corrupt library is preserved, backed up and recovered from the automatic snapshot',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-corrupt-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  const data={schemaVersion:2,tracks:['1','2'].map(track),activePlaylistId:'one',playlists:[{id:'one',name:'One',queue:['netease:1','netease:2'],mode:'sequential',currentKey:'netease:1'}]};
  store.save(data);
  const good=fs.readFileSync(store.backup,'utf8');
  assert.ok(good.includes('netease:1'));
  fs.writeFileSync(store.file,'{"schemaVersion":2,"tracks":[{"platform":');
  const loaded=store.load();
  assert.equal(store.notice.type,'restored');
  assert.deepEqual(loaded,normaliseLibrary(data));
  const broken=fs.readdirSync(directory).filter(name=>name.startsWith('library.corrupt-'));
  assert.equal(broken.length,1);
  assert.ok(fs.readFileSync(path.join(directory,broken[0]),'utf8').startsWith('{"schemaVersion":2,"tracks":[{"platform":'));
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file,'utf8')),JSON.parse(JSON.stringify(normaliseLibrary(data))));
});
test('a corrupt library without a usable backup keeps the damaged file and starts empty',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-broken-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  fs.writeFileSync(store.file,'not json at all');
  const loaded=store.load();
  assert.equal(store.notice.type,'corrupt');
  assert.deepEqual(loaded,normaliseLibrary({}));
  const broken=fs.readdirSync(directory).filter(name=>name.startsWith('library.corrupt-'));
  assert.equal(broken.length,1);
  assert.equal(fs.readFileSync(path.join(directory,broken[0]),'utf8'),'not json at all');
  assert.equal(fs.readFileSync(store.file,'utf8'),'not json at all');
});
test('a valid JSON document without any library content is treated as damaged',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-empty-json-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  fs.writeFileSync(store.file,'{"unrelated":true}');
  assert.deepEqual(store.load(),normaliseLibrary({}));
  assert.equal(store.notice.type,'corrupt');
});
test('a first run without a library file stays silent and creates no backup',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-fresh-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  assert.deepEqual(store.load(),normaliseLibrary({}));
  assert.equal(store.notice,null);
  assert.equal(fs.existsSync(store.backup),false);
});
test('a library above the documented limits warns instead of dropping silently',t=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.mixlink-store-limits-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LibraryStore(directory);
  const playlists=Array.from({length:501},(_,index)=>({id:'p'+index,name:'P'+index,queue:[]}));
  fs.writeFileSync(store.file,JSON.stringify({schemaVersion:2,tracks:[],playlists,activePlaylistId:'p0'}));
  const loaded=store.load();
  assert.equal(store.notice.type,'truncated');
  assert.equal(loaded.playlists.length,500);
});
test('quality settings restore defaults and keep each supported platform preference independently',()=>{
  assert.deepEqual(normaliseLibrary({}).qualitySettings,{qq:'auto',netease:'auto',bilibili:'auto'});
  const result=normaliseLibrary({qualitySettings:{qq:'lossless',netease:'high',bilibili:'standard',other:'lossless'}});
  assert.deepEqual(result.qualitySettings,{qq:'lossless',netease:'high',bilibili:'standard'});
  assert.deepEqual(normaliseLibrary(result).qualitySettings,result.qualitySettings);
});

test('stored Bilibili covers migrate to HTTPS only on the official image CDN',()=>{
  const base={key:'bilibili:BV17x411w7KC:279786',platform:'bilibili',sourceId:'BV17x411w7KC',url:'https://www.bilibili.com/video/BV17x411w7KC'};
  for(const coverUrl of ['http://i0.hdslb.com/bfs/archive/cover.jpg','//i0.hdslb.com/bfs/archive/cover.jpg']){
    assert.equal(normaliseLibrary({tracks:[{...base,coverUrl}]}).tracks[0].coverUrl,'https://i0.hdslb.com/bfs/archive/cover.jpg');
  }
  for(const coverUrl of ['http://hdslb.com.evil.test/cover.jpg','https://x:y@i0.hdslb.com/cover.jpg','https://i0.hdslb.com:1234/cover.jpg']){
    assert.equal(normaliseLibrary({tracks:[{...base,coverUrl}]}).tracks[0].coverUrl,'');
  }
});
