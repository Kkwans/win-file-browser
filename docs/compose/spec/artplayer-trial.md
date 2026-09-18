---
feature: artplayer-trial
status: in-progress
updated: 2026-09-18
branch: artplayer-trial
commits: dd390e7..c9562cc
---

# ArtPlayer 试验分支 + 设置页修复

## Report

**What was built** — 设置页改为：正方形勾选框、控件隐藏仅数字输入、主题化下拉、默认播放策略「原生/兼容转码/每次询问」、双栏布局（右侧密码卡片 sticky）。ArtPlayer：去掉右上角试验提示；底栏增加真实播放模式（原生/兼容，点击立即切换）、倍速（预设+设置里自定义）、字幕、源画质提示；原生失败自动切兼容并回显；策略 ask 时进入选择层。master 与 artplayer-trial 已同步；**当前 8888 运行 trial 构建（ArtPlayer 默认）**。

**Verification** — settingsUiContract 5 PASS；vue-tsc PASS；vite build PASS；服务 index 已更新。

**Journey log**
- 误用 write 覆盖整个 Profile.vue 会丢掉 script；只用 search-replace 改大文件。
- 播放「策略」与「当前引擎」必须分开：设置页存策略，播放器显示真实模式。
- 右上角调试 toast 不应长期出现在产品 UI。
- master 与 trial 的非播放器修复要双向 merge，避免两边设置页再次分叉。

## [S1] Problem

1. 设置页播放偏好行被 `grid-template-columns: 20px` 压成竖排，无法使用  
2. 用户选择 **B：ArtPlayer 试验分支**；需调研手势/快捷键并落地试验播放器  

## [S2] Design

### 设置页
- `.setting-toggle-row` 改为 flex：说明文字自适应，select/number 不再挤进 20px 列  

### ArtPlayer 能力（官方文档）

| 能力 | 结论 |
|--|--|
| 快捷键 hotkey | **内置默认 true**：↑↓音量、←→进度、空格播放/暂停；可用 `art.hotkey.add/remove` 扩展 |
| 手势 gesture | 文档 Option 含 `gesture` / `fastForward` / `lock` / `autoOrientation`；典型移动端左右滑进度、上下滑音量/亮度，需在试验分支实机验证 |
| 进度条预览图 | **内置 `thumbnails`**（雪碧图 + number/column/width/height）；另有插件 artplayer-plugin-vtt-thumbnail |
| HLS | **非内置**，`customType.m3u8` + **hls.js** |
| 倍速 | `playbackRate: true` + `art.playbackRate = 1.15` |
| 自定义控件 | `controls` 数组 / `art.controls.add`，易挂「播放方式」按钮 |

参考：https://artplayer.org · https://artplayer.org/document/en/start/option · https://github.com/zhw2590582/ArtPlayer

### 试验分支（不合并 master，待验收）

- 分支：`artplayer-trial`  
- 新组件 `ArtPlayerVideo.vue`：url/auth/raw、原生优先、兼容播放入口、续播读写  
- 预览页 `localStorage.win-file-browser-player-engine = artplayer` 或 URL `?player=art` 时启用  
- 依赖：`artplayer`、`hls.js`  
- master 仍使用 video.js  

## [S3] Out of Scope

- 本回合把 ArtPlayer 合并进 master 默认播放器  
- 自动生成进度条雪碧图管线（后续可接 ffmpeg）  

## Tasks

- [x] T1: 修复设置页 flex 排版并推送 master — 398c7c2 双栏 setting-control-row (covers: S2)
- [x] T2: 开 artplayer-trial 分支，引入 artplayer + hls.js (covers: S2)
- [x] T3: ArtPlayerVideo 试验组件；**默认启用**，`?player=videojs` 回退 (covers: S2)
- [ ] T4: 进度条缩略图雪碧图接口 — 未做，需 ffmpeg 合成 + API (covers: S2)
- [ ] T5: 手势细调 / 续播完整迁移 / 兼容播放进度条 — 实测后迭代 (covers: S2)
- [x] T6: master 修复合并入 trial 并部署本机 8888 (covers: S2)
