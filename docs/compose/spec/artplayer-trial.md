---
feature: artplayer-trial
status: in-progress
updated: 2026-09-18
branch: artplayer-trial
commits: dd390e7..c9562cc
---

# ArtPlayer 试验分支 + 设置页修复

## Report

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
