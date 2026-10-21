# Android QQ 音乐登录

MixTunes 在应用内打开 QQ 音乐的官方授权页面，登录信息保存在本应用的 WebView 中。安装了 QQ 或 QQ 音乐，不代表 MixTunes 已获得该账号的登录权限。

## 登录方式

- **QQ登录**：默认在 MixTunes 内使用 QQ 音乐的官方网页授权，支持扫码和密码登录。页面可以缩放；密码入口在 QQ 登录区域内。
- **其他登录**：显示 QQ 音乐自己的 QQ／微信账号选择。两种账号的会员和购买记录以原平台为准。

同一部手机扫码时，可以截取二维码，再通过 QQ 的“扫一扫 → 相册”识别并确认。确认后返回原来的 MixTunes 登录页，等待官方页面处理授权结果；不要直接关闭原页。

完成授权后返回 MixTunes，点击“完成”。账号状态仍需经过服务器验证。若网页加载失败，可切换方式或检查网络；不要卸载应用来尝试修复，卸载会删除应用内的歌单与登录信息。

## 外部网页登录为什么不会同步

外部 QQ／浏览器与 MixTunes 使用不同的会话容器。v1.1.0 允许直接打开官方应用，但没有 MixTunes 自己的原生授权回调，登录可能完整地留在外部应用中。返回播放器或刷新账号，不能将外部 Cookie 自动转进来。

v1.1.1 默认保留应用内的官方授权页面，停止没有回调能力的 QQ 登录跳转。扫码可在 QQ 中确认，登录结果仍由原来的内置网页轮询接收；这与在外部浏览器独立登录不同。新版同时补充 `u.y.qq.com`、`i.y.qq.com`、`i2.y.qq.com` 的音乐会话识别，避免有效手机域名凭据被共享解析器忽略。

## 登录回调

官方登录页使用的 `wtloginmqq://`、`intent://` 等客户端跳转会被识别并提示留在网页。当前不将它们当作可回传 QQ 音乐会话的原生授权。

旧“账号密码”入口使用 ptlogin 的直接回调，没有经过 QQ Connect 到 QQ 音乐的授权码交换。新版“网页登录”与“QQ授权”使用同一个 QQ 音乐官方回调，保留完整会话交换流程。MixTunes 不接收授权码，也不自行交换第三方应用的凭据。

回归覆盖了“外部应用已安装仍不能带走 QQ 登录”、手机域名会话到账号验证及共享播放凭据的传递。实际官方页面的扫码与密码入口也已检查。未在 Android 真机上提交账号完成授权，因此验证码和不同手机上的成功率仍需实测。模拟会话与页面检查不能替代完整登录验证。

## 接入边界与参考

直接接入客户端授权需要相应平台批准的应用身份、签名和回调；通用 QQ 登录也不等于获得 QQ 音乐权限。不能将 QQ 音乐的网站应用标识当作 MixTunes 的 SDK 身份。当前方案继续使用 QQ 音乐的第一方网页登录。

- [QQ 互联：应用身份与回调申请](https://wiki.connect.qq.com/准备工作_oauth2-0)
- [QQ 互联：Android SDK 的应用回调](https://wiki.connect.qq.com/android_sdk使用说明)
- [Android：hasGesture 在部分用户发起的跳转中也可能为 false](https://developer.android.com/reference/android/webkit/WebResourceRequest#hasGesture())
- [QQ 音乐官方移动页面组件](https://y.qq.com/lib/commercial/h5/music-react-2.3.0.min.js?max_age=604800&app=qqmusic)
- [QQ 音乐官方登录回调](https://y.qq.com/m/login/redirect.html)
