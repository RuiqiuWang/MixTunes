'use strict';

const MODES = new Set(['sequential', 'repeat-all', 'repeat-one', 'shuffle']);

class QueueModel {
  constructor({ keys = [], mode = 'sequential', random = Math.random } = {}) {
    this.keys = [...new Set(keys)];
    this.mode = MODES.has(mode) ? mode : 'sequential';
    this.currentKey = null;
    this.history = [];
    this.bag = [];
    this.shuffleStarted = false;
    this.random = random;
  }
  setKeys(keys) {
    this.keys = [...new Set(keys)];
    this.history = this.history.filter(k => this.keys.includes(k));
    if (!this.keys.includes(this.currentKey)) this.currentKey = null;
    this.bag = [];
    this.shuffleStarted = false;
  }
  setMode(mode) {
    if (!MODES.has(mode)) throw new Error('不支持的播放模式');
    this.mode = mode;
    this.bag = [];
    this.shuffleStarted = false;
  }
  select(key, { history = true } = {}) {
    if (!this.keys.includes(key)) throw new Error('歌曲已不在播放列表中');
    if (history && this.currentKey && this.currentKey !== key) this.history.push(this.currentKey);
    this.currentKey = key;
    // A shuffle bag only holds one cycle. Remove the played occurrence, not
    // every future occurrence, so a planned repeat later in the bag survives.
    const index = this.bag.indexOf(key);
    if (index !== -1) this.bag.splice(index, 1);
    if (this.history.length > 1000) this.history.splice(0, this.history.length - 1000);
    return key;
  }
  shuffled(keys) {
    const result = [...keys];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(this.random() * (i + 1))));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  fillBag() {
    // Current item already counts as visited in the first cycle.
    this.bag = this.shuffled(this.shuffleStarted ? this.keys : this.keys.filter(k => k !== this.currentKey));
    if (!this.bag.length) this.bag = this.currentKey ? [this.currentKey] : [];
    if (this.bag.length > 1 && this.bag[0] === this.currentKey) {
      [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]];
    }
    this.shuffleStarted = true;
  }
  peekNext({ natural = true, failed = false } = {}) {
    if (!this.keys.length) return null;
    if (!this.currentKey) return this.keys[0];
    if (this.mode === 'repeat-one' && natural && !failed) return this.currentKey;
    if (this.mode === 'shuffle') {
      if (!this.bag.length) this.fillBag();
      return this.bag[0] || null;
    }
    const index = this.keys.indexOf(this.currentKey);
    if (index + 1 < this.keys.length) return this.keys[index + 1];
    if (this.mode === 'repeat-all' || failed) return this.keys[0];
    return null;
  }
  next(options = {}) {
    const key = this.peekNext(options);
    if (key) this.select(key);
    return key;
  }
  previous() {
    while (this.history.length) {
      const key = this.history.pop();
      if (this.keys.includes(key)) return this.select(key, { history: false });
    }
    if (this.mode === 'shuffle') return this.currentKey;
    const index = this.keys.indexOf(this.currentKey);
    return index > 0 ? this.select(this.keys[index - 1], { history: false }) : this.currentKey;
  }
  // Upcoming keys in the order the real player will pick them. Shuffle reads
  // the live bag without consuming it, so repeated refresh never rerolls and
  // preview[0] is exactly what next() will select. One shuffle cycle is shown;
  // when the bag is nearly empty the list is deliberately short rather than
  // inventing songs from a cycle that has not been shuffled yet.
  upcoming(limit = 50) {
    const max = Math.max(0, Math.floor(Number(limit) || 0));
    if (!max || !this.keys.length) return [];
    if (!this.currentKey) return this.keys.slice(0, max);
    if (this.mode === 'repeat-one') return [];
    if (this.mode === 'shuffle') {
      if (!this.bag.length) this.fillBag();
      return this.bag.slice(0, max);
    }
    const index = this.keys.indexOf(this.currentKey);
    if (index < 0) return [];
    if (this.mode === 'repeat-all') {
      return this.keys.slice(index + 1).concat(this.keys.slice(0, index)).slice(0, max);
    }
    return this.keys.slice(index + 1, index + 1 + max);
  }
  // Reorder one visible upcoming slot. Indexes refer to upcoming(), which is
  // also the drag model in the UI; using an index keeps a shuffle cycle's
  // repeated keys unambiguous.
  moveUpcomingAt(fromIndex, toIndex, { limit = 50 } = {}) {
    if (this.mode === 'repeat-one') throw new Error('单曲循环下不能调整待播顺序');
    const span = this.mode === 'shuffle' ? Math.max(1, Math.floor(Number(limit) || 50)) : Math.max(this.keys.length, 1);
    const list = this.upcoming(span);
    if (!list.length) throw new Error('当前没有待播歌曲');
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || from < 0 || from >= list.length) throw new Error('待播位置无效');
    if (!Number.isInteger(to)) throw new Error('目标位置无效');
    const target = Math.max(0, Math.min(list.length - 1, to));
    const [key] = list.splice(from, 1);
    list.splice(target, 0, key);
    if (this.mode === 'shuffle') {
      // The visible list is the front of the real bag. Rebuild only that prefix
      // and keep the untouched tail, then next() / peekNext() consume this bag.
      this.bag = [...list, ...this.bag.slice(list.length)];
    } else if (!this.currentKey) {
      this.keys = [...list];
    } else if (this.mode === 'repeat-all') {
      // A repeat-all cycle can be rotated so the moved wrapped item is truly
      // next; the playlist itself is never touched (QueueModel owns a copy).
      this.keys = [this.currentKey, ...list];
    } else {
      const index = this.keys.indexOf(this.currentKey);
      this.keys = [...this.keys.slice(0, index + 1), ...list];
    }
    if (this.mode !== 'shuffle') {
      this.bag = [];
      this.shuffleStarted = false;
    }
    return key;
  }
  moveUpcoming(key, toIndex, { limit = 50 } = {}) {
    if (this.mode === 'repeat-one') throw new Error('单曲循环下不能调整待播顺序');
    const span = this.mode === 'shuffle' ? Math.max(1, Math.floor(Number(limit) || 50)) : Math.max(this.keys.length, 1);
    const list = this.upcoming(span);
    const from = list.indexOf(key);
    if (from < 0) throw new Error('歌曲不在待播队列中');
    return this.moveUpcomingAt(from, toIndex, { limit });
  }
  playNext(key) {
    if (!this.keys.includes(key)) throw new Error('歌曲已不在播放列表中');
    if (key === this.currentKey) return key;
    if (this.mode === 'repeat-one') throw new Error('单曲循环下不能设置下一首');
    if (this.mode === 'shuffle') {
      if (!this.bag.length) this.fillBag();
      const index = this.bag.indexOf(key);
      if (index !== -1) this.bag.splice(index, 1);
      this.bag.unshift(key);
      return key;
    }
    const rest = this.keys.filter(k => k !== key);
    if (!this.currentKey) {
      rest.unshift(key);
    } else {
      const index = rest.indexOf(this.currentKey);
      if (index < 0) rest.unshift(key);
      else rest.splice(index + 1, 0, key);
    }
    this.keys = rest;
    this.bag = [];
    this.shuffleStarted = false;
    return key;
  }
}

module.exports = { QueueModel, MODES };
