# Arch Linux / Omarchy 适配

支持在 x86_64 的 Arch Linux / Omarchy、Hyprland / Wayland 环境中构建和运行 MixTunes。构建与源码启动使用系统安装的 Electron 43，路径为 `/usr/lib/electron43`；构建脚本读取该目录的 `version` 并复制运行时。

## 环境要求

- Node.js 22.12 或以上、npm。
- 系统 Electron 43：`/usr/lib/electron43/electron` 和 `/usr/lib/electron43/version`。
- Wayland 桌面会话；关闭到托盘需要桌面提供托盘区域。
- 界面回归使用 Chromium；菜单文件检查使用 `desktop-file-validate`。

## 构建与安装

进入仓库的 `app/` 目录运行：

```bash
npm ci
npm run pack:omarchy
npm run install:omarchy
```

构建结果为 `app/dist/linux-unpacked/mixtunes`。安装脚本创建：

- `~/.local/bin/mixtunes` 启动脚本。
- `$XDG_DATA_HOME/applications/mixtunes.desktop` 菜单入口。
- `$XDG_DATA_HOME/icons/hicolor/256x256/apps/mixtunes.png` 图标。

`XDG_DATA_HOME` 未设置时使用 `~/.local/share`。启动脚本指向当前源码目录内的构建结果；保留该目录，更新代码后重新执行构建。移动源码目录后重新运行安装命令。安装脚本可重复执行，已有的非 MixTunes 管理启动脚本或菜单入口会触发错误提示。

从源码运行使用 `npm run start:omarchy`。现有 `npm run dist` 继续构建 Windows portable 版本。

## 启动与操作

在应用菜单搜索 **MixTunes**，或在终端执行 `mixtunes`。若终端未找到命令，将 `~/.local/bin` 加入 `PATH`。

桌面入口启用原生 Wayland、Wayland 中文输入法和 `--close-to-tray`。关闭窗口后继续播放；点击托盘图标或托盘菜单的“打开播放器”恢复窗口，选择“退出”结束程序。

直接运行构建目录中的二进制时，关闭窗口会退出。通过 `--close-to-tray` 开启后台播放，`--no-tray` 禁用托盘；托盘创建失败时关闭窗口会正常退出。

歌单和账号会话保存在 Electron 应用配置目录下的 `MixLink/`，通常为 `~/.config/MixLink/`。音乐默认下载到系统音乐目录下的 `MixTunes/`，可在应用中修改。

## 实现

- Linux 窗口使用 PNG 图标，应用标识与 `mixtunes.desktop` 一致。
- Linux 托盘响应 StatusNotifierItem 的点击激活事件，恢复已有窗口。
- Linux 关闭行为由 `--close-to-tray` 控制，`--no-tray` 提供显式禁用选项。
- 桌面界面统一显示 MixTunes 名称及桌面版功能提示。
- 音频响应持有上游流的读取器；取消 Range 响应、切换歌曲、替换播放槽或销毁播放器时，中止对应网络请求并释放流。下一首预加载使用独立播放槽。

## 验证

以下命令在 `app/` 目录运行。Electron 测试需要可用的桌面会话。测试创建独立配置和生成的音频文件，临时文件位置可通过 `TMPDIR` 指定。

```bash
npm test
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:ui
ELECTRON_OVERRIDE_DIST_PATH=/usr/lib/electron43 npm run test:linux
npm run test:audio-network
ELECTRON_OVERRIDE_DIST_PATH=/usr/lib/electron43 node ../tools/download-offline-electron.cjs
npm run pack:omarchy
MIXTUNES_LINUX_EXECUTABLE="$PWD/dist/linux-unpacked/mixtunes" npm run test:linux
MIXTUNES_REVIEW_EXECUTABLE="$PWD/dist/linux-unpacked/mixtunes" node ../tools/download-offline-electron.cjs
```

2026-11-05 在 Omarchy 4.5.0、x86_64、Wayland、Electron 43.8.3 上完成验证：

- 570 项自动化测试通过，包括 8 项音频请求生命周期回归。
- 8 项 Chromium 界面测试通过。
- 源码和新打包版本分别通过 3 项 Electron 窗口测试，覆盖正常退出、关闭到托盘、恢复已有窗口以及禁用托盘后的退出。
- 真实 Electron 完成 12 首生成音频的播放和跳转；24 个 HTTP 请求全部关闭，剩余活动连接为 0。
- 源码通过下载、缓存复用、同名文件保护、取消下载、离线解码与跳转测试；打包版本通过缓存播放和跳转测试。
- 菜单安装脚本在隔离用户目录中连续运行两次，结果一致；启动脚本语法和 `desktop-file-validate` 检查通过。

待人工验收：在线平台的个人账号登录、会员资源播放、中文输入法交互和文件拖拽导出。
