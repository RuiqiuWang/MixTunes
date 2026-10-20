'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LibraryStore, normaliseLibrary } = require('../src/store.cjs');
function isolated(t) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.mixlink-read-protection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new LibraryStore(directory);
}
test('missing library still permits first-run initialization and restart', t => {
  const store = isolated(t), initial = store.load();
  store.save(initial);
  assert.deepEqual(new LibraryStore(store.directory).load(), initial);
});
for (const original of ['{"schemaVersion":2,"tracks":[', '']) {
  test(`unreadable JSON (${original.length} bytes) blocks load and every save without changing bytes`, t => {
    const store = isolated(t);
    fs.writeFileSync(store.file, original);
    assert.throws(() => store.load(), /歌单读取失败.*保留原文件.*禁止保存/);
    for (let i = 0; i < 2; i++) assert.throws(() => store.save(normaliseLibrary({})), /歌单读取失败/);
    assert.equal(fs.readFileSync(store.file, 'utf8'), original);
    assert.equal(fs.existsSync(store.file + '.tmp'), false);
    fs.unlinkSync(store.file);
    assert.throws(() => store.load(), /歌单读取失败/, 'removing the file does not silently unlock the failed instance');
    assert.throws(() => store.save({}), /歌单读取失败/);
  });
}
test('filesystem read failure is distinct from missing file and cannot create a replacement', t => {
  const store = isolated(t);
  fs.mkdirSync(store.file);
  assert.throws(() => store.load(), /歌单读取失败/);
  assert.throws(() => store.save({}), /歌单读取失败/);
  assert.equal(fs.statSync(store.file).isDirectory(), true);
  assert.equal(fs.existsSync(store.file + '.tmp'), false);
});
test('valid existing library preserves playlist settings and normal writes', t => {
  const store = isolated(t);
  const data = normaliseLibrary({ schemaVersion: 2, volume: .23, muted: true, qualitySettings: { qq: 'high' }, playlists: [{id:'kept', name:'保留歌单', queue:[], mode:'shuffle'}], activePlaylistId:'kept' });
  fs.writeFileSync(store.file, JSON.stringify(data));
  assert.deepEqual(store.load(), data);
  store.save(store.load());
  assert.deepEqual(new LibraryStore(store.directory).load(), data);
});

test('real songs survive modification, save and restart', t => {
  const store = isolated(t);
  const track = { key:'netease:123', platform:'netease', sourceId:'123', url:'https://music.163.com/song?id=123', title:'Test' };
  const initial = normaliseLibrary({ schemaVersion:2, tracks:[track], playlists:[{id:'one',name:'One',queue:[track.key]}] });
  fs.writeFileSync(store.file, JSON.stringify(initial));
  const loaded = store.load(); loaded.playlists[0].name = 'Renamed'; loaded.volume = .35;
  store.save(loaded);
  const restored = new LibraryStore(store.directory).load();
  assert.equal(restored.tracks[0].key, track.key);
  assert.deepEqual(restored.playlists[0].queue, [track.key]);
  assert.equal(restored.playlists[0].name, 'Renamed');
  assert.equal(restored.volume, .35);
});

for (const code of ['EACCES', 'EPERM', 'EIO']) {
  test(`${code} on existing data blocks writes and retains exact binary bytes`, t => {
    const store = isolated(t), original = Buffer.from('{"tracks":[]}\r\n');
    fs.writeFileSync(store.file, original);
    const read = fs.readFileSync;
    try {
      fs.readFileSync = function(file, ...args) {
        if (file === store.file) throw Object.assign(new Error('simulated read failure'), {code});
        return read.call(this, file, ...args);
      };
      assert.throws(() => store.load(), error => error.cause.code === code);
    } finally { fs.readFileSync = read; }
    assert.throws(() => store.save({}), /禁止保存/);
    assert.deepEqual(fs.readFileSync(store.file), original);
    assert.equal(fs.existsSync(store.file + '.tmp'), false);
  });
}

test('delayed and exit-like save attempts stay locked, repaired data requires a fresh instance', async t => {
  const store = isolated(t), original = Buffer.from([0xff,0xfe,0x7b,0x00]);
  fs.writeFileSync(store.file, original);
  assert.throws(() => store.load(), /歌单读取失败/);
  await new Promise(resolve => setTimeout(() => {
    assert.throws(() => store.save({}), /禁止保存/); resolve();
  }, 20));
  assert.throws(() => store.save({}), /禁止保存/);
  assert.deepEqual(fs.readFileSync(store.file), original);
  const repaired = normaliseLibrary({schemaVersion:2,tracks:[],playlists:[{id:'restored',name:'Restored',queue:[]}]});
  fs.writeFileSync(store.file, JSON.stringify(repaired));
  store.load();
  assert.throws(() => store.save({}), /禁止保存/);
  assert.deepEqual(new LibraryStore(store.directory).load(), repaired);
  assert.equal(fs.existsSync(store.file + '.tmp'), false);
});

for (const input of ['{broken\r\n','{"schemaVersion":2,"tracks":null}']) {
test(`real main startup reports ${input} before engine/window and preserves on quit`, async t => {
  const vm = require('node:vm'), {createRequire} = require('node:module');
  const store = isolated(t), original = Buffer.from(input);
  fs.writeFileSync(store.file, original);
  const calls = [], handlers = new Map(), initialized = [];
  const electron = {
    protocol:{registerSchemesAsPrivileged(){}},
    app:{setPath(){},getPath(){return store.directory;},setName(){},requestSingleInstanceLock(){return true;},
      whenReady(){return Promise.resolve();},on(name,fn){handlers.set(name,fn);},exit(code){calls.push(['exit',code]);}},
    dialog:{showErrorBox(title,message){calls.push(['dialog',title,message]);}},
    globalShortcut:{unregisterAll(){}}
  };
  const main = path.resolve(__dirname,'../src/main.cjs'), localRequire = createRequire(main);
  const monitored = {
    './engine.cjs':['PlayerEngine'], './audio-player.cjs':['AudioPlayer'],
    './sleep-timer.cjs':['createSleepTimer'],
    './tray.cjs':['createAppTray'], './window-lifecycle.cjs':['installMainWindowLifecycle']
  };
  function requireForMain(name) {
    if (name === 'electron') return electron;
    const exports = localRequire(name);
    if (!monitored[name]) return exports;
    const wrapped = {...exports};
    for (const key of monitored[name]) wrapped[key] = new Proxy(exports[key], {
      apply(fn, receiver, args) { initialized.push(key); return Reflect.apply(fn,receiver,args); },
      construct(fn, args) { initialized.push(key); return Reflect.construct(fn,args); }
    });
    return wrapped;
  }
  vm.runInNewContext(fs.readFileSync(main,'utf8'), {
    require:requireForMain,
    process:{argv:[],env:{}},__dirname:path.dirname(main),console,setTimeout,clearTimeout,URL,URLSearchParams
  }, {filename:main});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0][0], 'dialog');
  assert.equal(calls[0][1], 'MixTunes 启动失败');
  assert.match(calls[0][2], /保留原文件.*禁止保存.*备份 library.json.*访问权限/);
  assert.deepEqual(calls[1], ['exit',1]);
  handlers.get('before-quit')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(initialized, [], 'failed load never creates engine, timer, audio or tray lifecycle');
  assert.deepEqual(fs.readFileSync(store.file), original);
  assert.equal(fs.existsSync(store.file+'.tmp'), false);
});
}

for (const original of ['null','[]','42','"text"','true',
  '{"schemaVersion":3}', '{"schemaVersion":"2"}', '{"schemaVersion":null}',
  '{"tracks":{}}','{"tracks":null}','{"playlists":"bad"}','{"queue":{}}',
  '{"playlists":[null]}','{"playlists":[[]]}','{"playlists":[{"queue":null}]}']) {
  test(`invalid envelope ${original} locks immediate, delayed and exit-like saves`, async t => {
    const store = isolated(t), bytes = Buffer.from(original+'\r\n');
    fs.writeFileSync(store.file, bytes);
    assert.throws(() => store.load(), /歌单读取失败/);
    assert.throws(() => store.save({}), /禁止保存/);
    await new Promise(resolve=>setImmediate(resolve));
    assert.throws(() => store.save(normaliseLibrary({})), /禁止保存/);
    // This is the same save entry point called by main's before-quit path.
    try { store.save(normaliseLibrary({})); } catch {}
    assert.deepEqual(fs.readFileSync(store.file), bytes);
    assert.deepEqual(fs.readdirSync(store.directory), ['library.json']);
  });
}

for (const data of [{}, {tracks:[],queue:[]}, {schemaVersion:1,tracks:[],queue:[]},
  {schemaVersion:2,tracks:[],playlists:[]},
  {schemaVersion:2,tracks:[],playlists:[{id:'empty',name:'Empty',queue:[]}],extra:'tolerated'}]) {
  test(`valid empty or legacy envelope ${JSON.stringify(data)} loads and saves`, t => {
    const store = isolated(t), original = Buffer.from(JSON.stringify(data)+'\r\n');
    fs.writeFileSync(store.file, original);
    const loaded = store.load();
    assert.deepEqual(fs.readFileSync(store.file), original);
    assert.equal(loaded.tracks.length, 0);
    if (data.schemaVersion !== 2 && !data.playlists) {
      assert.deepEqual(fs.readFileSync(path.join(store.directory,'library-v1-before-migration.json')), original);
    }
    store.save(loaded);
    assert.deepEqual(new LibraryStore(store.directory).load(), loaded);
  });
}
