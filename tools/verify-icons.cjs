'use strict';
// Verify the built PE resource bytes, rather than assuming build configuration worked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(name) { return fs.readFileSync(path.join(root, name)); }
const ico = read('app/ui/icons/app.ico');
assert.equal(ico.readUInt16LE(2), 1);
const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
assert.equal(ico.readUInt16LE(4), sizes.length);
const frames = sizes.map((size, i) => {
  const offset = 6 + 16 * i;
  assert.equal(ico[offset] || 256, size);
  const bytes = ico.subarray(ico.readUInt32LE(offset + 12), ico.readUInt32LE(offset + 12) + ico.readUInt32LE(offset + 8));
  assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  return bytes;
});
assert.deepEqual(read('app/ui/tray.png'), read('app/ui/icons/tray-32.png'));
const executable = process.argv[2];
if (executable) {
  const { NtExecutable, NtExecutableResource, Resource } = require('../app/node_modules/resedit');
  const exe = NtExecutable.from(fs.readFileSync(path.resolve(executable)));
  const resources = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  assert.equal(groups.length, 1, 'Expected one branded EXE icon group');
  assert.equal(groups[0].icons.length, sizes.length);
  groups[0].icons.forEach((icon, i) => {
    assert.equal(icon.width || 256, sizes[i]);
    const resource = resources.entries.find(e => e.type === 3 && e.id === icon.iconID && e.lang === groups[0].lang);
    assert.ok(resource, 'Missing RT_ICON resource');
    assert.deepEqual(Buffer.from(resource.bin), frames[i], `EXE icon ${sizes[i]} differs from source ICO`);
  });
  const asar = require('../app/node_modules/@electron/asar');
  const archive = path.join(path.dirname(path.resolve(executable)), 'resources/app.asar');
  for (const file of ['ui/icons/app.ico', 'ui/icons/app.png', 'ui/tray.png', 'src/main.cjs']) {
    assert.deepEqual(asar.extractFile(archive, file.split('/').join(path.sep)), read('app/' + file), `Packaged ${file} differs`);
  }
}
console.log(JSON.stringify({ passed: true, icoSizes: sizes, exeResourcesCompared: !!executable, packagedFilesCompared: !!executable }));
