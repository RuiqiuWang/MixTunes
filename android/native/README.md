# Android 原生外壳

纯 Java Android SDK 项目，无 Gradle、AndroidX 或第三方运行依赖。包名 `local.mixtunes.mobile`，最低 Android 8.0 / API 26，目标 API 35。

本地 UI：`file:///android_asset/index.html`。仅该锁定导航的 WebView 安装 `MixTunesBridge`。官方登录、QQ 网页播放和 Bilibili 视频在独立 WebView 中展示，均没有 JavaScript 原生桥。

## 桥接

异步请求：`MixTunesBridge.postMessage(JSON.stringify({id,method,payload}))`。

回复：`window.__mixNativeReply({id,ok,value,error})`。

事件：`window.__mixNativeEvent({type,...})`。

支持：

- `fetch({url,method,headers,bodyBase64?})` → `{status,headers,bodyBase64,url}`。官方域名白名单，HTTPS，手动重定向，JSON响应上限12 MB；响应Set-Cookie写入本应用CookieManager。音频单独通过只监听127.0.0.1的随机token流式代理，支持Range及同平台安全重定向和备用CDN。
- `cancel({requestId})`：幂等取消对应fetch，取消排队任务并断开运行中的连接。每个fetch从进入原生队列起最多10秒；存储和账号读取分别使用独立线程，不被慢fetch占满。
- `cookies({platform})` → `[{name,value,domain}]`。只向可信本地运行时返回本应用CookieManager中的对应平台cookie，不能导出第三方浏览器cookie。
- `login({platform})` → 打开独立官方登录窗口；关闭时 `accounts-refresh` 事件。
- `playback-start` → 从用户前台动作提前启动mediaPlayback前台服务。
- `audio-load({url,alternatives?,headers,key,generation,slot,startMs,endMs,volume?,muted?,title?,artist?,platform?})` → `{token,key,generation,slot}`。准备后先 `metadata`，定位起点完成才 `ready`；`audio-activate({token})` 在未就绪时仅记录播放意图。
- `audio-pause({token?})`、`audio-stop` 只暂停保留token/进度；`audio-unload({token})` 释放；`audio-destroy` 最终释放并停止服务。
- `audio-seek({token,positionMs})`、`audio-range({token,startMs,endMs})`、`audio-volume({volume,muted})`。
- 音频事件 `{type:'audio',event:{type,key,generation,token,slot,backend:'audio',positionMs,durationMs,...}}`。终点只发一次自然ended。
- `video-load({url,key,generation,startMs,endMs,volume?,muted?})`、`video-play/pause/seek/volume/range/layout/close`。视频事件外层type为video、内层backend为video；收起时另发`video-panel-close`。
- `web-load({platform:'qq',key,generation,track,qqSong,expectedId,range})`、`web-play/pause/seek/volume/range/close`，外层事件 type 和内层 backend 均为 web。`web-panel({visible})` 仅改变 QQ 网页面板展示，不暂停音乐。B站全屏通过原生按钮、官网全屏回调及返回键控制，保持同一媒体实例。
- `storage-load` → `{json:string|null}`；`storage-save({json})` 写私有files/library.json，使用AtomicFile。
- `export({json,suggestedName})` / `import` 使用Android系统文件选择器，不索取全盘存储权限；取消回复`{canceled:true}`，导入回复`{text}`。
- `open-external({url})` 只接受官方音乐/视频/搜索网页；`theme({theme})` 同步系统栏颜色。
- 通知/系统媒体控制事件 `{type:'command',name:'play'|'pause'|'previous'|'next'|'seek',payload}`。

同步加密：`MixTunesBridge.crypto(JSON.stringify(payload))` 返回JSON字符串`{ok,value,error}`。

- `{op:'randomInt',min,max}`：max独占，安全整数范围，支持大于32位整数。
- `{op:'randomUUID'}`。
- `{op:'hash',algorithm:'md5',dataBase64}`：默认base64摘要，可指定output:'hex'。
- `{op:'cipher',algorithm:'aes-128-cbc',keyBase64,ivBase64,dataBase64}`：默认base64密文，AES/CBC/PKCS5Padding与16字节AES块的PKCS7一致。

## 限制

Android QQ 音乐优先使用官方网页播放器，复用本应用的官方网页登录态，按歌曲身份校验媒体事件，并保留原生队列控制。共享的桌面网页控制器通过构建脚本序列化到资产，移动端补充真实手势恢复。网易云继续走音频后端，解析／解码失败保留原始错误，不回退至不支持的网页播放器。QQ 网站内部接口可能变动，真实账号和有权限歌曲的播放仍待手机验收。

QQ 仅保留 QQ 音乐官方桌面网页登录，由该页面生成登录参数并提供登录组件；不手工拼接 OAuth 参数，不调用 QQ 客户端授权。网页可双指放大，用户完成登录后点击原生“完成”刷新账号。不能因显示登录表单就认定已取得会话；账号验证及歌曲权限仍由平台决定。

B站专用视频 WebView 在导航前允许媒体播放。若仍收到 `NotAllowedError`，页面内提供“点击播放”按钮以获得真实网页手势，不将此状态视为终止错误。等待点击时保留当前视频，不触发加载超时自动失败；暂停取消待点击播放。`node ../test-video-gesture.cjs` 可在独立浏览器中验证真实媒体的手势恢复，不能替代 Android 真机验证。

前台服务保存原生音频、媒体通知和音频焦点；普通返回键将任务放入后台，保留Activity/WebView中的JS队列。旋转不重建Activity。Activity真正销毁时解绑监听并释放其音频和前台服务；系统杀死整个进程后不自动恢复播放。后台自动切歌、厂商省电策略、登录和实际音视频解码需要真机验证。

## 构建

需要JDK17、官方Android SDK platform35及build-tools35.0.0。从仓库根目录先运行 `node android/build-web.cjs`，生成本地运行时和 QQ 官方网页控制器，再运行 `build.ps1`。构建同时编译 `res/` 中的启动图标资源。输出debug签名APK，并验证zipalign、签名及manifest。签名私钥只保存在Android工作目录的`../signing/`，不打包进APK或交付源码。

评审时可通过 `-ApplicationId local.mixtunes.mobile.review -ApplicationLabel 'MixTunes Review' -VersionName '1.0.5-review' -VersionCode 9` 构建独立安装的测试版。构建脚本生成 manifest，保留源码中的 Java 组件名称；不传这些参数时沿用原包名和名称。测试版有自己的歌单和登录会话，可与原版共存。不要卸载原版来绕过签名冲突。完整验收见 [评审说明](../ANDROID-IMPROVEMENTS-REVIEW.md)。

源码检查：`test-request-control.ps1`执行真实Java取消控制器的竞态测试；`node --test test-video-bootstrap.cjs`执行Java生成的同一段视频页控制脚本。两者不替代真机验证。

`test-video-navigation.ps1` 验证 B站视频地址规范化和导航限制，允许官方补全末尾斜杠及同分 P 的跟踪参数跳转，同时拒绝其他视频、分 P 和域名。

参考官方文档：

- [前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)：声明mediaPlayback及对应前台服务权限；API35不从BOOT_COMPLETED启动。
- [后台MediaPlayer](https://developer.android.com/media/platform/mediaplayer/background)：前台服务、唤醒及媒体生命周期。
- [WebView JavaScript接口](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String))：远程页面不接入原生桥。
- [CookieManager](https://developer.android.com/reference/android/webkit/CookieManager)：本应用WebView登录会话与网络请求共享。
