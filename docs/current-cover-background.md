# 当前播放封面背景

Windows：打开顶部的“设置”，将“背景模式”设为“当前播放封面”。Android：打开“设置 → 外观”，选择同名模式。默认使用主题背景，选择“默认主题背景”后立即恢复原有浅色或深色界面。

背景取自实际播放内容的 `coverUrl`，支持 QQ 音乐、网易云和 Bilibili 静态视频封面。暂停保留背景，搜索试听使用实际试听内容；浏览其他歌单、筛选或显示搜索结果不改变背景。没有有效播放内容、封面缺失、不安全地址或图片加载失败时回退到主题背景。

## 本机设置与安全

在当前设备的 localStorage 中保存 `mixtunes-background-mode`，支持 `theme`、`current-cover` 和 `custom`，以及本机效果参数。不保存上次封面 URL，不增加歌单字段，不随导出、分享或导入传递。自定义图片使用独立私有文件，详见自定义背景说明。存储不可用时，本次会话仍可使用，设置中提示无法持久化。

自动封面策略延续两端已有封面限制：Windows 只接受 HTTPS；Android 另接受已有的 PNG/JPEG/GIF/WebP base64 图片。不接受 HTTP、文件路径、凭证 URL 或 SVG data URL；没有调整 CSP、账号授权或官方登录窗口。图片使用 no-referrer；不做视频抽帧。自定义图片通过独立受信任本机接口选择和保存，不将图片上传到服务器。

## 状态与渲染

共享控制器位于 `app/ui/cover-background.js`。两端渲染时只传入播放快照，控制器没有播放、暂停、seek、搜索或保存歌单接口。

同一封面地址不随进度或暂停更新重复加载；只在图片变化时创建加载对象。请求序号隔离过期结果；切歌时淡出前一张图，新图加载成功后淡入，失败或超时则回退，不让旧歌曲的背景长期滞留。最多保留两个显示图片节点，取消请求和过渡后释放旧图片引用。

背景采用独立、不可交互的装饰层，等比例居中裁剪。仅图片层模糊，前景没有 filter。浅色与深色分别使用遮罩，背景启用时调整次要文字色以保证可读性；设置、输入框和弹窗保留原有实体表面。过渡约 220ms，减少动态效果时无过渡。小屏使用较小模糊半径，不添加持续动画或 backdrop-filter。

Android 的 `build-web.cjs` 将共享控制器编入 `runtime.js`，并复制共享 CSS 到生成文件 `android/web/cover-background.css`；这些生成物不提交。APK 校验脚本检查包含共享 CSS 在内的五个 Web 文件。

## 自动化验证

安装项目现有的开发依赖后，在仓库根目录运行：

```powershell
node android/build-web.cjs
node --test app/test/*.test.cjs android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs
node --test tools/cover-background-ui.cjs tools/search-add-feedback-ui.cjs tools/sleep-timer-ui.cjs tools/sleep-timer-android-runtime.cjs
```

浏览器测试默认使用本机 Edge（可设置 `MIXTUNES_TEST_BROWSER=chrome`），使用隔离资料及模拟接口。测试覆盖默认关闭、持久化、实际播放身份、试听、暂停、进度更新去重、快速切歌竞争、回退、开关恢复、浅深色及极端封面、减少动态效果、桌面/手机/横屏/平板尺寸、放大字号、导出隔离，以及已有搜索添加和睡眠定时器行为。对比度测试使用遮罩合成的最亮/最暗边界，检查主要及次要文字至少 4.5:1。

Windows ZIP 构建后可设置 `MIXTUNES_COVER_EXECUTABLE` 为解压程序路径，运行：

```powershell
node --test tools/cover-background-electron.cjs
```

此运行测试在临时目录创建隔离歌单，用真实打包程序验证选择封面模式、最小化和恢复同一窗口、暂停状态保持和进程重启后的设置恢复，不使用真实音乐账号。已有托盘行为由独立托盘测试回归，本功能不依赖托盘模块。

## 人工验收

1. 先确认默认主题模式下原有浅色/深色界面正常，选择当前播放封面后封面可见且文字清晰。
2. 分别播放 QQ、网易云歌曲和 Bilibili 内容；Bilibili 只显示封面静态图。暂停后背景保持。
3. 连续快速切换几首歌，确认旧图片不会覆盖新歌；观察无封面或加载失败时回到主题。
4. 切换浏览歌单、筛选、搜索，确认背景继续对应实际播放内容；开始搜索试听后才跟随试听曲目改变。
5. 检查两种主题、弹窗、歌词、按钮、滚动与进度条均可正常使用；选择默认主题立即恢复主题背景。
6. 重启程序，确认恢复模式，并按有效的实际播放内容加载背景。Windows 再验证关闭到托盘和恢复；Android 检查小屏、横屏和切歌流畅度。

自动化不代表真实账号、Android MediaPlayer/WebView、真机渲染性能或平台 CDN 均已验收；这些需要在设备上按上述步骤确认。完整背景系统也支持自定义本地图片、裁剪、图片不透明度、模糊及分主题遮罩调节，详见 [自定义背景与裁剪](custom-background.md)。
