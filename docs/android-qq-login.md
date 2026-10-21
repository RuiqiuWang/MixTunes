# Android QQ 音乐登录

MixTunes 在应用内打开 QQ 音乐的官方授权页面，登录信息保存在本应用的 WebView 中。安装了 QQ 或 QQ 音乐，不代表 MixTunes 已获得该账号的登录权限。

## 登录方式

- **QQ授权**：由官方页面唤起 QQ。部分 WebView 会丢失脚本跳转的点击标记，此时 MixTunes 会询问是否继续打开官方应用。
- **网页登录**：使用 QQ 音乐的官方网页授权，支持扫码和密码登录。页面可以缩放；密码入口在 QQ 登录区域内。没有安装 QQ，或无法唤起客户端时使用此方式。
- **更多登录**：显示 QQ 音乐自己的 QQ／微信账号选择。两种账号的会员和购买记录以原平台为准。

完成授权后返回 MixTunes，点击“完成”。账号状态仍需经过服务器验证。若网页加载失败，可切换方式或检查网络；不要卸载应用来尝试修复，卸载会删除应用内的歌单与登录信息。

## v1.1.0 调整

旧版未识别官方登录页使用的 `wtloginmqq://` 协议。新版将它交给 QQ 客户端；对于 `intent://`，只保留已支持的协议、地址和参数，丢弃组件、额外字段及浏览器备用跳转，并固定官方应用包名。

旧“账号密码”入口使用 ptlogin 的直接回调，没有经过 QQ Connect 到 QQ 音乐的授权码交换。新版“网页登录”与“QQ授权”使用同一个 QQ 音乐官方回调，保留完整会话交换流程。MixTunes 不接收授权码，也不自行交换第三方应用的凭据。

已验证 Java 导航规则、应用协议和 intent 清理；在隔离的 Chromium 环境中加载了实际官方页面，确认一键登录、扫码及可见密码输入框。未在 Android 真机上提交账号完成授权，因此客户端回跳、验证码和不同手机上的成功率仍需实测。上述页面验证不能替代完整登录验证。

## 接入边界与参考

直接接入 QQ 原生 SDK，需要为 MixTunes 申请应用身份、配置签名及回调，不能将 QQ 音乐的网站应用标识当作 MixTunes 的 SDK 身份。当前方案继续使用 QQ 音乐的第一方网页登录。

- [QQ 互联：应用身份与回调申请](https://wiki.connect.qq.com/准备工作_oauth2-0)
- [Android：hasGesture 在部分用户发起的跳转中也可能为 false](https://developer.android.com/reference/android/webkit/WebResourceRequest#hasGesture())
- [QQ 音乐官方移动页面组件](https://y.qq.com/lib/commercial/h5/music-react-2.3.0.min.js?max_age=604800&app=qqmusic)
- [QQ 音乐官方登录回调](https://y.qq.com/m/login/redirect.html)
