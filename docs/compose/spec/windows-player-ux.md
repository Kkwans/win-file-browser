---
feature: windows-player-ux
status: designed
updated: 2026-09-18
branch: master
commits: 
---

# 播放体验：HEVC 提示、控件超时、兼容面板布局、加载文案

## Report

## [S1] Problem

1. PC Chrome 播 **H.265/HEVC MKV** 很慢 / 有声无画；手机偶发可播  
2. 加载文案「网络或NAS」不知所云  
3. 兼容播放卡片布局乱、对齐差  
4. 控件隐藏：要 4s 或可配置；移动端仍「秒隐」  
5. 需要自行优化若干体验点  

## [S2] Design

### 硬刷新
- 文档/回复说明：PC `Ctrl+F5`；手机 Chrome 清站点缓存或无痕窗口  

### 文案
- 「网络或NAS 正在准备下一段数据」→「正在缓冲视频数据…」  
- 禁止无场景的「NAS」字样出现在播放器 UI  

### 兼容面板
- 重写 `media-compatibility-card` CSS：flex 列布局、标题行对齐、按钮换行、宽度约束  
- 说明文字与操作区分层，避免空节点占位  

### 控件超时
- 默认 `4000`ms  
- 读取 `localStorage["win-file-browser-controls-timeout"]`（若用户设置 1–30s）  
- 移动端：`touchstart/touchend/click/play` 时 `userActive(true)` + `reportUserActivity()`，避免秒隐  
- `html5.nativeControlsForTouch = false`，统一用 video.js 控件  

### HEVC / H.265
- Chrome 无 HEVC 时原生失败是预期；检测 `media/info` videoCodec hevc/h265  
- 失败文案明确：「当前浏览器无法解码 H.265/HEVC，只有声音没有画面是常见现象」  
- 主按钮优先「兼容播放（服务器转 H.264）」；ffmpeg 在 `bin` 已就绪  
- 不自动无确认长转码，但一键可启动；进度文案真实  

### 其他优化
- stalled 阈值提示更克制  
- 兼容操作按钮组 `flex-wrap` + 等高  

## [S3] Out of Scope
- 保证 Chrome 原生播放 HEVC  
- 重写整个播放器皮肤系统  

## Tasks

- [ ] T1: 加载文案 + 兼容卡片布局 — acceptance: 无「网络或NAS」；面板对齐可读 (covers: S2)
- [ ] T2: 控件 4s + 可配置 + 移动端防秒隐 — acceptance: 代码默认 4000，touch 重置 active (covers: S2)
- [ ] T3: HEVC 失败文案与兼容转码入口 — acceptance: 含 H.265 说明与转码主按钮 (covers: S2)
- [ ] T4: 构建测试推送 — acceptance: origin/master 更新 (covers: S2)
