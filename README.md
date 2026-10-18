# MixTunes

MixTunes 是一款跨平台歌单播放器，支持在同一份歌单中播放 QQ 音乐、网易云音乐和 Bilibili 的内容，提供 Windows 和 Android 版本。

## 下载

在 [GitHub Releases](https://github.com/RuiqiuWang/MixTunes/releases/latest) 下载 **v1.1.0** 的安装包：

| 平台 | 文件 | 要求 |
| --- | --- | --- |
| Windows | `MixTunes-1.1.0-win-x64.exe` | Windows 10/11，x64 |
| Android | `MixTunes-Android-1.1.0.apk` | Android 8.0 及以上 |

> 1.1.0 为待发布版本；合并到主仓库前，可按下文“从源码构建”自行打包。

Windows 下载后直接运行。Android 需要允许从所用浏览器或文件管理器安装 APK；升级时使用同一来源的安装包覆盖安装。

## 功能

- 导入 QQ／网易云歌曲和歌单分享链接，以及 Bilibili 视频、收藏夹链接。
- 创建多个混合歌单，调整顺序，修改显示名称，导入／导出 JSON 备份；同一歌单内按歌名和作者去重。
- 顺序播放、列表循环、单曲循环、随机播放；浏览其他歌单不会打断当前播放。
- 每个歌单可以单独播放：侧边栏每个歌单有独立播放按钮，也可右键选择“播放这个歌单”，不切换正在查看的歌单；Android 在歌单选择面板里同样可以单独播放。
- 歌单列表可“定位播放”（快捷键 F）：跳到正在播放的歌曲；被平台筛选或搜索隐藏时会先清除筛选再定位。Android 在筛选框右侧有同名按钮，并会高亮定位到的行。
- 搜索三个平台，直接试听或手动加入歌单；试听不会自动收藏。
- 设置每首歌曲或视频的播放起止时间，查看平台歌词或 Bilibili 字幕。
- 按平台选择音质，查看实际返回音质；Bilibili 可听音频或打开原站视频。
- 浅色／深色主题，电脑向手机传输歌单。
- 电脑版可关闭窗口继续播放（留在系统托盘），也可设置自己的背景图片。
- Windows 任务栏／托盘与 Android 桌面都使用 MixTunes 自己的应用图标。

## 开始使用

1. 在应用内打开对应平台的官方登录窗口，完成登录后返回播放器。
2. 复制原平台的歌曲、歌单或视频分享链接，粘贴到“导入”。也可先搜索再选择播放或添加。
3. 创建或选择歌单。播放其中一首即可开始播放该歌单；切换查看其他歌单时，原播放队列继续运行。
4. 如需换设备，先导出备份，或使用桌面版的“传到手机”。

## 背景与后台播放（电脑版）

- “背景”按钮可选择一张 JPG／PNG／WebP／BMP 图片作为背景，并调整模糊与遮罩强度。遮罩下限按图片平均亮度和当前主题自动计算：滑块只能让界面更清晰，不会把文字压到看不清；切换深浅色主题时下限会重新计算。
- 关闭窗口不会退出播放器：音乐继续播放，应用留在系统托盘。单击或双击托盘图标可恢复窗口，托盘菜单可播放／暂停、切歌或退出。需要完全退出时请用托盘菜单或界面的“退出播放器”。

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
# 手机界面（歌单单独播放、定位播放）：在 jsdom 里跑，不需要设备
node android/ui-dom.test.cjs
& .\android\native\build.ps1 -SdkDirectory $env:ANDROID_HOME -VersionName '1.1.0' -VersionCode 5
```

如果仓库路径包含中文等非 ASCII 字符，`build.ps1` 会自动用 UTF-8 解码 javac 的参数文件，并以相对路径调用 aapt2。

Android 输出位于 `android/build/`；脚本会校验 APK 对齐、签名和安装信息。当前构建使用本地 debug 签名。首次构建会在 `android/signing/` 创建密钥，后续构建复用它。不要提交该目录；自行构建的 APK 通常不能覆盖安装签名不同的 Release APK，换签名前请备份歌单。

反馈问题时请附应用版本、系统版本、操作步骤和错误提示，并去除账号、私有歌单等个人信息。

## 许可

代码采用 [MIT License](LICENSE)。音乐、视频、歌词、封面和各平台商标归各自权利人所有，代码许可不授予这些内容的使用权。MixTunes 是独立项目，与上述平台无隶属关系。
