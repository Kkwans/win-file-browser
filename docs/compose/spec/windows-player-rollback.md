---
feature: windows-player-rollback
status: designed
updated: 2026-09-18
branch: master
commits: 
---

# 播放器样式回退 + MKV 原生再收紧 + 缩略图说明

## Report

## [S1] Problem

1. MKV 仍被当成「必须兼容播放」  
2. 播控样式被改丑，要求**回退原版**，只保留「移动端控件太快消失」  
3. 需要明确 Windows 缩略图实现与缓存位置  

## [S2] Design

### 播放器 UI
- 删除对 video.js 控制条的全局改样式（颜色/高度/进度条等）
- 仅保留 `inactivityTimeout: 8000`
- 移动端（≤720px）可保留 44px 触控热区，**不影响桌面默认观感**
- 兼容播放面板默认不自动打开

### MKV 原生
- `sourceAttached` 初始恒为 true
- Matroska 不再强制 `type=video/x-matroska`（Chromium 常因此直接拒绝）；省略 type 让浏览器探测
- 扩展名黑名单不阻断挂源
- 仅在原生真实失败后才出现兼容播放入口

### 缩略图（说明，非改代码）
- 列表/预览请求 `GET /api/preview/{thumb|big}{path}?auth=...`
- 图片：Go 图像管线生成 JPEG；视频封面：FFmpeg
- 磁盘缓存：`--cacheDir` → `C:\Apps\WinFileBrowser\data\preview-cache`
- 键为 SHA1（含路径/尺寸/修改时间等），按首两级目录分片存储
- 上限由 `cacheMaxBytes` 控制（默认 10GB 量级，可配置）
- 未配置 cacheDir 时每次现算，不落盘

## [S3] Out of Scope
- 重写 video.js 皮肤  
- 保证浏览器可解码任意 MKV 编码  

## Tasks

- [ ] T1: 控件样式回退 + 仅保留 inactivityTimeout/移动端热区 — acceptance: 桌面观感接近原版 (covers: S2)
- [ ] T2: MKV 省略 MIME type、启动即挂源 — acceptance: 代码不再按 mkv 打开兼容面板 (covers: S2)
- [ ] T3: 构建推送 + 文档说明缓存路径 — acceptance: origin/master 更新，回复含缓存说明 (covers: S2)
