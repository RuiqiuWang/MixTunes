# Android Issues #5、#6、#7 修复检查

上游：<https://github.com/RuiqiuWang/MixTunes>；Fork：<https://github.com/chloeagle/MixTunes>。

## 当前结论

| Issue | 已实现 | 验证与限制 |
| --- | --- | --- |
| [#5](https://github.com/RuiqiuWang/MixTunes/issues/5) 原始播放错误被覆盖 | Android 声明官方网页回退不可用，保留平台解析、试听权限或原生音频错误，不自动打开登录窗口；桌面回退保留 | 引擎测试及实际 Android Web 运行时的界面集成检查通过。此修复不新增 QQ／网易网页控制能力，也不保证所有直连音源可播 |
| [#6](https://github.com/RuiqiuWang/MixTunes/issues/6) B站视频黑屏 | 检查控制脚本初始化结果；在原生视频面板显示加载状态、页面／HTTP／媒体／渲染器失败及 30 秒未就绪提示；替换 video 后重新定位片段，忽略旧元素事件 | 9 项视频脚本测试及 Java 编译通过。用户手机的黑屏原因和播放效果尚未实机验证，不能标为完全解决 |
| [#7](https://github.com/RuiqiuWang/MixTunes/issues/7) 备份导入缺少反馈 | 显示恢复歌单数、新增及重复歌曲数、恢复位置；取消选择不提示成功；保持当前歌单与播放 | 5 项导入测试和实际页面按钮／歌单入口集成检查通过。原生系统文件选择器由测试替身模拟，仍需真机检查 |

## 已执行检查

- `node --test app/test/*.test.cjs android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs`：244 项全部通过。
- `node android/test-mobile-ui.cjs`：通过。使用实际生成的 Android 页面和运行时，检查导入提示、歌单入口、播放原始错误、取消导入、损坏备份保护及页面异常。文件选择、网络、存储、加密桥接由测试替身模拟；使用独立桌面浏览器，不是真机。
- `android/native/test-request-control.ps1`、`android/native/test-qq-mobile-login.ps1`：Java 测试通过。
- `node android/build-web.cjs` 及 `android/native/build.ps1`：通过。Android 35 SDK 和 JDK 17 编译全部 Java 源码；验证 APK 签名、对齐及 manifest。
- 原包名、独立评审包名均构建成功；评审 APK：`MixTunes-android-1.0.1-review-debug.apk`，应用名称 `MixTunes Review`，包名 `local.mixtunes.mobile.review`。

界面检查可通过 `MIXTUNES_PLAYWRIGHT_MODULE` 指定 `playwright-core` 模块路径，通过 `MIXTUNES_BROWSER` 指定 Chromium／Edge 可执行文件；默认读取 `app/node_modules/playwright-core`。

## 真机验收步骤

1. 安装独立评审版，保留原版。评审版需重新登录平台，可用原版“导出备份”的 JSON 恢复歌单。
2. #5：尝试原来失败的 QQ／网易歌曲，记录当前显示的平台／音频错误。确认不再被“手机版暂不支持控制官方网页播放”覆盖，也不自动弹登录页。另试一首有权限的歌曲，检查正常播放和暂停。
3. #6：在评审版登录 B站，尝试至少两个原来黑屏的普通视频。记录手机型号、Android 和 System WebView 版本、视频链接及出现的具体提示。检查有画面、有声音、暂停／恢复、拖动、片段终点、收起重开及快速切换；若失败，保留提示和对应 logcat，不关闭 Issue。
4. #7：从系统选择器导入原版导出的 JSON。确认出现恢复／新增结果，并在“歌单 → 歌单列表”找到恢复歌单；取消选择不报成功；损坏 JSON 显示错误且现有歌单保留。导入期间原有播放不切歌。

USB 调试设备尚未识别时，仅能完成桌面自动化与构建检查，不能据此宣称真机播放已修复。

## Git 记录

- `codex/fix-5-android-playback-errors`：`ef041c7`，合并 `d5a7a33`。
- `codex/fix-7-backup-import-feedback`：`5ab5e08`，合并 `6bfcf90`。
- `codex/fix-6-video-loading`：`10928ff`，合并 `2ff0c6e`。
- 集成分支：`codex/android-debug-review`。构建／界面验收支持单独提交后合入集成分支。

三个 Issue 已先于修复创建。本地分支／提交用于用户评审；上游 PR、Issue 关闭与主仓库合并需等待评审和真机结果。
