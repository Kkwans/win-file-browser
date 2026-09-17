# win-file-browser

Windows 本机友好的文件浏览器（基于 [filebrowser](https://github.com/filebrowser/filebrowser)，并从 [nas-file-browser](https://github.com/Kkwans/nas-file-browser) 分离的 Windows 多磁盘二开）。

## 特性

- 全中文界面
- **Windows 多磁盘卷**：像资源管理器一样浏览 C:/D:/…（虚拟路径 `/C`、`/D`）
- 侧边栏存储卷：系统盘/存储盘命名 + 可用空间文案
- 局域网访问 + 可配合 Tailscale 远程访问
- 目录风险标识、收藏、标签、Markdown 编辑等

## 快速开始（Windows 原生）

```powershell
cd backend
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o ..\dist\filebrowser.exe .

# 初始化密码哈希
..\dist\filebrowser.exe hash "你的密码"

# 启动（局域网 + 多磁盘根）
..\dist\filebrowser.exe `
  --address 0.0.0.0 `
  --port 8888 `
  --root computer `
  --database ..\data\filebrowser.db `
  --log ..\logs\app.log `
  --username admin `
  --password '$2a$10$...'
```

浏览器访问：`http://<本机IP>:8888`

- 虚拟根 `/` 显示全部逻辑盘
- 点击「系统盘 (C:)」「存储盘 (D:)」进入对应盘

## 与 nas-file-browser 的关系

| | nas-file-browser | win-file-browser |
|---|---|---|
| 目标场景 | 绿联等 NAS | Windows 11 本机 / 家庭服务器 |
| 卷模型 | `volume1`/`volume2` | 盘符 `C:`/`D:` |
| 默认部署 | Docker Compose | 原生 exe + Windows 服务 |
| 仓库 | [Kkwans/nas-file-browser](https://github.com/Kkwans/nas-file-browser) | 本仓库 |

## 开发

规格文档：`docs/compose/spec/windows-multi-drive.md`

```powershell
cd backend
go test ./...
```

前端在 `frontend/`，产物嵌入 `backend/frontend/dist`。

## 部署建议

- 监听 `0.0.0.0`，防火墙仅对「专用网络」放行端口
- 使用 WinSW/NSSM 注册 Windows 服务实现开机自启
- 不要将端口直接暴露公网；外地访问走 Tailscale
- 修改默认管理员密码

## 许可证

Apache-2.0（与上游 filebrowser / nas-file-browser 一致）
