'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

const executable = process.env.MIXTUNES_RELEASE_EXECUTABLE;
const root = path.resolve(process.env.MIXTUNES_PROTECTION_TEST_ROOT || path.join(__dirname, '../.local-build/library-read-protection-tests'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function isolated(label) {
  fs.mkdirSync(root, { recursive:true });
  return fs.mkdtempSync(path.join(root, label+'-'));
}
async function launch(directory) {
  assert.ok(executable && fs.existsSync(executable), 'Set MIXTUNES_RELEASE_EXECUTABLE to the packaged Windows EXE');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--test-mode', '--smoke-test', '--data-dir=' + directory], {env, windowsHide: true, stdio: 'ignore'});
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('Candidate did not stop after failed library load')); }, 20000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolve(code); });
  });
  return result;
}
for (const [label, original] of [
  ['syntax', Buffer.from('{"schemaVersion":2,"tracks":[')],
  ['empty', Buffer.alloc(0)], ['root-null', Buffer.from('null\r\n')],
  ['wrong-fields', Buffer.from('{"schemaVersion":2,"tracks":"bad","playlists":null}\r\n')],
  ['future-schema', Buffer.from('{"schemaVersion":99,"tracks":[]}')],
  ['binary', Buffer.from([0xff,0xfe,0x7b,0x00])]
]) {
  test(`packaged ${label}: preserves bytes and permits repaired restart`, {timeout:50000,skip:process.platform!=='win32'}, async()=>{
    const directory=isolated(label), file=path.join(directory,'library.json');
    fs.writeFileSync(file,original);
    assert.equal(await launch(directory),1);
    const after=fs.readFileSync(file);
    assert.deepEqual(after,original);
    assert.equal(fs.existsSync(file+'.tmp'),false);
    assert.equal(fs.existsSync(path.join(directory,'smoke-result.json')),false);
    const evidence={label,directory,beforeSha256:sha(original),afterSha256:sha(after),bytes:after.length,exitCode:1,noTemp:true,noAppReady:true};
    fs.writeFileSync(path.join(directory,'original-input.bin'),original);
    fs.writeFileSync(file,JSON.stringify({schemaVersion:2,tracks:[{key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'Restored song'}],playlists:[{id:'restored',name:'Restored',queue:['netease:1'],mode:'sequential'}]}));
    assert.equal(await launch(directory),0);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).playlists[0].id,'restored');
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).tracks[0].key,'netease:1');
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).playlists[0].queue,['netease:1']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'smoke-result.json'),'utf8')).packaged,true);
    evidence.repairedRestartExitCode=0;
    fs.writeFileSync(path.join(directory,'protection-evidence.json'),JSON.stringify(evidence,null,2));
  });
}
test('packaged first run initializes and restarts', {timeout:50000,skip:process.platform!=='win32'}, async()=>{
  const directory=isolated('first-run');
  assert.equal(await launch(directory),0);
  const first=JSON.parse(fs.readFileSync(path.join(directory,'library.json'),'utf8'));
  assert.equal(first.schemaVersion,2);assert.deepEqual(first.tracks,[]);
  assert.equal(await launch(directory),0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'library.json'),'utf8')),first);
});

test('packaged quit cancels an active timer and saves a valid migrated library', {timeout:30000,skip:process.platform!=='win32'}, async t=>{
  const {_electron} = require('../app/node_modules/playwright-core');
  const directory=isolated('active-timer-quit'),file=path.join(directory,'library.json');
  const original=Buffer.from(JSON.stringify({tracks:[{key:'netease:1',platform:'netease',sourceId:'1',url:'https://music.163.com/song?id=1',title:'Legacy song'}],queue:['netease:1']}));
  fs.writeFileSync(file,original);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:executable,args:['--test-mode','--data-dir='+directory],env});
  t.after(()=>app.close().catch(()=>{}));
  let output='';app.process().stdout.on('data',chunk=>{output+=chunk.toString();});
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='已就绪');
  const before=await app.evaluate(({app})=>{
    const state=app.__mixSleepTest.startSeconds(60);
    // Main's before-quit handler was registered first. Observe its completed
    // synchronous cleanup through the public test hook, then the real exit.
    app.once('before-quit',()=>process.stdout.write('P04-QUIT:'+JSON.stringify({timerActive:app.__mixSleepTest.state().active})+'\n'));
    return {active:state.active,packaged:app.isPackaged};
  });
  assert.deepEqual(before,{active:true,packaged:true});
  const exited=new Promise(resolve=>app.process().once('exit',resolve));
  await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});
  assert.equal(await exited,0);
  assert.match(output,/P04-QUIT:\{"timerActive":false\}/);
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.schemaVersion,2);assert.equal(saved.tracks[0].key,'netease:1');
  assert.deepEqual(saved.playlists[0].queue,['netease:1']);
  assert.deepEqual(fs.readFileSync(path.join(directory,'library-v1-before-migration.json')),original);
  assert.equal(fs.existsSync(file+'.tmp'),false);
});
