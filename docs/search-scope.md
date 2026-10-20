# 当前歌单筛选与在线搜索

“筛选当前歌单”只显示当前查看歌单中已添加的歌曲，不查其他歌单，也不请求在线平台。“在线搜索”从 QQ 音乐、网易云音乐和 Bilibili 查找歌曲，不受当前歌单筛选限制；结果仍按平台展示，可试听或手动加入歌单。

本项仅调整输入框/入口文字、范围提示、aria 描述和空状态，沿用已有布局和样式。不更改查询参数、平台请求、分页、搜索播放/添加、歌单数据或播放控制。

## 保留的双端差异

| 行为 | Windows | Android |
| --- | --- | --- |
| 歌单筛选 | 关键词和已有平台按钮 | 关键词；不新增歌单平台筛选 |
| 在线入口 | 弹窗 | 独立页面和底部导航 |
| 打开在线搜索 | 可以预填当前歌单关键词，但不自动请求 | 不自动复制歌单关键词 |
| 提交查询 | 原来就请求三平台，结果标签重置“全部” | 原来就请求三平台，保留当前结果平台标签 |
| 切换歌单 | 清歌单筛选；若搜索弹窗打开，清结果并提示重新搜索 | 清歌单筛选；保留在线结果及归属校正 |

清空筛选只是恢复可见歌曲，不清空歌单、不切歌、不暂停。平台结果标签只控制结果展示，不能据此误认为改变了底层平台请求策略。本项不改变这些原有行为。

## 独立性

从已合并托盘、定时器、搜索添加反馈的 main 125b533 提取。保留 P03 的真实歌单归属标记与错误重试；不需要定位、数据读取失败保护、背景或图标。没有新增原生桥、服务接口或设置字段。

原历史 UI 测试曾使用定位脚本与按钮等待初始化；独立测试改用基线已有的搜索匹配脚本和连接状态，不为通过测试带入定位或其他功能。

## 验证与限制

```powershell
node --test app/test/*.test.cjs android/native/test-video-bootstrap.cjs android/native/test-qq-mobile-choice.cjs
node android/build-web.cjs
node --test tools/search-scope-ui.cjs tools/search-add-feedback-ui.cjs tools/sleep-timer-ui.cjs tools/sleep-timer-android-runtime.cjs
$env:MIXTUNES_SCOPE_EXECUTABLE='本分支构建目录\win-unpacked\MixTunes.exe'
$env:MIXTUNES_SEARCH_EXECUTABLE=$env:MIXTUNES_SCOPE_EXECUTABLE
node --test tools/search-scope-integration.cjs tools/search-add-integration.cjs
```

测试检查只筛选当前歌单、清空筛选保持 playing/paused 快照、在线三平台参数/结果标签、无结果/失败/重试、重复查询、切换歌单、空状态、P03 归属以及无播放/歌单修改。集成使用实际 Windows EXE 的 IPC/引擎/存储和 Android 生成 runtime；平台查询为受控替身，移动原生桥/存储为替身，不等于真实账号联网测试或 Android 真机验收。没有修复或宣称修复 Fork Issue #25 的 QQ 搜索失败。

## 与上游 #20

#20 fe54761 的 Windows 入口使用“歌单内”“在当前歌单中筛选”“＋ 在线找歌”和“在线找歌 · 全平台搜索”，与本项区分范围的目标重复；本项采用“筛选当前歌单/在线搜索”，额外提供双端固定范围说明、aria-describedby、按当前歌单/平台解释空结果。

该 head 的 Android 搜索入口与占位文字仍是“搜索/筛选歌单/歌名或作者”，因此本项的移动范围说明并非同样的改名重复。这里仅比较已读源码，不推断使用效果哪一套更好。

若 #20 先合并，应保留维护者选定的入口命名和其批量操作/布局等改动，只补选定的范围、空状态和可访问性说明；同一输入区域不叠加重复提示，不用整份最终版 UI 覆盖。两项没有必须互相接受的功能依赖。
