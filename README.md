# MixTunes

MixTunes 是一款跨平台歌单播放器，支持在同一份歌单中播放 QQ 音乐、网易云音乐和 Bilibili 的内容，提供 Windows 和 Android 版本。

main 包含尚未发布的改动，已发布安装包的功能以对应 Release 说明为准。

## 下载

在 [GitHub Releases](https://github.com/RuiqiuWang/MixTunes/releases/latest) 下载 **v1.0.0** 的安装包：

| 平台 | 文件 | 要求 |
| --- | --- | --- |
| Windows | `MixTunes-1.0.0-win-x64.exe` | Windows 10/11，x64 |
| Android | `MixTunes-Android-1.0.0.apk` | Android 8.0 及以上 |

Windows 下载后直接运行。Android 需要允许从所用浏览器或文件管理器安装 APK；升级时使用同一来源的安装包覆盖安装。

Windows 点击窗口右上角 X 时只隐藏到系统托盘，播放与队列继续；双击托盘图标或选择“打开播放器”可恢复，托盘菜单的“退出”才会真正结束程序。托盘不可用（如图标缺失或创建失败）时会退回为正常关闭退出。

## 功能

- 导入 QQ／网易云歌曲和歌单分享链接，以及 Bilibili 视频、收藏夹链接。
- 创建多个混合歌单，调整顺序，修改显示名称，导入／导出 JSON 备份；同一歌单内按歌名和作者去重。
- 顺序播放、列表循环、单曲循环、随机播放；浏览其他歌单不会打断当前播放。
- 搜索三个平台，直接试听或手动加入歌单；试听不会自动收藏。
- 设置每首歌曲或视频的播放起止时间，查看平台歌词或 Bilibili 字幕。
- 按平台选择音质，查看实际返回音质；Bilibili 可听音频或打开原站视频。
- 浅色／深色主题，电脑向手机传输歌单。
- Windows 歌单读取或解析失败时中止启动并禁止保存，保护原文件；恢复步骤和兼容边界见[歌单读取失败保护](docs/library-read-protection.md)。

## 开始使用

1. 在应用内打开对应平台的官方登录窗口，完成登录后返回播放器。
2. 复制原平台的歌曲、歌单或视频分享链接，粘贴到“导入”。也可先搜索再选择播放或添加。
3. 创建或选择歌单。播放其中一首即可开始播放该歌单；切换查看其他歌单时，原播放队列继续运行。
4. 如需换设备，先导出备份，或使用桌面版的“传到手机”。

## 账号、音质与限制

账号会话保存在本应用所在设备上。MixTunes 可沿用自己已有的登录状态，不会复制 QQ 音乐、网易云、Bilibili 客户端或其他浏览器的私有登录信息；手机和电脑需要分别登录。

实际播放、付费专辑、会员音质和地区可用性由原平台判断。音质选择只请求账号可用的资源，不解锁会员、不重编码提升音质。QQ 与微信登录可能对应不同的 QQ 音乐资产，请使用购买内容时的账号。

官方接口和风控可能使搜索、导入、歌词或播放暂时失败。无歌词／字幕的内容不会自动生成歌词。私有或失效收藏内容可能无法导入，应用会显示相应结果。

Android 暂不支持 QQ／网易的官方网页备用播放。QQ 完整授权、客户端回跳、付费内容和后台切歌尚未完成完整的真机兼容性测试；系统结束应用进程后不会自动恢复播放。

## 从电脑传到手机

电脑和手机连接同一局域网，在桌面版点击“传到手机”，将临时链接粘贴到手机“从电脑导入”，也可在手机浏览器打开链接后选择导入。

电脑需要保持运行，并允许播放器通过防火墙访问私有网络。链接 20 分钟后过期，也可主动停止分享。链接通过局域网 HTTP 读取，持有链接的同网设备可访问对应歌单，请仅在可信网络中使用。

传输的是歌单和内容链接，不包含音乐文件或账号会话。这是一次性合并导入，不是云同步，也不会自动同步之后的修改。

## 从源码构建

以下命令在 Windows x64 的 PowerShell 中执行。需要 Git、Node.js **22.12 或以上**及 npm。仓库中的 `app/` 为桌面应用，`android/` 为手机应用。

```powershell
git clone https://github.com/RuiqiuWang/MixTunes.git
cd MixTunes
cd app
npm ci
npm test
npm run dist
cd ..
```

桌面输出位于 `app/dist/`。打包前会自动准备锁定版本的 Electron 运行时，需要网络连接。开发运行使用 `cd app` 后执行 `npm start`。

Android 还需要 **JDK 17**、Android SDK **Platform 35** 和 **Build Tools 35.0.0**。将 `JAVA_HOME` 指向 JDK，将 `ANDROID_HOME` 指向已安装这些组件的 SDK；原生层不依赖 Gradle。

在仓库根目录执行：

```powershell
node android/build-web.cjs
& .\android\native\test-request-control.ps1
& .\android\native\test-qq-mobile-login.ps1
node --test android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs
& .\android\native\build.ps1 -SdkDirectory $env:ANDROID_HOME -VersionName '1.0.0'
```

Android 输出位于 `android/build/`；脚本会校验 APK 对齐、签名和安装信息。当前构建使用本地 debug 签名。首次构建会在 `android/signing/` 创建密钥，后续构建复用它。不要提交该目录；自行构建的 APK 通常不能覆盖安装签名不同的 Release APK，换签名前请备份歌单。

Windows / Android 播放栏提供“定位正在播放”：返回实际来源歌单、清空歌单筛选并突出当前歌曲，保留播放进度和状态。[行为、验证方法及限制](docs/locate-playing.md)。`build-web.cjs` 会把桌面端的定位判断逻辑一起打包；安装 `app` 的开发依赖并生成 Web 包后，可在有 Edge 的 Windows 上运行 `node --test android/locate-playing-ui.cjs`，验证触屏布局、异步定位以及真实运行时与模拟原生桥的交互。该测试不使用个人账号或歌单，不能替代 Android 真机验收。

两端的“筛选当前歌单”只查看当前歌单中已添加的歌曲；“在线搜索”查找 QQ 音乐、网易云和 Bilibili 的歌曲，两者互不限制。[平台差异与验证边界](docs/search-scope.md)。安装 `app` 开发依赖后，可在有 Edge 的 Windows 上运行 `node --test tools/search-scope-ui.cjs`，验证本地筛选不发送在线请求、在线搜索仍请求原有三个平台，且不改动播放与歌单数据。

反馈问题时请附应用版本、系统版本、操作步骤和错误提示，并去除账号、私有歌单等个人信息。

## 睡眠定时器

Windows 的“设置”和 Android 的“设置 → 睡眠定时器”支持 15／30／60 分钟或 1～240 分钟自定义时长；到期仅暂停并保留歌曲、进度与队列。Windows 最小化或关闭到托盘不取消计时，退出应用则结束计时。实现与验证边界见 [睡眠定时器](docs/sleep-timer.md)。

## 在线搜索添加状态

Windows / Android 搜索结果会按实际歌单显示已加入状态，区分添加成功、已存在、同名作者去重及失败，支持继续加入其他歌单。删除歌曲或歌单、重搜和重启后重新计算归属。设计、验证与限制见 [搜索添加反馈](docs/search-add-feedback.md)；本项不解决 QQ 在线搜索请求失败。

Windows 和 Android 统一使用原创「折带播放」图标。可编辑源文件为 `app/assets/icon-source.svg`；修改后在 `app` 目录运行 `npm run icons:generate`，统一生成 Windows ICO、托盘 PNG 和 Android 启动/自适应资源。生成需要已安装的项目开发依赖与 Microsoft Edge，普通打包使用仓库中的现成资源。详细约定与检查命令见 [应用图标维护](docs/app-icons.md)。

当前封面背景默认关闭，可在 Windows“设置”或 Android“设置 → 外观”中开启。它跟随实际播放内容，暂停保留，封面不可用时回到原主题；设置只保存在本机，不随歌单导出。实现、测试与人工验收见 [当前播放封面背景](docs/current-cover-background.md)。

背景设置支持默认主题、当前封面和自定义本地图片，可拖动/缩放裁剪，调节 0～100% 图片不透明度、0～40px 模糊度和 0～100% 遮罩强度；拖动立即生效，浅深主题分别记忆遮罩。图片只保存在本机，不随歌单导出；使用方法、尺寸限制和设备验收见 [自定义背景与裁剪](docs/custom-background.md)。

## 许可

代码采用 [MIT License](LICENSE)。音乐、视频、歌词、封面和各平台商标归各自权利人所有，代码许可不授予这些内容的使用权。MixTunes 是独立项目，与上述平台无隶属关系。
