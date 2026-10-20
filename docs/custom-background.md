# 本地背景、裁剪与不透明度（任务 C 第二阶段）

在 Windows 的播放器设置、Android 的设置 → 外观中选择背景模式：默认主题、当前播放封面、自定义本地图片。自定义图片只导入到本机，不上传到任何服务器，不随歌单导出。

## 使用

1. 点击“选择图片”（已有图片时为“更换图片”）。支持 JPEG、PNG、静态 WebP。
2. 裁剪窗口中拖动调整构图，使用滑块、鼠标滚轮或双指缩放。方向键可移动图片，缩放滑块可用键盘操作。
3. 可重置裁剪或勾选“预览背景效果”查看当前不透明度和主题遮罩；“确认使用”保存并切换至自定义模式。“取消”、系统返回、Escape 或取消文件选择都不替换已保存图片。
4. “调整裁剪”重新使用保存的完整构图副本；切换其他背景模式不会删除图片。删除时确认后只删除应用保存的副本，并回到主题，不删除源文件。
5. 封面与自定义模式共用“背景图片不透明度”0～100%。0% 只显示原主题；100% 的图片层仍受可读性遮罩保护。默认 100%，与第一阶段的封面效果一致。

## 裁剪、尺寸与性能

保留完整构图的规范化图片副本，不把某一屏幕比例永久裁进图片。记录归一化中心 x/y（0～1）和 zoom（1～4）。渲染时先按 cover 等比铺满当前背景容器，再乘缩放系数；中心尽量对齐用户选定位置，靠近边缘时限制偏移，避免露出底边。

预览框按当前应用视口比例计算；窗口缩放、横竖屏及平板使用新的容器尺寸重新计算布局。不同宽高比一定会改变可见边缘，但尽量保留所选中心，不拉伸。ResizeObserver 只调整已解码图片的尺寸和位置，不重新读源文件、设置 src 或解码；播放进度更新也不重复计算自定义裁剪。

输入上限 12 MiB、2400 万像素、单边 8192px。在解码前读取格式头与尺寸，拒绝 GIF、APNG、动画 WebP、SVG、异常头和超限图片；解码失败显示错误。较大的 Base64 转换分批让出主线程。createImageBitmap 异步解码并按 EXIF 方向处理，再用 Canvas 等比缩至最长边 2560px，输出 JPEG（质量 0.9），最大 4 MiB。PNG/WebP 透明部分合成为白色；不保留原始元数据。解码完成后释放 ImageBitmap，编码结束缩小临时 Canvas；取消时释放草稿引用。

裁剪只编辑草稿。私有存储确认成功后才替换实际背景，保存失败保留旧背景。重新裁剪基于规范化副本，不能还原压缩前的原始像素，也不提供专业图像编辑功能。

## 存储与安全

- Windows：现有 userData（MixLink）目录中的独立 custom-background.json；先写固定临时文件、同步后原子替换，串行化读写。通过受信任主窗口 IPC 选择文件，renderer 不能传任意路径。只把选中的图片字节返回给本地界面，不保留源路径。
- Android：ACTION_OPEN_DOCUMENT 系统选择器，限 JPEG/PNG/WebP，并通过 content URI 临时授权读取。复制所选字节后不再依赖原文件或持久 URI 授权，不申请存储权限。规范化图片和裁剪信息通过既有受信任原生桥，使用 filesDir 下的独立 AtomicFile 保存，存储线程执行读写。
- 私有 JSON 记录 version:1、规范化 JPEG 数据和 crop:{x,y,zoom}。图片 Base64 只用于有界本机传输/私有文件，不进入 localStorage。两端存储都再次校验格式、长度和裁剪参数；损坏或缺失时回到主题，损坏文件不被自动覆盖。
- 不修改歌单存储、导出、包名、数据目录、登录、播放、队列或搜索。新增 playerAPI.background 接口与播放器 command 分离。
- CSP、文件访问设置和网络白名单保持原样。Android 的资源拦截只为受信任本地 UI 的有界 JPEG data 图片子请求增加放行，拒绝主框架、SVG、任意本地路径和非受信任页面。裁剪预览需要的 JPEG 同样受此限制。
- Android 裁剪期间仅临时隐藏已有原生视频面板，结束时恢复原可见性，不调用媒体暂停/播放；Windows 沿用已有模态窗口布局处理。设备实际媒体行为仍需人工验收。

## 升级与图层

沿用 mixtunes-background-mode：theme/current-cover 原值不重置，新增 custom。mixtunes-background-opacity 保存小数值百分比，缺失或无效时默认 100%，有效数值限制在 0～100。

透明度仅通过图片元素的 CSS filter opacity 调整，与图像淡入的 opacity 分离；不会降低前景、遮罩或整个应用的透明度，不改 URL 或重建图片。遮罩默认浅色白色 0.88、深色底色 0.90，可单独调节；主题模式和图片不透明度0%显示原主题。保留减少动态效果支持及封面请求序号、失败回退、双缓冲和进度去重机制。设置存储失败时明确提示“仅本次生效”；图片文件保存成功与模式保存失败分开显示，不用成功提示覆盖警告。

## 背景模糊度与实时预览

- 背景设置新增“背景模糊度”滑块：0～40px、步长 1px，实时显示当前值；0px 完全清晰，40px 高度模糊。Windows 支持鼠标与键盘，Android 支持触摸。
- 透明度（0～100%）与模糊度在同一区域；拖动过程中由 `input` 事件立即更新背景容器的 CSS 变量，背景图片的 `filter` 立即变化，不需要松开滑块、确认或刷新页面。
- 两项设置互不重置并叠加生效。主题模式没有实际图片，滑块禁用但不会清除已保存值；切回图片模式后恢复。
- 模糊度按来源分别保存：`mixtunes-background-blur-cover` 与 `mixtunes-background-blur-custom`。未修改过模糊度的旧用户保持原视觉：当前封面继续使用桌面 24px / 小屏（≤600px）18px 的响应式默认，自定义图片继续为 0px，不写入新键、不迁移、不丢失已保存图片或裁剪。
- 拖动期间只更新 CSS 效果，不重新选择、读取、解码或保存图片，也不重建播放器；`input` 阶段不写 localStorage，在 `change` / 失焦后（250ms 防抖）才持久化。保存失败时效果仍临时生效，并沿用“仅本次生效”的提示。
- 只对背景图片元素应用 `filter`，前景列表、歌词、按钮、对话框和可读性遮罩保持清晰。
- 边缘处理：显式模糊值会按模糊半径追加少量缩放（`--background-blur-scale`），避免 CSS 模糊在视口边缘产生透明缝；旧版默认值不追加缩放，保持原有构图。用户保存的裁剪位置与 zoom 不变。裁剪预览通过 `--preview-blur` / `--preview-opacity` 反映当前两项设置。

## 开发与验收

背景遮罩强度为0～100%：0%无遮罩，100%完全遮挡图片。浅色、深色主题分别以 `mixtunes-background-mask-light` / `mixtunes-background-mask-dark` 保存，切换主题恢复对应值。拖动立即更新并持久化，裁剪效果预览使用同一主题变量；与图片不透明度、模糊度互不覆盖。旧用户没有保存值时保持88%/90%。较低遮罩可能降低文字可读性，界面会提示，前景控件仍可操作。滑块具有浅深主题对比度、键盘焦点及44px命中区域；不影响播放器进度条。

```powershell
node --test app/test/*.test.cjs android/native/test-*.cjs
node android/build-web.cjs
node --test tools/custom-background-ui.cjs tools/cover-background-ui.cjs tools/background-live-effects-ui.cjs tools/background-mask-ui.cjs tools/background-slider-contrast-ui.cjs tools/search-add-feedback-ui.cjs tools/sleep-timer-ui.cjs tools/sleep-timer-android-runtime.cjs
& ./android/native/test-request-control.ps1
& ./android/native/test-qq-mobile-login.ps1
& ./android/native/test-background-images.ps1
& ./android/native/test-sleep-timer.ps1
# 用实际本次打包路径，避免误测第一阶段旧包
$env:MIXTUNES_COVER_EXECUTABLE='<本次打包的 MixTunes.exe>'
$env:MIXTUNES_CUSTOM_EXECUTABLE=$env:MIXTUNES_COVER_EXECUTABLE
$env:MIXTUNES_EFFECTS_EXECUTABLE=$env:MIXTUNES_COVER_EXECUTABLE
node --test tools/custom-background-electron.cjs tools/cover-background-electron.cjs tools/background-live-effects-electron.cjs
```

浏览器 UI 测试使用作者自绘的合成色块图片，不使用私人图片；覆盖真实鼠标/触屏/双指、EXIF 旋转、三种格式、缩小、取消/失败/重启、0/50/100%、窗口变化、原图不再可用、删除和损坏恢复。Android JS runtime 测试检查背景桥操作不改变真实 PlayerEngine 快照或进入歌单导出。Java 安全测试检查 JPEG data 子请求白名单。

Windows 运行测试启动真实打包程序和真实存储，但模拟了文件选择器的返回路径；未自动点击系统文件选择器，也未用真实账号持续播放。Android 浏览器模拟与 Java 测试不替代真机系统选择器、WebView、媒体面板、内存和重启验收。

人工步骤：两端分别选择横/竖图，拖动缩放、取消、确认、再裁剪、更换、删除；移走原图并重启；在当前封面与自定义间切换后调整 0/50/100%；检查 QQ/网易云/Bilibili 封面、切歌/暂停、浅深色、小屏、横屏、平板；Windows 验证托盘持续播放和原生菜单。Android 在签名兼容环境安装测试，不为安装卸载或清除原应用数据。

自动化覆盖背景功能及当前上游既有功能，不代表其他尚未合并功能的组合验收。使用新的独立测试数据和输出目录，不覆盖旧测试包或发布包。具体测试数量和构建结果以对应分支的本地报告为准。

参考：[createImageBitmap 方向处理](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)、[Android 系统文件选择](https://developer.android.com/training/data-storage/shared/documents-files)、[WebView 资源拦截](https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest))。
