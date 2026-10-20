'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const policy = require('../ui/background-image.js');
const { BackgroundStore } = require('../src/background-store.cjs');
// Minimal SOF header tests metadata inspection, not the actual image decoder.
function jpeg(width = 640, height = 480) {
  const b = Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0,255,217]);
  b.writeUInt16BE(height,7); b.writeUInt16BE(width,9); return b;
}
function value(x = .5) { return { version:1, image:'data:image/jpeg;base64,'+jpeg().toString('base64'),crop:{x,y:.5,zoom:2} }; }
test('rejects script/vector/animation input and oversized decode dimensions before decoding', () => {
  assert.deepEqual(policy.inspect(jpeg()),{width:640,height:480,mime:'image/jpeg'});
  for (const bytes of [Buffer.from('<svg onload="alert(1)"/>'),Buffer.from('GIF89a'),Buffer.from('not a photo'),Buffer.alloc(policy.MAX_INPUT+1),jpeg(8193,20),jpeg(6000,5000)]) assert.throws(()=>policy.inspect(bytes));
  const png=Buffer.alloc(45); png.writeUInt32BE(0x89504e47);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(400,16);png.writeUInt32BE(300,20);png.writeUInt32BE(0,33);png.write('acTL',37);
  assert.throws(()=>policy.inspect(png),/动画/);
  assert.throws(()=>policy.inspect(Buffer.from([255,216,...Array(20).fill(255)])),/有效/);
});
test('normalized crops cover landscape, portrait, tablet and window changes without distortion or gaps', () => {
  for(const [w,h] of [[1240,840],[960,680],[320,640],[812,375],[768,1024]]) for(const [iw,ih] of [[2560,1440],[1200,2400]]) for(const crop of [{x:0,y:0,zoom:1},{x:1,y:1,zoom:4},{x:.37,y:.65,zoom:2}]) {
    const rect=policy.layout(iw,ih,w,h,crop);
    assert.ok(rect.left<=0&&rect.top<=0&&rect.left+rect.width>=w-1e-8&&rect.top+rect.height>=h-1e-8);
    assert.ok(Math.abs(rect.width/rect.height-iw/ih)<1e-8);
  }
  assert.deepEqual(policy.crop({x:NaN,y:-3,zoom:Infinity}),{x:.5,y:0,zoom:1});
  assert.deepEqual(policy.crop(null),{x:.5,y:.5,zoom:1});
});
test('private background writes are serialized, replace atomically and preserve saved data on validation failure',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mixtunes-background-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=new BackgroundStore(directory);
  assert.equal(await store.load(),null);
  await Promise.all([store.save(value(.2)),store.save(value(.7))]);
  assert.equal((await new BackgroundStore(directory).load()).crop.x,.7);
  await assert.rejects(store.save({...value(),image:'data:image/svg+xml;base64,PHN2Zy8+'}));
  assert.equal((await store.load()).crop.x,.7);
  assert.deepEqual(await fs.readdir(directory),['custom-background.json']);
  await store.delete(); assert.equal(await store.load(),null);
  await fs.writeFile(store.file,'{broken'); await assert.rejects(store.load());
  assert.equal(await fs.readFile(store.file,'utf8'),'{broken');
});
