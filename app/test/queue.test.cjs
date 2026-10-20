'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QueueModel } = require('../src/queue.cjs');

test('sequential stops at end, repeat-all wraps, repeat-one permits explicit next', () => {
  const q = new QueueModel({ keys: ['a', 'b'] });
  q.select('a'); assert.equal(q.next({ natural: true }), 'b');
  assert.equal(q.next({ natural: true }), null);
  q.setMode('repeat-all'); assert.equal(q.next({ natural: true }), 'a');
  q.setMode('repeat-one'); assert.equal(q.next({ natural: true }), 'a');
  assert.equal(q.next({ natural: false }), 'b');
});
test('shuffle visits all remaining items once; peeking does not consume next', () => {
  const q = new QueueModel({ keys: ['a','b','c','d'], mode: 'shuffle', random: () => .25 });
  q.select('a');
  const peek = q.peekNext(); assert.equal(q.peekNext(), peek);
  const played = [q.currentKey, q.next(), q.next(), q.next()];
  assert.equal(new Set(played).size, 4);
  assert.equal(played[1], peek);
  const last = q.currentKey; assert.notEqual(q.next(), last);
});
test('previous follows playback history after shuffle and deleted items are omitted', () => {
  const q = new QueueModel({ keys: ['a','b','c'], mode: 'shuffle' });
  q.select('a'); q.select('c'); q.select('b');
  assert.equal(q.previous(), 'c');
  q.setKeys(['b','c']); assert.equal(q.previous(), 'c');
  assert.equal(q.currentKey, 'c');
});
test('failed repeat-one advances instead of retrying the same song forever', () => {
  const q = new QueueModel({ keys: ['a','b'], mode: 'repeat-one' });
  q.select('a'); assert.equal(q.next({ natural: true, failed: true }), 'b');
});
test('reorder preserves selected identity and invalid mode cannot mutate state', () => {
  const q = new QueueModel({ keys: ['a','b','c'] }); q.select('b');
  q.setKeys(['c','b','a']); assert.equal(q.peekNext(), 'a');
  assert.throws(() => q.setMode('bogus')); assert.equal(q.mode, 'sequential');
});
test('every complete shuffle cycle includes all songs without a repeated boundary',()=>{
  const q=new QueueModel({keys:['a','b','c','d'],mode:'shuffle',random:()=>.8});q.select('a');
  const first=[q.currentKey,q.next(),q.next(),q.next()];
  const second=[q.next(),q.next(),q.next(),q.next()];
  const third=[q.next(),q.next(),q.next(),q.next()];
  assert.equal(new Set(first).size,4);assert.equal(new Set(second).size,4);assert.equal(new Set(third).size,4);
  assert.notEqual(first.at(-1),second[0]);assert.notEqual(second.at(-1),third[0]);
});

test('upcoming previews the real order for all four modes without consuming it', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'sequential' });
  q.select('b');
  assert.deepEqual(q.upcoming(), ['c', 'd']);
  assert.deepEqual(q.upcoming(), ['c', 'd']);

  q.setMode('repeat-all');
  assert.deepEqual(q.upcoming(), ['c', 'd', 'a']);
  // One cycle only, so the current song is not invented before it is reached.
  assert.deepEqual(q.upcoming(10), ['c', 'd', 'a']);

  q.setMode('repeat-one');
  assert.deepEqual(q.upcoming(), []);

  q.setMode('shuffle');
  const first = q.upcoming(10);
  assert.equal(first.length, 3);
  assert.equal(first.includes('b'), false);
  assert.deepEqual(q.upcoming(10), first, 'a refresh must not reroll shuffle');
});

test('shuffle preview is stable and its first item is exactly what next() plays', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd', 'e'], mode: 'shuffle', random: () => .35 });
  q.select('a');
  const preview = q.upcoming(10);
  assert.equal(preview.length, 4);
  assert.equal(new Set(preview).size, 4);
  assert.equal(q.next(), preview[0]);
  assert.deepEqual(q.upcoming(10), preview.slice(1));
  assert.equal(q.next(), preview[1]);
  assert.deepEqual(q.upcoming(10), preview.slice(2));
});

test('dragging in shuffle rewrites the real bag and next() follows the preview', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd', 'e'], mode: 'shuffle', random: () => .4 });
  q.select('a');
  const beforeKeys = [...q.keys];
  const preview = q.upcoming(10);
  const moved = preview[3];

  q.moveUpcomingAt(3, 0, { limit: 10 });
  const after = q.upcoming(10);
  assert.equal(after[0], moved);
  assert.deepEqual(after, [moved, ...preview.slice(0, 3)]);
  assert.deepEqual(q.keys, beforeKeys, 'shuffle dragging must not touch the playlist copy order');
  assert.equal(q.bag[0], moved, 'the real shuffle bag itself was reordered');
  assert.equal(q.next(), moved);
  assert.deepEqual(q.upcoming(10), after.slice(1));
  assert.equal(q.next(), preview[0]);
});

test('dragging in shuffle is stable across repeated previews and uses key lookup too', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'shuffle', random: () => .2 });
  q.select('a');
  const preview = q.upcoming(10);
  const target = preview[2];
  q.moveUpcoming(target, 0, { limit: 10 });
  const settled = q.upcoming(10);
  assert.equal(settled[0], target);
  assert.deepEqual(q.upcoming(10), settled);
  assert.deepEqual(q.upcoming(10), settled);
  assert.equal(q.next(), target);
});

test('sequential dragging reorders only the upcoming suffix and next() obeys it', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'sequential' });
  q.select('b');
  assert.deepEqual(q.upcoming(), ['c', 'd']);
  q.moveUpcoming('d', 0);
  assert.deepEqual(q.keys, ['a', 'b', 'd', 'c']);
  assert.deepEqual(q.upcoming(), ['d', 'c']);
  assert.equal(q.next(), 'd');
  assert.equal(q.next(), 'c');
  assert.equal(q.next(), null);
});

test('repeat-all dragging can move a wrapped song to be genuinely next', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'repeat-all' });
  q.select('c');
  assert.deepEqual(q.upcoming(), ['d', 'a', 'b']);
  q.moveUpcoming('b', 0);
  assert.deepEqual(q.keys, ['c', 'b', 'd', 'a']);
  assert.deepEqual(q.upcoming(), ['b', 'd', 'a']);
  assert.equal(q.next(), 'b');
  assert.equal(q.next(), 'd');
  assert.equal(q.next(), 'a');
  assert.equal(q.next(), 'c');
});

test('play-next pins a song immediately after the current one for sequential and repeat-all', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'sequential' });
  q.select('c');
  q.playNext('a');
  assert.deepEqual(q.keys, ['b', 'c', 'a', 'd']);
  assert.equal(q.next(), 'a');
  assert.equal(q.next(), 'd');

  const wrap = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'repeat-all' });
  wrap.select('a'); wrap.playNext('d');
  assert.equal(wrap.next(), 'd');
  assert.equal(wrap.next(), 'b');
});

test('shuffle play-next moves the song to the front of the real bag exactly once', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd', 'e'], mode: 'shuffle', random: () => .6 });
  q.select('a');
  const preview = q.upcoming(10);
  const target = preview[2];
  q.playNext(target);
  assert.equal(q.bag.filter(k => k === target).length, 1);
  assert.deepEqual(q.upcoming(10), [target, ...preview.filter(k => k !== target)]);
  assert.equal(q.next(), target);
});

test('repeat-one preview and manual operations stay out of the way until the mode changes', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c'], mode: 'repeat-one', random: () => .5 });
  q.select('b');
  assert.deepEqual(q.upcoming(), []);
  assert.equal(q.next(), 'b');
  assert.throws(() => q.moveUpcoming('c', 0), /单曲循环/);
  assert.throws(() => q.playNext('c'), /单曲循环/);
  q.setMode('sequential');
  assert.deepEqual(q.upcoming(), ['c']);
  q.moveUpcoming('c', 0);
  assert.equal(q.next(), 'c');
});

test('manual reorder keeps previous/history and preload peeking compatible', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'sequential' });
  q.select('a'); assert.equal(q.next(), 'b');
  const peeked = q.peekNext();
  assert.equal(q.peekNext(), peeked, 'peeking does not consume or reroll');
  q.moveUpcoming('d', 0);
  assert.notEqual(q.peekNext(), peeked, 'the preloaded next is recalculated after a drag');
  assert.equal(q.next(), 'd');
  assert.equal(q.previous(), 'b');
  assert.equal(q.previous(), 'a');
});

test('shuffle preloading and dragging share one plan; previous still walks history', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd', 'e'], mode: 'shuffle', random: () => .3 });
  q.select('a');
  const peeked = q.peekNext();
  assert.equal(q.upcoming(10)[0], peeked, 'the preloaded next is the first preview row');
  const preview = q.upcoming(10);
  const moved = preview.at(-1);
  q.moveUpcomingAt(preview.length - 1, 0, { limit: 10 });
  assert.equal(q.bag[0], moved);
  assert.equal(q.next(), moved);
  assert.equal(q.previous(), 'a');
  assert.equal(q.currentKey, 'a');
});

test('shuffle preview and actual playback stay aligned across cycles and drags', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
  const q = new QueueModel({ keys, mode: 'shuffle', random });
  q.select('a');
  for (let step = 0; step < 30; step++) {
    const preview = q.upcoming(20);
    assert.ok(preview.length > 0, `cycle ${step} has a real upcoming plan`);
    assert.equal(q.peekNext(), preview[0], `peek matches preview at step ${step}`);
    if (step % 5 === 2 && preview.length > 1) {
      const moved = preview.at(-1);
      q.moveUpcomingAt(preview.length - 1, 0, { limit: 20 });
      assert.equal(q.upcoming(20)[0], moved);
      assert.equal(q.next(), moved);
    } else {
      assert.equal(q.next(), preview[0]);
    }
    assert.deepEqual(q.keys, keys, 'shuffle dragging never rewrites the playlist copy order');
  }
});

test('repeat-all preview stays aligned with actual playback including the wrap', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c', 'd'], mode: 'repeat-all' });
  q.select('a');
  const played = [];
  for (let i = 0; i < 4; i++) {
    const preview = q.upcoming(10);
    assert.equal(preview[0], q.peekNext());
    played.push(q.next());
  }
  assert.deepEqual(played, ['b', 'c', 'd', 'a']);
  assert.equal(q.currentKey, 'a');
});

test('queue edits validate limits and positions without corrupting state', () => {
  const q = new QueueModel({ keys: ['a', 'b', 'c'], mode: 'sequential' });
  q.select('a');
  assert.throws(() => q.moveUpcomingAt(-1, 0), /待播位置/);
  q.moveUpcomingAt(0, 999);
  assert.deepEqual(q.upcoming(), ['c', 'b'], 'out-of-range target is clamped to the last slot');
  assert.throws(() => q.moveUpcoming('missing', 0), /不在待播队列/);
  assert.deepEqual(q.upcoming(), ['c', 'b']);
});
