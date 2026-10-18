# Windows 优化与 PR 验证记录

本分支 `codex/windows-improvements-pr` 从个人 fork `chloeagle/MixTunes` 的 `main`（`5c7d748`）建立，仅包含 Windows 修改。Android 调试仍在原分支保留并暂停。

## 关联 Issue

| Issue | 修改 |
| --- | --- |
| [#1](https://github.com/chloeagle/MixTunes/issues/1) | 多选、全选筛选结果、确认后批量移除歌曲，不影响其他歌单 |
| [#2](https://github.com/chloeagle/MixTunes/issues/2) | 删除重复的播放模式图标按钮，保留四种模式下拉框 |
| [#3](https://github.com/chloeagle/MixTunes/issues/3) | 网易官方封面地址升级 HTTPS，兼容旧备份与原始封面元数据 |
| [#4](https://github.com/chloeagle/MixTunes/issues/4) | 拖动音量时实时发送，合并连续请求，松开或失焦保存最终值 |
| [#5](https://github.com/chloeagle/MixTunes/issues/5) | 区分“歌单内筛选”与“在线找歌” |
| [#6](https://github.com/chloeagle/MixTunes/issues/6) | 当前歌曲动态音柱，暂停时静止，尊重减少动态效果设置 |
| [#7](https://github.com/chloeagle/MixTunes/issues/7) | 侧栏按平台显示 B站视频或 QQ／网易同步歌词，可展开、跟随和点击歌词跳转 |

批量移除沿用已有单首移除语义，已捕获的播放队列继续播放。平台没有封面或同步歌词时保留占位／状态提示；本次未生成缺失的平台资源。

## 验证

- `node --test app/test/*.test.cjs`：228 项通过（本分支不包含先前 Android 分支新增测试）。
- `node app/test/windows-ui.cjs`：通过。实际 Edge 渲染，使用模拟 native API 验证批量选择、音量最终值、播放模式、音柱、同步歌词及侧栏切换。
- `node app/test/windows-electron.cjs`：通过。实际 Electron、preload IPC、播放器引擎和隔离歌单文件，验证封面迁移、拖动期间音量状态更新、最终保存与批量移除。
- `git -c core.whitespace=cr-at-eol diff origin/main --check`：通过。

真实账号下的视频、音源权限和歌词效果仍需用户试用审核。之前桌面试用包来自 Windows review 集成分支；本 PR 从 main 单独提取 Windows 变更，不包含 Android 调试修改。上游 RuiqiuWang/MixTunes 不在本 PR 目标范围。

Issue 为本地实现之后补建；此记录不声称遵循了先建 Issue 再开始修改的时间顺序。PR 创建后保持待审核，不自动合并。


## PR 状态

已创建个人 fork PR： https://github.com/chloeagle/MixTunes/pull/8 。目标为 `chloeagle/MixTunes:main`，来源 `codex/windows-improvements-pr`，状态 OPEN，可合并但未执行合并。GitHub 已关联 fork Issue #1–#7，合并后自动关闭。已核对上游 #9–#15 均为 CLOSED；本次未重复关闭或留言。


## Windows 批量添加到其他歌单（#20）

- 评审版本 `1.0.1-review.1`，分支 `codex/windows-batch-copy`，仅修改 Windows 入口及界面，复用已有共享引擎；Android 不变。
- 当前歌单 → 批量管理 → 勾选歌曲（也可全选筛选结果）→ 添加到其他歌单 → 选择目标 → 确认添加。
- 仅复制选中的歌曲，来源保留，目标按歌曲身份和同名同作者去重；新增歌曲按来源顺序放到目标前部。显示新增与重复数量，成功清空选择；取消、失败保留选择。无其他歌单时提示先创建，不允许确认。
- `node app/test/windows-batch-copy-electron.cjs`：真实 Windows 页面 + Electron IPC + 引擎 + 文件持久化检查通过，包括未选禁用、无目标提示、仅筛选选中歌曲、取消保留、重复跳过、来源及播放状态保持、保存结果及目标失效后的错误反馈。
- `node --test app/test/*.test.cjs`：247 项通过；`node app/test/windows-ui.cjs`：原有桌面交互回归通过。
- 通过便携版构建及隔离数据目录的打包启动检查。等待用户试用后合并个人 fork，不自动合并或向上游提交。
