# 双端睡眠定时器

Windows 点击歌单标题旁的“设置”，Android 打开“设置 → 睡眠定时器”。可选 15／30／60 分钟，或输入 1～240 的整数分钟。到期仅暂停当前实际播放内容，保留歌曲、进度、队列与播放模式，不退出程序或自动切歌。

同时只有一个有效定时器。重新设置替换旧截止时间；取消只取消计时，不改变播放。非法输入不覆盖有效定时器。关闭设置、换歌、暂停/继续、最小化或 Android 前后台切换不取消计时。真正退出或系统终止进程后不恢复计时，不写入歌单、备份或账号数据。

## 独立接入与实现

- 本功能可直接用于原版 MixTunes，不依赖新增托盘生命周期、背景、图标或歌曲定位。Windows 关闭窗口后保留托盘、播放和定时器；使用退出命令结束进程。
- Windows 主进程 `app/src/sleep-timer.cjs` 保存唯一截止时间 endsAt。提前回调重新调度，延后回调按截止时间结算，旧回调不能触发替换后的计时。退出时清理。IPC `app:sleep-timer` 提供 get/set/cancel，preload 暴露查询和状态订阅。
- Android `SleepTimer` 是纯 JVM 截止时间核心，`SleepTimerHost` 是进程级宿主，使用 elapsedRealtime、主线程 Handler，Activity 重建不创建第二个权威计时器。UI 只查询/展示剩余时间。
- Handler 使用 uptimeMillis，深睡眠期间回调可能延后；Activity onResume、状态查询执行 expireIfDue(true) 补结算，开始新播放前 expireIfDue(false) 静默清除过期定时器，避免旧截止时间打断新播放。
- Android 共享面板的 get 映射到原生 sleep-timer-state，set/cancel 对应各自桥方法；重新进入设置或恢复后从原生查询，不依赖页面保留的倒计时。
- 原生到期仅在 AudioController.playing() 为真时 pauseAll，再发送 sleep-timer-expired 给存活 Activity 的 WebView，并刷新媒体服务。runtime 对 playing/buffering/loading 调用既有 engine.pause()；已暂停/空闲不重复暂停，不会恢复播放。原版引擎的暂停后端路径保持不变。
- 共用 `app/ui/sleep-timer.js` 不持有权威计时；Android build-web 仅追加此面板与计时核心模块，不引入其他功能资源。
- 不增加权限、AlarmManager、WakeLock 或常驻服务；不能承诺所有系统省电策略下精确唤醒暂停。Android 原版不支持的官方网页备用播放控制仍不受支持。

## 本功能验证命令

```powershell
node --test app/test/*.test.cjs android/native/test-*.cjs
node android/build-web.cjs
node --test tools/sleep-timer-ui.cjs tools/sleep-timer-android-runtime.cjs
# 指向本分支构建的解包 EXE；测试使用新临时资料目录。
$env:MIXTUNES_SLEEP_EXECUTABLE='<本分支 MixTunes.exe>'
node --test tools/sleep-timer-electron.cjs
# JAVA_HOME 仅在当前进程指向项目现有 JDK。
./android/native/test-sleep-timer.ps1
./android/native/test-request-control.ps1
./android/native/test-qq-mobile-login.ps1
```

Windows Electron 测试仅在 --test-mode 下使用秒级计时和状态注入，检查正常窗口、最小化、取消/替换、已暂停不恢复、非零进度/队列保持，关闭到托盘后继续计时及显式退出。它不是三平台真实账号测听。

Android runtime 测试执行生成的实际 bundle 和真实 PlayerEngine，模拟原生桥并以 NativeBridge 中接受的方法名约束接口；验证查询、设置、取消、面板重建、到期状态同步和恢复刷新。JVM 测试覆盖深睡眠延迟回调、补结算、单次到期和静默清除。这些都不等同于 Android 设备后台/锁屏验收。

## 仍需设备验收

- Windows：真实 QQ／网易云／Bilibili 播放到期暂停，最小化后计时继续，原生媒体控制和视频视图状态保持。
- Android：真实锁屏/后台的暂停时机、通知栏同步、Activity 重建、深睡眠唤醒补结算、不同厂商省电策略与 WebView 版本。
- 系统杀进程后不恢复定时；不实现音量渐弱、定时关机或自动切换歌单。
- 本项不修复音视频切换进度或 QQ 在线搜索失败。

到期先取消尚未完成的搜索播放及视频请求，再按当前状态暂停后端。未播放或手动暂停时也会取消过期前的请求；到期后新发起的播放不受影响。

回归：`node --test tools/sleep-timer-race.cjs` 使用独立资料目录及静音合成音频验证延迟搜索请求不会在到期后启动。
