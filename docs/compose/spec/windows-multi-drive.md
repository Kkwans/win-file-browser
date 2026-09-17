---
feature: windows-multi-drive
status: designed
updated: 2026-09-18
branch: master
commits: 
---

# Windows 多磁盘卷（资源管理器式）

## Report

## [S1] Problem

在 Windows 11 本机部署时，原 NAS 向逻辑只会把 `server.Root` 下名为 `volume*` 的目录当成存储卷。Windows 的逻辑盘（C: 系统盘、D: 存储盘）无法出现在侧边栏「存储卷」中，也不能从网页根像资源管理器一样在多盘之间切换。同时单一 `BasePathFs` 只能挂在一个根目录上，`--root C:\` 时无法访问 D:。

用户需要：
1. 网页根「此电脑」式浏览全部逻辑盘
2. 侧边栏显示「系统盘 (C:) / 存储盘 (D:)」与 Explorer 同风格容量文案
3. 局域网（及后续 Tailscale）可访问，因此路径模型必须稳定可路由
4. 与 NAS 版仓库分离（`win-file-browser`），避免打坏 `nas-file-browser` 行为

## [S2] Design

### 路径模型

- Windows 多盘模式下虚拟根为 `/`
- 每个逻辑盘映射为虚拟盘符段：`/C` → `C:\`，`/D` → `D:\`
- 文件路径：`/D/Movie/foo.mp4` → `D:\Movie\foo.mp4`
- `server.Root` 虚拟根令牌：`computer`（也接受 `/`、`drives`）
- `IsVirtualComputerRoot(serverRoot)` 在 `GOOS=windows` 时启用 DriveFs

### DriveFs（`backend/files/drivefs_windows.go`）

- 实现 `afero.Fs`，虚拟路径解析到真实盘符
- 根目录 `/` 的 `Open`/`Readdir` 返回盘符目录项（C、D…）
- 提供 `RealPath`，供 `User.FullPath`、命令 runner 等使用
- 禁止通过虚拟根删除/清空盘符本身
- 非 Windows 构建提供 stub，不改变 NAS 路径

### 卷发现

- `discoverVolumes` 在 Windows 虚拟根模式下调用 `discoverWindowsVolumes`
- 使用 `files.ListLogicalDrives` + `GetLogicalDrives` / `GetVolumeInformationW` / `GetDriveTypeW`
- 使用 `gopsutil/disk` 读取 total/used/free
- API 扩展字段：`driveLetter`、`volumeLabel`、`freeSpace`
- 命名规则：
  - 有卷标：`系统盘 (C:)` / `存储盘 (D:)`
  - 无卷标固定盘：`本地磁盘 (X:)`，C: 默认 `系统盘 (C:)`
  - USB：`可移动磁盘 (X:)` 或卷标 + 盘符
  - 网络盘：`网络驱动器 (X:)`

### 用户文件系统

- `users.Clean`：虚拟根模式下 `user.Fs = files.NewDriveFs()`，`user.Scope` 默认为 `/`
- `User.FullPath`：兼容 `*DriveFs` 与 `*afero.BasePathFs`，避免类型断言 panic
- `MakeUserDir`：虚拟根模式不 `BasePathFs.MkdirAll("/")`；scope `/` 或 `/C` 等已存在盘符直接接受
- `cmd/root.go`：虚拟根不做 `filepath.Abs`，保留 `computer` / `/`

### 风险与分类

- `risk.Classify` 识别 Windows 虚拟路径：
  - 高危：`/C/Windows`、`/C/Program Files`、`/C/ProgramData`、`/X/System Volume Information`、`/X/$Recycle.Bin` 等
- 分类规则增加 Windows 路径 patterns（用户文档/下载/媒体/系统目录）

### 前端

- `Volume` 类型扩展 `driveLetter` / `volumeLabel` / `freeSpace`
- 卷展示文案：Explorer 风格「103 GB 可用，共 926 GB」（1024 进制）
- `getVolumeLabel` 兼容 `/C` `/D`
- 分类 fallback 增加 Windows patterns
- 侧边栏存储卷点击进入 `/files/C/`、`/files/D/`

### 部署契约（本 fork）

- 监听：`0.0.0.0:8888`（局域网）
- 自启：Windows 服务（WinSW/NSSM）或计划任务
- 鉴权：必须启用登录；禁止 noauth 对外
- GitHub：`Kkwans/win-file-browser`，与 `nas-file-browser` 分离
- 每个功能模块完成后 commit & push

## [S3] Out of Scope

- 不移植/不修改 NAS Docker Compose 为 Windows 部署主路径
- 不实现真·Windows 资源管理器全部 UI（预览窗格、库、快捷方式解析等）
- 不在本期做 Tailscale 自动安装（部署阶段仅预留访问方式）
- 不保证 NTFS 权限继承/加密文件在网页端的完整安全模型
- 不在本期重写 go.mod 模块路径（import 仍可为原 backend 模块名，仓库分离已足够）

## Tasks

- [ ] T1: 创建 win-file-browser 远程仓库并切换 origin — acceptance: `git remote -v` 指向 Kkwans/win-file-browser，Public 仓库可访问 (covers: S2)
- [ ] T2: 落地规格文档与项目基线 — acceptance: `docs/compose/spec/windows-multi-drive.md` 存在且 status 与仓库一致 (covers: S2; depends: T1)
- [ ] T3: 后端 DriveFs + 虚拟根 + FullPath/MakeUserDir — acceptance: Windows 下 `/` 可列出盘符，`/D/...` 可 Stat/Open 真实路径 (covers: S2)
- [ ] T4: 后端 Windows 卷发现 API — acceptance: `GET /api/volumes` 返回 C/D 及 name/freeSpace/totalSpace (covers: S2; depends: T3)
- [ ] T5: 风险/分类 Windows 规则 — acceptance: `/C/Windows` 分类为高危，用户媒体目录为 shared/personal (covers: S2)
- [ ] T6: 前端卷命名与 Explorer 容量文案 — acceptance: 侧边栏显示「系统盘 (C:)」与「xx GB 可用，共 xx GB」(covers: S2; depends: T4)
- [ ] T7: 编译与冒烟 — acceptance: `CGO_ENABLED=0 go build` 成功，进程启动后 health/volumes/列表可用 (covers: S2; depends: T3,T4,T5,T6)
- [ ] T8: 按模块 commit & push — acceptance: 每个模块完成后 origin/master 更新 (covers: S2)
- [ ] T9: 本机部署 LAN+自启 — acceptance: `0.0.0.0:8888` 可访问，服务/任务开机自启 (covers: S2; depends: T7)
