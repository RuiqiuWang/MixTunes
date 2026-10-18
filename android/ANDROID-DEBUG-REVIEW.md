# Android Issues #5、#6、#7 修复检查

> 这是早期评审包的历史记录。当前 1.0.6-review 的 QQ 单一网页登录与网页播放，以及 fork 中 #9–#17 的验收信息，见 [当前 Android 评审说明](ANDROID-IMPROVEMENTS-REVIEW.md)。下文的旧包名、旧 QQ 手机登录选项和测试文件名不再代表当前实现。

上游：<https://github.com/RuiqiuWang/MixTunes>；Fork：<https://github.com/chloeagle/MixTunes>。

## 当前结论

| Issue | 已实现 | 验证与限制 |
| --- | --- | --- |
| [#5](https://github.com/RuiqiuWang/MixTunes/issues/5) 原始播放错误被覆盖 | Android 声明官方网页回退不可用，保留平台解析、试听权限或原生音频错误，不自动打开登录窗口；桌面回退保留 | 引擎测试及实际 Android Web 运行时的界面集成检查通过。此修复不新增 QQ／网易网页控制能力，也不保证所有直连音源可播 |
| [#6](https://github.com/RuiqiuWang/MixTunes/issues/6) B站视频黑屏 | 修正官方 301 跳转被拦截；页面加载前配置媒体播放，并在 `NotAllowedError` 时提供真实点击恢复。另有初始化检查、加载／失败提示及 video 替换处理 | 20 项 Java 导航检查、12 项视频脚本测试及真实浏览器手势恢复检查通过。用户已确认地址修复后可显示页面，最新播放恢复仍需手机验证 |
| [#7](https://github.com/RuiqiuWang/MixTunes/issues/7) 备份导入缺少反馈 | 显示恢复歌单数、新增及重复歌曲数、恢复位置；取消选择不提示成功；保持当前歌单与播放 | 5 项导入测试和实际页面按钮／歌单入口集成检查通过。原生系统文件选择器由测试替身模拟，仍需真机检查 |
| [#8](https://github.com/RuiqiuWang/MixTunes/issues/8) QQ 登录失败 | 移除手工拼接的授权／密码地址；通过当前官方桌面页生成登录流程，保留官方手机入口 | Java 与脚本检查通过；匿名真实页面可以打开当前密码／扫码组件。未验证用户账号登录或授权歌曲播放 |

## 已执行检查

- `node --test app/test/*.test.cjs android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs`：第三轮 250 项全部通过（前两轮 244 项）。
- `node android/test-mobile-ui.cjs`：通过。使用实际生成的 Android 页面和运行时，检查导入提示、歌单入口、播放原始错误、取消导入、损坏备份保护及页面异常。文件选择、网络、存储、加密桥接由测试替身模拟；使用独立桌面浏览器，不是真机。
- `android/native/test-request-control.ps1`、`android/native/test-qq-mobile-login.ps1`：Java 测试通过。
- `android/native/test-video-navigation.ps1`：20 项检查通过；允许同一视频规范地址及跟踪参数，拒绝其他视频、分 P、域名、协议及不明确的分 P 参数。
- `node android/build-web.cjs` 及 `android/native/build.ps1`：通过。Android 35 SDK 和 JDK 17 编译全部 Java 源码；验证 APK 签名、对齐及 manifest。
- 原包名、独立评审包名均构建成功；评审 APK：`MixTunes-android-1.0.1-review-debug.apk`，应用名称 `MixTunes Review`，包名 `local.mixtunes.mobile.review`。

界面检查可通过 `MIXTUNES_PLAYWRIGHT_MODULE` 指定 `playwright-core` 模块路径，通过 `MIXTUNES_BROWSER` 指定 Chromium／Edge 可执行文件；默认读取 `app/node_modules/playwright-core`。

## 真机验收步骤

1. 安装独立评审版，保留原版。评审版需重新登录平台，可用原版“导出备份”的 JSON 恢复歌单。
2. #5：尝试原来失败的 QQ／网易歌曲，记录当前显示的平台／音频错误。确认不再被“手机版暂不支持控制官方网页播放”覆盖，也不自动弹登录页。另试一首有权限的歌曲，检查正常播放和暂停。
3. #6：在评审版登录 B站，尝试至少两个原来黑屏的普通视频。记录手机型号、Android 和 System WebView 版本、视频链接及出现的具体提示。检查有画面、有声音、暂停／恢复、拖动、片段终点、收起重开及快速切换；若失败，保留提示和对应 logcat，不关闭 Issue。
4. #7：从系统选择器导入原版导出的 JSON。确认出现恢复／新增结果，并在“歌单 → 歌单列表”找到恢复歌单；取消选择不报成功；损坏 JSON 显示错误且现有歌单保留。导入期间原有播放不切歌。

USB 调试设备尚未识别时，仅能完成桌面自动化与构建检查，不能据此宣称真机播放已修复。

## 第二轮手机反馈与定位

用户确认网易云可播放，但 QQ 仍无法登录／播放，B站仍不能播放。上一轮诊断和状态修复不足以解决全部播放问题。

B站已定位到真实地址不匹配：`app/src/providers.cjs` 导入地址为 `/video/BV...`（分 P 为 `?p=N`），官方服务器回复 301 跳转至 `/video/BV.../`（分 P 为 `/?p=N`）。旧 Android 导航策略只允许字符串完全相同或原地址追加 `?`，会拒绝这个正常跳转。第二轮将输入规范化，并按视频 ID 和分 P 判定同一视频，避免依赖字符串前缀。检查使用 `BV1xx411c7mD`，无登录凭据；匿名隔离浏览器中该视频可以启动并推进进度，不代表 Android 实机验证。

QQ 用户补充：已安装最新版 QQ，默认一键登录仍弹出“请下载最新版 QQ 才能使用一键登录”。另行提交 [#8](https://github.com/RuiqiuWang/MixTunes/issues/8) 后，在 `codex/fix-8-qq-login-entry` 修复默认入口：首先展示官方账号密码页（保留 `pt_no_onekey=1`），QQ 快捷登录改为主动选择，并提供遇到版本误报时切换账号密码的说明。“账号密码”匿名页面可加载；未尝试登录用户账号，真实账号登录和授权歌曲播放仍需手机验收。不能将 QQ 登录失败直接归因于歌曲权限。

新评审包 `MixTunes-android-1.0.3-review-debug.apk`（versionCode 7）包含 #6 地址跳转修复和 #8 登录入口调整，可覆盖既有 `MixTunes Review`，保留其应用数据。

## 第三轮：B站 NotAllowedError

用户确认地址修复后已能显示 B站页面，随后报 `NotAllowedError`。专用视频 WebView 在首次导航前允许媒体播放，不再在页面开始加载时重新启用手势限制。若平台仍要求手势，控制器显示网页内“点击播放”按钮，等待真实点击；不会将此状态当作终止错误，也不会被播放加载计时器误判为超时。暂停会取消待点击播放，`AbortError` 中断可重试，解码错误仍明确报告。

`node android/test-video-gesture.cjs` 在独立浏览器中使用本地 WAV 媒体、无用户手势的 CDP 命令重现真实 `NotAllowedError`，确认真实点击按钮后媒体开始推进、片段起点生效、暂停可用。未连接 Android 真机，该检查不能替代手机复测。登录页继续保留自己的媒体手势限制。

## 第三轮：QQ 授权拒绝

用户补充密码入口也显示“该应用未获得QQ登录权限”，故上一轮仅切换到手工构造的账号密码页不足以解决 #8。匿名检查发现当前 QQ 音乐官方桌面页会生成不同的登录服务参数，并提供密码／扫码表单；不能从表单可见推断真实授权成功。

本轮移除代码中手工构造的 OAuth、账号密码 URL 及其应用参数，默认打开 `https://y.qq.com/n/ryqq_v2/profile`，兼容官方旧路由，只触发该页面自己的登录按钮，由官方网页处理授权及回调。手机登录选项保留官方移动选择器，提示用户完成后刷新账号。官方远程页没有注入原生桥，也未读取用户在其他浏览器的会话。仍需用户在手机完成登录并确认账号验证及歌曲权限，不将该问题标为已完全解决。

最新评审包为 `MixTunes-android-1.0.4-review-debug.apk`（versionCode 8），包含本轮 #6、#8 调整，可覆盖已有 MixTunes Review。上一轮 1.0.3 的登录入口已被替换，请使用新包验收。

## Git 记录

- `codex/fix-5-android-playback-errors`：`ef041c7`，合并 `d5a7a33`。
- `codex/fix-7-backup-import-feedback`：`5ab5e08`，合并 `6bfcf90`。
- `codex/fix-6-video-loading`：`10928ff`，合并 `2ff0c6e`。
- `codex/fix-6-canonical-video-navigation`：`50db59d`；`codex/fix-6-video-user-gesture`：`38fd894`。
- #8 初次入口调整：`23ba49d`；根据新授权拒绝反馈，另在 `codex/fix-8-official-login-flow` 修正为当前官方页面流程。
- 集成分支：`codex/android-debug-review`。构建／界面验收支持单独提交后合入集成分支。

三个 Issue 已先于修复创建。本地分支／提交用于用户评审；上游 PR、Issue 关闭与主仓库合并需等待评审和真机结果。
