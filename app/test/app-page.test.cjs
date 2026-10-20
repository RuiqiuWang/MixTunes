'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAppPageGuard } = require('../src/app-page.cjs');

// A real, isolated absolute path exercises spaces, Unicode, portable extraction
// names and literal URL metacharacters without reading an installed profile.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mixtunes-app-page-'));
const uiPath = path.join(tempRoot, 'Mix Tunes[1]~中文 % #', 'resources', 'app.asar', 'ui', 'index.html');
fs.mkdirSync(path.dirname(uiPath), { recursive: true });
fs.writeFileSync(uiPath, '<!doctype html><title>isolated fixture</title>');
const appUrl = pathToFileURL(uiPath).href;
const guard = createAppPageGuard(uiPath);
test.after(() => {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(tempRoot));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const acceptedUrls = [
  ['exact application file', appUrl],
  ['literal brackets and tilde', appUrl.replace(/%5b/ig, '[').replace(/%5d/ig, ']').replace(/%7e/ig, '~')],
  ['lowercase percent escapes', appUrl.replace(/%[0-9A-F]{2}/g, escape => escape.toLowerCase())],
  ['literal Unicode', appUrl.replace('%E4%B8%AD%E6%96%87', '中文')],
  ['encoded unreserved filename character', appUrl.replace('/index.html', '/%69ndex.html')],
  ['dot segment still resolves to exact file', appUrl.replace('/ui/index.html', '/ui/./index.html')],
];
if (process.platform === 'win32') acceptedUrls.push(['drive letter case only', appUrl.replace(/^file:\/\/\/([a-z]):/i, (_, drive) => 'file:///' + drive.toLowerCase() + ':')]);
for (const [name, value] of acceptedUrls) test('app URL accepts ' + name, () => assert.equal(guard.matchesUrl(value), true));

const rejectedUrls = [
  ['adjacent file', appUrl.replace('/index.html', '/settings.html')],
  ['same basename in adjacent directory', appUrl.replace('/ui/index.html', '/other/index.html')],
  ['changed directory case', appUrl.replace('/ui/index.html', '/UI/index.html')],
  ['query', appUrl + '?command=delete'],
  ['empty query delimiter', appUrl + '?'],
  ['fragment', appUrl + '#route'],
  ['empty fragment delimiter', appUrl + '#'],
  ['localhost authority', appUrl.replace('file:///', 'file://localhost/')],
  ['remote authority', appUrl.replace('file:///', 'file://remote.invalid/')],
  ['extra slash UNC form', appUrl.replace('file:///', 'file:////')],
  ['encoded slash lowercase', appUrl.replace('/ui/index.html', '/ui%2findex.html')],
  ['encoded slash uppercase', appUrl.replace('/ui/index.html', '/ui%2Findex.html')],
  ['encoded backslash lowercase', appUrl.replace('/ui/index.html', '/ui%5cindex.html')],
  ['encoded backslash uppercase', appUrl.replace('/ui/index.html', '/ui%5Cindex.html')],
  ['raw backslash', appUrl.replace('/ui/index.html', '/ui\\index.html')],
  ['encoded NUL', appUrl.replace('/ui/index.html', '/ui%00/index.html')],
  ['raw tab normalized by WHATWG URL', appUrl.replace('/ui/index.html', '/u\ti/index.html')],
  ['raw newline normalized by WHATWG URL', appUrl.replace('/ui/index.html', '/u\ni/index.html')],
  ['leading whitespace', ' ' + appUrl],
  ['literal percent that cannot be decoded', appUrl.replace('%25', '%')],
  ['invalid UTF-8 percent sequence', appUrl.replace('/ui/index.html', '/ui/%FFindex.html')],
  ['double encoded separator is a different path', appUrl.replace('/ui/index.html', '/ui%252findex.html')],
  ['alternate stream suffix', appUrl + ':stream'],
  ['trailing dot alias', appUrl + '.'],
  ['trailing space alias', appUrl + '%20'],
  ['HTTP', 'http://localhost/index.html'],
  ['HTTPS', 'https://example.invalid/index.html'],
  ['about blank', 'about:blank'],
  ['data URL', 'data:text/html,index.html'],
  ['javascript URL', 'javascript:void(0)'],
  ['blob URL', 'blob:https://example.invalid/id'],
  ['relative path', 'ui/index.html'],
  ['undefined URL', undefined],
  ['URL object instead of API string', new URL(appUrl)],
];
if (process.platform === 'win32') rejectedUrls.push(
  ['different drive', appUrl.replace(/^file:\/\/\/[a-z]:/i, 'file:///Z:')],
  ['drive bar alias', appUrl.replace(/^file:\/\/\/([a-z]):/i, (_, drive) => 'file:///' + drive + '|')],
);
for (const [name, value] of rejectedUrls) test('app URL rejects ' + name, () => assert.equal(guard.matchesUrl(value), false));

test('literal percent-escape-looking filename is decoded once', () => {
  const exact = path.join(tempRoot, 'literal%2f%5c', 'ui', 'index.html');
  const literalGuard = createAppPageGuard(exact);
  assert.equal(literalGuard.matchesUrl(pathToFileURL(exact).href), true);
  assert.equal(literalGuard.matchesUrl(pathToFileURL(exact).href.replace('%252f', '%2f')), false);
});

function fixture() {
  const main = {
    url: appUrl, processId: 10, routingId: 3, frameTreeNodeId: 7,
    detached: false, parent: null, isDestroyed: () => false,
  };
  const contents = { mainFrame: main, isDestroyed: () => false };
  // API wrappers may differ while the underlying frame identity is identical.
  return { contents, event: { sender: contents, senderFrame: { ...main } } };
}

test('accepts live main-frame IPC with a distinct wrapper for the same frame', () => {
  const f = fixture();
  assert.notEqual(f.event.senderFrame, f.contents.mainFrame);
  assert.equal(guard.accepts(f.event, f.contents), true);
});
test('both main-frame URL spellings can denote the exact app file', () => {
  const f = fixture();
  f.event.senderFrame.url = appUrl.replace(/%5b/ig, '[').replace(/%5d/ig, ']').replace(/%7e/ig, '~');
  assert.equal(guard.accepts(f.event, f.contents), true);
});

const rejectedEvents = [
  ['another webContents, including login window', f => { f.event.sender = { ...f.contents }; }],
  ['same URL child frame', f => { f.event.senderFrame.parent = f.contents.mainFrame; }],
  ['missing sender frame after navigation', f => { f.event.senderFrame = null; }],
  ['missing current main frame', f => { f.contents.mainFrame = null; }],
  ['detached sender frame', f => { f.event.senderFrame.detached = true; }],
  ['detached main frame', f => { f.contents.mainFrame.detached = true; }],
  ['destroyed sender frame', f => { f.event.senderFrame.isDestroyed = () => true; }],
  ['destroyed main frame', f => { f.contents.mainFrame.isDestroyed = () => true; }],
  ['destroyed webContents', f => { f.contents.isDestroyed = () => true; }],
  ['remote sender page', f => { f.event.senderFrame.url = 'https://y.qq.com/'; }],
  ['adjacent file sender page', f => { f.event.senderFrame.url = appUrl.replace('/index.html', '/login.html'); }],
  ['current main document changed', f => { f.contents.mainFrame.url = 'about:blank'; }],
  ['sender getter fails during teardown', f => { Object.defineProperty(f.event, 'senderFrame', { get() { throw Error('frame destroyed'); } }); }],
  ['main-frame getter fails during teardown', f => { Object.defineProperty(f.contents, 'mainFrame', { get() { throw Error('contents destroyed'); } }); }],
];
for (const key of ['processId', 'routingId', 'frameTreeNodeId']) {
  rejectedEvents.push([key + ' mismatch', f => { f.event.senderFrame[key]++; }]);
  rejectedEvents.push([key + ' absent', f => { delete f.event.senderFrame[key]; }]);
  rejectedEvents.push([key + ' noninteger', f => { f.event.senderFrame[key] = 3.5; }]);
}
for (const [name, mutate] of rejectedEvents) test('IPC rejects ' + name, () => {
  const f = fixture(); mutate(f); assert.equal(guard.accepts(f.event, f.contents), false);
});
test('missing IPC event or app contents fails closed', () => {
  const f = fixture();
  assert.equal(guard.accepts(undefined, f.contents), false);
  assert.equal(guard.accepts(f.event, undefined), false);
});
