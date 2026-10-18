# Android 1.0.6-review 验收说明

本轮面向 `chloeagle/MixTunes` 的安卓改进。按最新要求暂停 #9，本次追加修改只重新设计 #17，PR 等待用户安装验收，不自动合并或向上游提交。Windows 已完成的界面保留，公共引擎的网页优先策略仅由 Android 适配器启用。

## 修改与操作路径

| Issue | 修改与验收步骤 |
| --- | --- |
| #9 QQ 登录与播放 | 设置 → QQ 音乐登录，只打开官方电脑网页的登录组件；移除 MixTunes 的“手机登录”切换及 QQ 客户端回跳。完成网页登录后点击“完成”，再从歌单播放 QQ 歌曲。播放器使用同一 WebView CookieManager 的官网页面，不先请求直连音源。没有原始歌曲资料的旧备份需重新导入歌曲／歌单链接。可通过“收起网页”和音乐条的“网页播放器”切换显示；若网页要求手势，点击网页中央的“点击播放”。 |
| #10 B站全屏 | 视频右上角“全屏／退出全屏”；系统返回键优先退出全屏。沿用同一 WebView 和媒体，保留播放进度、音量及暂停状态；恢复此前面板大小。另支持官网 HTML 视频的自定义全屏回调。 |
| #11 文件导入 | 设置 → 导入文件，显示选择／读取状态，完成后保留新增、恢复歌单和重复数量及去哪里查看的提示；取消和失败也有持续反馈。损坏备份不破坏原歌单。 |
| #12 隐藏音乐条 | 设置和搜索页隐藏底部播放器并释放布局空间；返回歌单后恢复。仅改变展示，播放继续。 |
| #13 批量移除 | 歌单 → 批量管理，勾选多首或全选筛选结果，确认后从当前歌单移除。其他歌单保留相同歌曲，切换歌单清空选择。已捕获的播放队列继续播放。 |
| #14 启动图标 | 使用独立的音乐图标及自适应圆／方裁切资源，替换系统占位图标。不强制创建主屏快捷方式；使用应用列表里的 MixTunes Review 入口。 |
| #15 动态播放标记 | 当前歌曲序号位置显示音柱；只有实际 playing 状态播放动画，暂停／失败时静止。尊重系统减少动画设置。 |
| #16 实时音量 | 拖动时向当前后端发送音量，快速拖动保留最新值，操作结束再保存。分别试音频、QQ 网页和 B站视频。 |
| #17 批量添加到其他歌单 | 来源歌单 → 批量管理 → 勾选多首／全选筛选结果 → 添加到其他歌单 → 选目标 → 确认。与批量移除共用选择，撤掉独立的整张歌单导入入口。仅复制选中歌曲，来源保留、目标去重；新增歌曲按来源顺序放到目标前部，目标原有歌曲相对顺序不变。未选歌曲时两个操作均不可用；取消保留选择，完成后清空选择。 |

## 已验证的范围

- `node --test app/test/*.test.cjs`：244 项公共逻辑测试通过，包括歌单复制、去重及当前播放保护、网页优先策略和异步暂停。桌面适配器不启用网页优先策略。
- `node --test android/native/test-video-bootstrap.cjs android/native/test-qq-web-login.cjs`：15 项通过，覆盖 B站媒体手势、定位、异常和网页登录入口范围。
- JDK 17 的 `test-request-control.ps1`、`test-video-navigation.ps1`、`test-qq-mobile-login.ps1`：通过。
- 使用独立 Edge 运行 `android/test-mobile-ui.cjs`、`android/test-library-tools.cjs`：真实移动端页面和打包运行时的导入反馈、歌单操作、隐藏播放器释放空间、动画、实时音量及 QQ 网页调用合约通过。原生桥与文件选择器使用测试替身。
- `android/test-video-gesture.cjs`、`android/test-qq-web-player.cjs`：真实浏览器媒体在无手势时触发 NotAllowedError，真实点击后恢复；暂停、网页音量、进度、片段终点和歌曲身份检查通过。QQ 网页接口在此媒体测试中使用本地模型。
- 匿名、隔离的浏览器访问实际 `https://y.qq.com/portal/player.html`：官网播放器 `setPlayerList` 和 `playAnyPos` 接口可加载。未使用用户登录凭据，此结果不证明账号登录或会员歌曲播放成功。
- 生成网页资源后，Android 35 SDK / JDK 17 编译、资源链接、APK 对齐、签名验证及 manifest 检查通过。未提交 APK 或签名密钥。

本机未完成 Android 实机验收。QQ 官网接口属于网站内部实现，可能变化；Android WebView、账号权限和平台限制仍会影响播放。#9 应在手机完成网页登录和有权限歌曲播放后再判定修复。B站全屏的返回键、横竖屏及启动器图标外观也需要在手机确认。

## 安装与反馈

评审包：`MixTunes-android-1.0.6-review-debug.apk`，versionCode 10，应用标识 `local.mixtunes.mobile.review`，名称 **MixTunes Review**。复用本地既有评审签名，可覆盖同签名旧评审版；与原正式版并存。安装后先确认版本和图标，再按表逐项验证。现有备份不包含登录凭据，请在评审版单独登录。

验收 QQ 时请分别记录：是否打开官网登录组件、完成后账号状态、普通有权限歌曲能否开始播放、暂停／恢复和切歌。不要把网页可打开当成登录成功，也不要把播放器可加载当成音频已播放。发生错误时提供提示文字即可，不需要密码、验证码或 Cookie。

## Git 组织

- 本次批量选歌添加调整：`codex/android-batch-playlist-copy`，独立提交后通过 merge commit 合入集成分支。

- 集成：`codex/android-improvements-review`，从 fork main 开始，合入先前暂停的安卓诊断工作。
- 歌单及交互：`codex/android-library-tools`，提交 `16c1eeb`，通过 merge commit 合入。
- 全屏及图标：`codex/android-fullscreen-icon`，提交 `02580a4`，通过 merge commit 合入。
- QQ 网页：`codex/android-qq-web-player`，提交 `6de5054`，通过 merge commit 合入。
- 最终测试与文档：`codex/android-improvements-validation`，完成后合入集成分支。

构建时先运行 `node android/build-web.cjs`；它同时生成本地运行时和 `official-qq-player.js`，在忽略的 `web-bundle-verification.json` 中记录两者 SHA-256。官方远程网页不注入 JavascriptInterface，仅由原生侧注入控制器并读取状态；原生桥只存在于锁定导航的本地 UI。
