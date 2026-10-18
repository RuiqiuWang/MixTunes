'use strict';

// Serialized after the shared official-page controller. Remote pages receive no
// Android bridge. Only the native host reads the bounded snapshot via evaluation.
function mobileQqBootstrap(bridge) {
  if (bridge.mobile) return true;
  bridge.mobile = true;
  bridge.needsGesture = false;
  const button = document.createElement('button');
  button.textContent = '点击播放';
  button.setAttribute('aria-label', '点击播放QQ音乐');
  button.style.cssText = 'position:fixed;left:50%;top:35%;transform:translate(-50%,-50%);z-index:2147483647;padding:18px 32px;border:0;border-radius:28px;background:#31c27c;color:#fff;font-size:22px';
  button.hidden = true;
  (document.body || document.documentElement).appendChild(button);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function (...args) {
    const generation = bridge.generation;
    if (bridge.track && bridge.currentId() && bridge.currentId() !== bridge.expectedId) {
      this.pause(); bridge.lastError = '官方网页已切换到其他歌曲，请从 MixTunes 歌单选择播放'; return;
    }
    try {
      const result = await play.apply(this, args);
      if (generation !== bridge.generation) return result;
      if (!this.paused) { bridge.needsGesture = false; button.hidden = true; }
      return result;
    } catch (error) {
      if (generation !== bridge.generation || !bridge.requestedPlay || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        bridge.needsGesture = true; button.hidden = false; return;
      }
      bridge.lastError = 'QQ 官方网页播放失败：' + (error.name || '媒体加载失败');
    }
  };
  const configure = bridge.configure;
  bridge.configure = config => {
    bridge.needsGesture = false; button.hidden = true;
    return configure(config);
  };
  const command = bridge.command;
  bridge.command = async (name, value) => {
    if (name === 'pause') { bridge.needsGesture = false; button.hidden = true; }
    return command(name, value);
  };
  button.addEventListener('click', () => {
    if (!bridge.requestedPlay) { button.hidden = true; return; }
    bridge.command('play').catch(error => { bridge.lastError = error.message; });
  });
  const snapshot = bridge.snapshot;
  bridge.snapshot = () => ({ ...snapshot(), needsGesture: bridge.needsGesture, error: bridge.lastError });
  return true;
}
module.exports = { mobileQqBootstrap };
