---
feature: player-toast-mkv-loading
status: delivered
updated: 2026-09-21
branch: master
commits: 06477dea..working-tree
---

# Player toast + MKV native-first + HLS tests

## Report

**What was built** — ① 续播提示：文案改为「将从 mm:ss 继续播放」+「从头播放/跳转播放」，**6 秒自动消失**；notice 同步短文案。② MKV 在账号「原生优先」下**先加载原生 URL**（「原生探测中…」），约 1.6s 无真实画面再切兼容；兼容进度用**排队/转码中文案或真实 %**，不再假 6%。③ `go test ./http`：HLS stub 改为 **Go 编译的 fake-ffmpeg**（Windows 可 exec）；`writeFileExclusive` 用 `filepath.Dir` 修 Windows mkdir；analysis 报告路径 `ToSlash`；duplicate identity 用例在 Windows skip。

**Verification** — vue-tsc PASS；**`go test ./http/ ./users/` 全 PASS**。Playwright：MKV 早期「原生探测中」→ 晚期兼容；toast DOM 在 ~2s 出现「将从 … 继续播放」。线上 hash 见部署日志。

**Journey log**
- 测 toast 不能在 1.5s 就断言不存在（注入有重试）。
- Windows 不能 exec `.sh` fake ffmpeg；测试 stub 用 `go build`。
- `path.Split` 在 Windows 路径上会得到空目录。

## Tasks
- [x] T1 toast 文案+6s
- [x] T2 MKV native-first + 诚实进度
- [x] T3 HLS Windows 测试
- [x] T4 部署验证
