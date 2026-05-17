# MiniMax Usage Monitor

<p align="center">
  <img src="./images/icon.png" width="128" />
</p>

基于 MiniMax Token Plan API 的用量监控插件，支持 VS Code 和独立桌面应用。

## ⚠️ 隐私声明

**本插件仅用于显示 API Key 的用量信息。您的 API Key 通过 VS Code Secret Storage / 操作系统 Keychain 本地安全存储，不会传输到除 MiniMax 官方 API 之外的任何服务器。**

## ✨ 功能特点

### 🔑 多 API Key 管理
- 支持同时管理多个 API Key
- 一键切换查看不同 Key 的用量
- 独立一行胶囊按钮设计：`ALL` / `Key1` / `Key2` / ...
- 实时汇总显示所有 Key 的总用量

### 🖱️ 智能悬停预览
- 状态栏悬停显示快速预览
- 按 Key 显示：已用 / 剩余 / 百分比
- 高亮显示用量异常 Key

### 💻 桌面版支持
- 独立 Tauri 桌面应用
- 支持 macOS / Windows / Linux
- 原生系统托盘运行
- 启动时自动后台刷新

### 📊 可视化面板
- 当前周期用量进度
- 本周累计用量进度
- 模型明细表格展开
- 风险预警提示

## 📦 安装

### VS Code 插件安装

**方式一：VS Code 市场（推荐）**
1. 打开 VS Code
2. 搜索 `MiniMax Usage`
3. 点击安装

**方式二：Open-VSX 市场**
- [open-vsx.org](https://open-vsx.org/extension/decard/minimax-usage-statusbar)

**方式三：手动安装 VSIX**
1. 下载最新 `.vsix` 文件
2. VS Code 中 `Ctrl/Cmd + P` → `Extension: Install from VSIX...`

### 桌面版安装

| 平台 | 下载链接 |
|------|----------|
| macOS (Apple Silicon) | GitHub Release 下载 `.dmg` |
| macOS (Intel) | GitHub Release 下载 `.dmg` |
| Windows | GitHub Release 下载 `.exe` 安装包 |
| Linux | GitHub Release 下载 `.AppImage` / `.deb` / `.rpm` |

> 📌 [点击访问 GitHub Release 页面](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

## ⚙️ 配置步骤

### VS Code 插件

1. **安装插件后**，按 `Ctrl/Cmd + Shift + P`
2. 输入并选择 `MiniMax Usage: Set API Key`
3. 输入您的 MiniMax API Key
4. 按 `Enter` 确认

### 桌面版

1. 下载并安装对应平台的安装包
2. 首次启动会提示输入 API Key
3. 支持多 Key 管理，点击托盘图标查看详情

## 📋 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `minimaxUsage.refreshIntervalSeconds` | `60` | 自动刷新间隔（秒） |
| `minimaxUsage.showWeeklyInStatusBar` | `true` | 状态栏显示本周进度 |
| `minimaxUsage.detailModelLimit` | `5` | 模型明细展示条数 |
| `minimaxUsage.statusBarAlignment` | `right` | 状态栏位置 |
| `minimaxUsage.requestTimeoutMs` | `10000` | 请求超时（毫秒） |

## ⌨️ 命令

| 命令 | 说明 |
|------|------|
| `MiniMax Usage: Show Details` | 打开详情面板 |
| `MiniMax Usage: Set API Key` | 设置 API Key |
| `MiniMax Usage: Add API Key` | 添加多个 Key |
| `MiniMax Usage: Refresh` | 立即刷新 |
| `MiniMax Usage: Clear API Key` | 清除所有 Key |

## 📄 License

MIT License - 详见 [LICENSE](./LICENSE) 文件

## 🙏 致谢

基于 [Eyozy/minimax-usage](https://github.com/Eyozy/minimax-usage) 的 MiniMax Token Plan 用量查询逻辑。
