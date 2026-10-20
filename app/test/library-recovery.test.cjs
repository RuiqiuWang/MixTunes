'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LibraryStore,normaliseLibrary}=require('../src/store.cjs');
const {chooseLibrary}=require('../src/library-recovery.cjs');
const valid=JSON.stringify(normaliseLibrary({}));
test('mobile read failures never turn a stale cache into an automatic writable restore',()=>{
  for(const input of [{nativeError:new Error('EACCES'),localText:valid},{nativeText:'{',localText:'{'},{nativeText:'{"tracks":"bad"}',localText:valid},{nativeText:null,localText:valid}]){
    const result=chooseLibrary(input);assert.equal(result.locked,true);assert.notEqual(result.useLocal,true);
  }
  assert.equal(chooseLibrary({}).locked,false);
  assert.equal(chooseLibrary({nativeText:valid,localText:valid}).locked,false);
});
test('backup writes fail before primary replacement and explicit restore archives damaged bytes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new LibraryStore(dir);store.save(normaliseLibrary({volume:.2}));const original=fs.readFileSync(store.file);
  fs.mkdirSync(store.backup+'.tmp');assert.throws(()=>store.save(normaliseLibrary({volume:.5})));assert.deepEqual(fs.readFileSync(store.file),original);fs.rmdirSync(store.backup+'.tmp');
  const damaged=Buffer.from('{broken');fs.writeFileSync(store.file,damaged);assert.throws(()=>store.load());assert.throws(()=>store.save({}));
  const candidate=store.recoveryCandidate();assert.ok(candidate);store.restore(candidate.text);assert.equal(store.loadError,null);
  const archives=fs.readdirSync(dir).filter(x=>x.startsWith('library.before-restore-'));assert.equal(archives.length,1);assert.deepEqual(fs.readFileSync(path.join(dir,archives[0])),damaged);
});
test('invalid recovery candidate does not unlock or modify the primary',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mixtunes-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new LibraryStore(dir);fs.writeFileSync(store.file,'{broken');assert.throws(()=>store.load());assert.throws(()=>store.restore('{"tracks":null}'));assert.ok(store.loadError);assert.equal(fs.readFileSync(store.file,'utf8'),'{broken');
});
