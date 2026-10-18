'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the exact Java-generated page controller, rather than a second copy.
const java = fs.readFileSync(path.join(__dirname, 'src/local/mixtunes/mobile/OfficialWebViews.java'), 'utf8');
const expression = java.match(/private String bootstrap\(JSONObject request\) \{\s*return ([\s\S]*?);\s*\}\s*void playVideo/)[1]
  .replaceAll('request.toString()', 'JSON.stringify(config)');
function harness(config, duration = 100, readyState = 0, asyncSeek = false) {
  class Media {
    constructor() { this.tagName = 'VIDEO'; this.readyState = readyState; this.duration = duration; this.currentTime = 0; this.seeking = false; this.paused = true; this.ended = false; this.starts = 0; this.events = new Map(); }
    play() { this.paused = false; this.starts++; return Promise.resolve(); }
    pause() { this.paused = true; }
    get currentTime(){return this.position||0;}
    set currentTime(value){if(asyncSeek){this.pendingPosition=value;this.seeking=true;setTimeout(()=>{this.position=this.pendingPosition;this.seeking=false;},5);}else this.position=value;}
    addEventListener(name, listener) { this.events.set(name, listener); }
  }
  const video = new Media();
  let currentVideo = video;
  const context = vm.createContext({
    window: {}, HTMLMediaElement: Media, setTimeout,
    document: {querySelector: () => currentVideo, createElement: () => ({}), head: {append() {}}}
  });
  const source = vm.runInNewContext(expression, {config});
  new vm.Script(source).runInContext(context);
  return {video, state: context.window.__mixMobileVideo,replaceVideo(){currentVideo=new Media();return currentVideo;}};
}

test('official page cannot autoplay before metadata and requested clip seek', async () => {
  const {video, state} = harness({startMs: 3000, endMs: 8000, volume: .6});
  await video.play();
  assert.equal(video.starts, 0);
  assert.equal(await state.play(), false);
  assert.equal(video.starts, 0);
  video.readyState = 1;
  await state.play();
  assert.equal(video.currentTime, 3);
  assert.equal(video.starts, 1);
  assert.equal(state.snapshot().ready, true);
});

test('media errors before metadata are reported instead of an endless unready snapshot',async()=>{
  const {video,state}=harness({startMs:0});
  video.error={code:4};
  assert.equal(state.snapshot().ready,false);
  assert.match(state.snapshot().error,/媒体资源加载或解码失败.*4/);
  assert.equal(await state.play(),false);assert.equal(video.starts,0);
});

test('a replaced site video reapplies the clip and ignores the old elements error and end events',async()=>{
  const h=harness({startMs:3000},100,1);await h.state.play();
  const replacement=h.replaceVideo();
  h.state.snapshot();await h.state.play();
  assert.equal(replacement.currentTime,3);assert.equal(replacement.paused,false);
  h.video.error={code:3};h.video.events.get('error')();
  h.video.events.get('ended')({stopImmediatePropagation(){}});
  assert.equal(h.state.want,true);assert.equal(h.state.snapshot().error,'');
});

test('a media error event stops the playing intent and cannot look like a natural end',async()=>{
  const {video,state}=harness({startMs:0},100,1);await state.play();
  video.error={code:3};video.events.get('error')();
  const snapshot=state.snapshot();
  assert.equal(state.want,false);assert.equal(video.paused,true);
  assert.equal(snapshot.ready,false);assert.match(snapshot.error,/错误 3/);
  assert.notEqual(snapshot.ended,true);
  assert.equal(await state.play(),false);
});

test('resume position is applied before first play and range end blocks site autoplay', async () => {
  const {video, state} = harness({startMs: 3000, endMs: 8000, initialPositionMs: 5500}, 100, 1);
  await state.play();
  assert.equal(video.currentTime, 5.5);
  video.currentTime = 8;
  const end = state.snapshot();
  assert.equal(end.ended, true);
  assert.equal(video.paused, true);
  await video.play();
  assert.equal(video.starts, 1);
  assert.equal(state.want, false);
});

test('saved start beyond actual duration resets safely before playback', async () => {
  const {video, state} = harness({startMs: 3000, endMs: 8000}, 2, 1);
  await state.play();
  assert.equal(video.currentTime, 0);
  assert.equal(state.start, 0);
  assert.equal(state.end, null);
  assert.equal(state.snapshot().rangeReset, true);
});
test('asynchronous video seeking keeps playing intent and resumes after positioning, without forcing paused playback',async()=>{
  const {video,state}=harness({startMs:0,endMs:80000},100,1,true);await state.play();
  await state.seek(12000);assert.equal(video.currentTime,12);assert.equal(video.paused,false);assert.equal(state.want,true);
  state.pause();await state.seek(24000);assert.equal(video.currentTime,24);assert.equal(video.paused,true);assert.equal(state.want,false);
});
test('a user pause during asynchronous seeking wins and concurrent seeks keep the latest target',async()=>{
  const {video,state}=harness({startMs:0,endMs:80000},100,1,true);await state.play();
  const seek=state.seek(10000);state.pause();await seek;assert.equal(video.paused,true);
  await state.play();const old=state.seek(20000),latest=state.seek(30000);await Promise.all([old,latest]);assert.equal(video.currentTime,30);assert.equal(video.paused,false);
});
test('stale tail progress and native ended while seeking backwards cannot clear playing intent',async()=>{
  const {video,state}=harness({startMs:0,endMs:80000},100,1,true);await state.play();video.position=80;
  const seeking=state.seek(12000);assert.equal(video.seeking,true);assert.equal(state.snapshot().ended,false);
  video.events.get('ended')({stopImmediatePropagation(){}});assert.equal(state.want,true);
  await seeking;assert.equal(video.currentTime,12);assert.equal(video.paused,false);assert.equal(state.snapshot().ended,false);
});
