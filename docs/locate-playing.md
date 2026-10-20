# 双端定位正在播放

Windows 和 Android 播放栏新增“定位正在播放”。目标由当前快照的 currentKey、playbackPlaylistId、playlists 和 tracks 决定，不按浏览歌单或曲目标题猜测。

## 行为

- 来源仍有效时只发送原有 playlist-select，返回真正播放来源。Windows 清空歌单关键词和平台筛选；Android 清空歌单关键词并回到歌单页，关闭遮挡的面板。
- 自动滚动、突出歌曲并移动键盘焦点；重复点击可再次突出。减少动态效果的系统偏好受尊重。Android 按钮保持至少 44×44 触控区域。
- 定位不发送 play、pause、seek、next 或增删歌单命令，不修改播放队列/来源、进度或播放暂停状态。同一首歌属于多个歌单时，仍选择实际播放来源。
- 无当前歌曲、搜索试听无来源、来源被删除、歌曲移出来源分别反馈原因，不自动收藏、建立歌单或选择另一个含同曲的歌单。
- 跨歌单切换需同时等到命令确认和相应状态快照；等待期间锁定重复请求。曲目/来源/播放 generation 改变即取消旧请求，不突出陈旧目标。5 秒没有收到状态则提示重试，切换失败保留错误反馈。
- Android 保留在线搜索查询及平台选择，因为它们不筛选目标歌单页。Windows 按基线原有流程在跨歌单后清空在线结果，需要重新搜索；本项没有改变该行为。

## 实现与依赖

共享纯函数 `app/ui/locate-playing.js` 供两端使用；Windows HTML 引入，Android build-web 将其与已存在的 search-match/sleep-timer 一起打包。不新增框架、后端命令、原生桥协议或存储字段。

基于已合并 P01～P03 的上游 main，保留其脚本列表和移动设置页定时器刷新。相对该基线仅新增定位及验证，不包含 P04、背景、图标或搜索入口改名。两个既有 UI 测试夹具仅补齐新脚本加载清单，避免模拟页面遗漏生产依赖。

## 验证

使用项目 Node 和既有 Edge/Electron，先安装 app 的现有开发依赖并生成 Web 包：

```powershell
node --test app/test/*.test.cjs android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs
node android/build-web.cjs
node --test app/test/locate-playing-ui.cjs android/locate-playing-ui.cjs
node --test tools/search-add-feedback-ui.cjs tools/sleep-timer-ui.cjs tools/sleep-timer-android-runtime.cjs
$env:MIXTUNES_LOCATE_EXECUTABLE='本分支构建目录\win-unpacked\MixTunes.exe'
node --test tools/locate-playing-integration.cjs
$env:MIXTUNES_SEARCH_EXECUTABLE=$env:MIXTUNES_LOCATE_EXECUTABLE
node --test tools/search-add-integration.cjs
```

UI 测试覆盖长歌单滚动、窄屏/深色/减少动画、播放暂停、跨歌单、各种无目标原因、确认先于状态、重复点击、超时和等待期间目标改变。

新增集成测试分别使用实际打包 Windows IPC/引擎/存储、源码 Electron 的本地合成静音 PCM，以及生成的 Android runtime 与模拟原生桥。核查定位不重载、暂停、跳进度或激活音频，暂停不恢复；跨歌单时同曲属于两个歌单，P03 标记保持两个归属且没有添加操作。真实 PCM 自然 buffering/playing 事件允许正常转换，以无后端控制调用、相同 generation/队列和进度连续作为核查依据。

Android runtime 的 playing 状态由测试直接注入真实引擎，桥的音频/存储为替身；这不代表 Android 真机播放。打包 Windows 测例覆盖真实 EXE 的暂停状态；持续播放由同分支源码的真实 Electron 音频链路配合合成 PCM 验证。没有真实账号联网测听或 Android 真机验收，自动化与包构建不能替代它们。

## 与其他实现的关系

上游 #19（c39a4d1）也有双端定位：来源切换、清筛选和滚动闪烁，Windows 还提供 L 键和按距离选择平滑/立即滚动，突出约 1.4 秒后移除。本实现没有新增 L 键；使用共享来源判断、明确的无目标原因、命令确认+状态快照+generation 校验、超时重试、焦点和减少动态效果；动画结束后轮廓保留直到列表重绘等后续变化。

两者不是必须同时采用的依赖关系，维护者可以分别选择。若 #19 先合并，应先确定保留哪个入口和控制流程，避免两个按钮/重复事件，再将需要保留的判断/竞态测试适配到选定实现；不可把两份完整 UI 文件相互覆盖。不对未经组合运行验证的行为作保证。
