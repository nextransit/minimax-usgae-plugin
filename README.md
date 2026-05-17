# MiniMax Usage Monitor

<p align="center">
  <img src="./images/icon.png" width="128" />
</p>

<p align="center">
  <strong>多 API Key · 智能悬停 · 桌面原生</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=decard.minimax-usage-statusbar">
    <img src="https://img.shields.io/badge/VS%20Code-007ACC?style=flat-square&logo=visual-studio-code" alt="VS Code" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
</p>

---

## ⚠️ 隐私声明

**本插件仅显示 API Key 的用量信息。您的 API Key 通过 VS Code Secret Storage / 操作系统 Keychain 本地安全存储，不对外传输。**

---

## ✨ 核心功能

### 🔑 多 API Key 管理

支持同时管理多个 API Key，在状态栏独立显示 `ALL / Key1 / Key2 / ...` 胶囊按钮，一键切换查看不同 Key 的用量，实时汇总显示总用量。

![多 API Key 管理](./images/screenshot-multi-key.png)

### 🖱️ 智能悬停预览

鼠标悬停状态栏即可查看快速预览，按 Key 显示已用 / 剩余 / 百分比，高亮显示用量异常 Key。

![悬停预览](./images/screenshot-hover.png)

### 💻 桌面版原生支持

独立 Tauri 桌面应用，支持 macOS / Windows / Linux，原生系统托盘运行，启动时自动后台刷新。

![桌面版](./images/screenshot-desktop.png)

### 📊 详情面板

点击状态栏打开详情面板，查看当前周期用量进度、本周累计用量、模型明细表格、风险预警提示。

![详情面板](./images/screenshot-details.png)

### 📌 状态栏显示

状态栏实时显示当前选中 Key 的用量百分比，可切换显示本周累计。

![状态栏](./images/screenshot-statusbar.png)

---

## 📦 安装

### VS Code 插件

**方式一：VS Code 市场（推荐）**
1. 打开 VS Code
2. 搜索 `MiniMax Usage`
3. 点击安装

**方式二：Open-VSX 市场**
- [open-vsx.org](https://open-vsx.org/extension/decard/minimax-usage-statusbar)

**方式三：手动安装 VSIX**
1. 下载最新 `.vsix` 文件
2. VS Code 中 `Ctrl/Cmd + P` → `Extension: Install from VSIX...`

### 桌面版

| 平台 | 下载 |
|------|------|
| macOS (Apple Silicon / Intel) | [.dmg 安装包](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Windows | [.exe 安装包](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Linux | [.AppImage / .deb / .rpm](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |

> 📌 [点击访问 GitHub Release 页面下载桌面版](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

---

## ⚙️ 配置

### VS Code 插件

1. **安装插件后**，按 `Ctrl/Cmd + Shift + P`
2. 输入并选择 `MiniMax Usage: Set API Key`
3. 输入您的 MiniMax API Key
4. 按 `Enter` 确认

> 💡 添加多个 Key：使用 `MiniMax Usage: Add API Key` 命令

### 桌面版

1. 下载并安装对应平台的安装包
2. 首次启动提示输入 API Key
3. 支持多 Key 管理，点击托盘图标查看详情

### 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `minimaxUsage.refreshIntervalSeconds` | `60` | 自动刷新间隔（秒） |
| `minimaxUsage.showWeeklyInStatusBar` | `true` | 状态栏显示本周进度 |
| `minimaxUsage.detailModelLimit` | `5` | 模型明细展示条数 |
| `minimaxUsage.statusBarAlignment` | `right` | 状态栏位置 |
| `minimaxUsage.requestTimeoutMs` | `10000` | 请求超时（毫秒） |

---

## ⌨️ 命令面板

| 命令 | 说明 |
|------|------|
| `MiniMax Usage: Show Details` | 打开详情面板 |
| `MiniMax Usage: Set API Key` | 设置 API Key |
| `MiniMax Usage: Add API Key` | 添加多个 Key |
| `MiniMax Usage: Refresh` | 立即刷新 |
| `MiniMax Usage: Clear API Key` | 清除所有 Key |

---

## 📄 License

**MIT License** - 详见 [LICENSE](./LICENSE) 文件

---

*本插件仅用于显示 API Key 用量信息，您的 API Key 本地安全存储，不对外传输。*
