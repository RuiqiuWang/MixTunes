# MixTunes 原创应用图标

采用用户选定的 C「折带播放」：三块折带组成向右的播放方向，表达播放与多平台音乐拼合。米白 `#F1F0E8`、靛紫 `#47439A`、浅紫 `#8581D9`、青绿 `#68BCB3`。主体由项目独立绘制，没有使用第三方 Logo 或下载素材，按仓库 MIT 许可维护。

## 唯一设计源与重新生成

源文件为 `app/assets/icon-source.svg`。用矢量编辑器或文本编辑器修改后，在仓库的 `app` 目录运行：

```powershell
npm run icons:generate
```

需要项目已有的 Node（>=22.12）、Playwright Core 和本机 Microsoft Edge；不联网下载素材，不需要安装额外绘图软件。首次开发按现有项目流程安装 app 的开发依赖即可。生成结果纳入 Git，普通运行和打包无需启动 Edge。

源文件约定：`viewBox="0 0 256 256"`，保留 `icon-background` 与 `icon-foreground` 两个独立分组。背景铺满画布，前景使用自包含的填充路径；文字转路径，轮廓线转填充，不引用外部图片、字体、CSS 或分组外的定义。允许分组内嵌套分组与 transform。脚本自动测量前景边界并适配 Android；大幅换稿后仍需检查小尺寸与裁剪预览，不直接手改生成的位图。

`tools/generate-icons.cjs` 使用浏览器渲染、透明画布及固定尺寸导出，不给 ICO 引入额外依赖。托盘沿用主体，增加细边框以适配浅深任务栏。Android 以前景包围盒计算中心和缩放，所有角点落在 108dp 画布中心半径 31dp 范围内，比 33dp 安全半径略小。前景若有复杂透明留白，应先在源 SVG 中整理。

## 输出与接入

- `app/ui/icons/app.ico`：16、20、24、32、48、64、128、256px PNG 帧；EXE 资源和 BrowserWindow 共用。
- `app/ui/icons/app.png`：256px 通用预览；`tray-16/20/24/32.png` 为托盘适配输出，`app/ui/tray.png` 是实际加载的 32px 版本。
- `android/native/res`：mdpi 至 xxxhdpi 的普通/圆形启动图标，以及前景、背景图层；`mipmap-anydpi-v26` 的 XML 组合为自适应图标。当前最低 API 26；没有用户图标切换入口。

Windows `signAndEditExecutable: true` 允许写入图标和元数据，`signExecutable: false` 跳过签名。当前 electron-builder 26.15.3 支持这两个配置。运行时资源全部在 app.asar 内，路径相对 `__dirname`。只为主窗口添加 icon，托盘加载路径、菜单及失败回退逻辑保持既有实现。

Android 原生构建先用 aapt2 compile 编译 res，再 link 到 APK；Manifest 引用 `@mipmap/ic_launcher` 和 `@mipmap/ic_launcher_round`。不修改包名或账号/播放/歌单代码。

## 验证与维护

连续运行生成命令两次后应得到相同字节（同一 Edge 版本）。浏览器更新可能影响抗锯齿，更新资源时检查 Git diff 和预览。

在仓库根目录执行下面的检查。传入实际构建后的 EXE 才能验证资源写入：

```powershell
node tools/verify-icons.cjs "构建目录/win-unpacked/MixTunes.exe"
node --test tools/icon-assets-ui.cjs
```

脚本逐帧比对 EXE 的 RT_ICON 数据与源 ICO，并检查 app.asar 中实际加载的图标和窗口源码。图像测试检查各密度尺寸、自适应前景安全区域和透明边角；设置 `MIXTUNES_ICON_PREVIEW` 可保存浅深背景和常见裁剪预览。APK 另用 aapt2 dump resources/xmltree 检查图标引用、zipalign/apksigner 检查对齐及签名；将 APK 解压后设置 `MIXTUNES_ICON_APK_RES` 为解压的 res 目录，可逐像素比对全部启动图标，允许资源编译器调整 PNG 编码。

真实系统验收：Windows 检查 EXE、主窗口、任务栏、浅深色托盘，以及关闭隐藏、恢复、播放/暂停、下一首、退出；Android 检查桌面、应用列表、常见裁剪形状和启动。未实测项目须标为待人工验收。不能因 Windows 图标缓存未刷新而自动清系统缓存；不能因 debug APK 与官方签名不同而卸载应用或清数据。

参考：[electron-builder Windows 配置](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowsconfiguration/)、[Electron 窗口图标](https://www.electronjs.org/docs/latest/api/base-window)、[Android 自适应图标](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)。
