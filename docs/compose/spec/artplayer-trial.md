---
feature: artplayer-trial
status: in-progress
updated: 2026-09-19
branch: artplayer-trial
commits: bb91e1a..HEAD
---

# ArtPlayer 试验分支 + 设置页修复

## Report

**What was built** — 设置页与 ArtPlayer 试验播放器契约。本回合按官方 pattern 重写播放器设置项：`art.icons.*` SVG 克隆作图标（禁止 Material 字体 ligature）；菜单名只保留「播放方式/播放速度/转码画质/字幕」，当前值只进右侧灰字 `tooltip`；底栏文本芯片点击打开官方 settings 子列表（`setting.render(selector)`，并绕过 focus 关闭）；倍速改选后立即同步 `art.playbackRate`、底栏 label 与 tooltip。8888 已部署 `index-DbseMUVp.js`。

**Verification** — `vue-tsc` PASS；`vite build` PASS；Playwright DOM 自测（`frontend/scripts/artplayer-dom-check.mjs`）PASS：图标为 SVG 且无字母截断；`播放速度` 名称干净 + 右侧 `1.25x`；点底栏倍速后 rate 列表全部 visible；选 1.25x 后 `playbackRate=1.25`、底栏 `1.25x`、tooltip `1.25x`、名称仍为「播放速度」。

**Journey log**
- 误用 write 覆盖整个 Profile.vue 会丢掉 script；只用 search-replace 改大文件。
- 播放「策略」与「当前引擎」必须分开：设置页存策略，播放器显示真实模式。
- Material 字体 icon 在 ArtPlayer 层会退化成 ligature 字母；必须用 `art.icons` SVG。
- 回显不能拼进 `html`；官方 `tooltip` 才是右侧灰字。
- 官方 control selector 是 hover + `.art-bottom{overflow:hidden}` 会裁切；底栏应点开 settings 子列表，并在 focus 关闭后再 `render(selector)`。
- master 与 trial 的非播放器修复要双向 merge。

## [S1] Problem

1. 设置页播放偏好行被 `grid-template-columns: 20px` 压成竖排，无法使用  
2. 用户选择 **B：ArtPlayer 试验分支**；需调研手势/快捷键并落地试验播放器  
3. 底栏/设置：图标变成截断字母、回显拼进菜单名、倍速不同步、列表被遮挡无法切换  

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
| 倍速 | `playbackRate: false` + 自定义 selector；`art.playbackRate = x` |
| 自定义控件 | `controls` 数组 / `art.controls.add` |

参考：https://artplayer.org · https://artplayer.org/document/en/start/option · https://github.com/zhw2590582/ArtPlayer

### ArtPlayer 全屏/续播/移动端契约（2026-09-19 三修）
- 全屏自定义倍速：弹窗 **Teleport 进 ArtPlayer `$player`**；列表增加更多预设倍速
- 兼容画质：显式非 source 时 **强制 ReserveWithProfile**（即使源可 HLS copy），避免 1080/480 同流
- MKV/HEVC：media info 识别 codec；原生失败或 6s 无画面 **自动兼容** + 始终有加载态
- 续播偏好 `playerPreferences.resumeMode`：`resume` | `from-start` | `ask`；toast 用 **ArtPlayer layers**（全屏可见，可点击）
- 移动端列表：加大 max-height、`touch-action:pan-y`、list touch `stopPropagation`、列表打开时 video `pointer-events:none`（防音量手势）
- 底栏芯片：**无 tooltip**（避免遮挡列表）；列表 **仅点击** 展开（禁用 hover）
- 分辨率列表：**原生**只显示源分辨率一项；**兼容**显示「原画」+ 不高于源分辨率的档位
- 切换模式/兼容画质走 `switchEngine`：先乐观更新芯片与加载文案（兼容→「兼容播放加载中」），再换源，**恢复切换前进度/倍速**，5s 兜底清加载层
- 播放进度：账号级 `GET/PUT /api/media/playback`，timeupdate 节流 + pause/卸载/切换前强制写入
- MP4 也可走兼容 HLS 转码（ffmpeg）；原生能解码的 MP4 不需要兼容，但要降分辨率必须进兼容
- **图标**：只使用 `art.icons.*` 的 SVG 克隆（`config` / `playbackRate` / `aspectRatio` / `subtitle`），禁止 Material 字体 ligature 文本进播放器
- **回显**：与官方 `aspectRatio`/`flip` 一致 —— `html` 仅为菜单名，当前值只写进 `tooltip`（右侧灰字 `art-setting-item-right-tooltip`），禁止拼进 `html`
- **倍速同步**：`applyRate` → `art.playbackRate` + 底栏 `.art-bar-label` + `setting.check(rate-x.xx)`；另听 `video:ratechange` 兜底
- **底栏列表**：每个倍速/播放方式/画质芯片挂**独立** ArtPlayer `controls[].selector` 弹层（锚定在该芯片上方），**点击**用 class `art-selector-open` 展开；禁止再打开设置面板二级菜单（那会出现在齿轮位置）。`.art-bottom/.art-controls` 需 `overflow:visible`，避免裁切
- 设置项 `width` 使用 `art.constructor.SETTING_ITEM_WIDTH`

### 试验分支（不合并 master，待验收）

- 分支：`artplayer-trial`  
- 新组件 `ArtPlayerVideo.vue`：url/auth/raw、原生优先、兼容播放入口、续播读写  
- 预览页默认 ArtPlayer，`?player=videojs` 回退 video.js  
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
- [x] T6: master 修复合并入 trial 并部署 8888 (covers: S2)
- [x] T7: 设置项 SVG 图标 + 右侧 tooltip 回显 + 倍速即时同步 (covers: S2)
- [x] T7b: 底栏芯片独立 selector 弹层（非设置二级菜单）— Playwright：列表在芯片上方、settings 不打开、1.25x 即时同步 (covers: S2)
- [ ] T7c: 模式/画质即时切换 + 进度恢复 + 原生仅源分辨率 + 无tooltip仅点击 — 已部署，待用户实测 (covers: S2)
- [ ] T7d: 全屏倍速/HEVC自动兼容/续播偏好/layers toast/移动端列表手势/显式画质真转码 — 已实现待实测 (covers: S2)
- [ ] T8: 进度条缩略图雪碧图 — 未做 (covers: S2)
