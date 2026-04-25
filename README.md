# MiniMax Usage StatusBar (VS Code)

<p align="center">
  <img src="./images/icon.png" width="128" />
</p>

基于 [Eyozy/minimax-usage](https://github.com/Eyozy/minimax-usage) 的 MiniMax Token Plan 用量查询逻辑，封装成 VS Code 插件，并在状态栏展示详细信息。

## 功能

- 状态栏显示当前窗口用量（已用/总额/百分比）
- 状态栏按用量阈值自动显示不同颜色（正常/预警/高风险）
- 可选显示本周用量进度
- Hover 展示详细信息：状态、时间窗口、重置倒计时、模型明细
- 点击状态栏弹出三行彩色详情面板（含进度条）：
  - 已使用/剩余/总额度/窗口重置
  - 本周已使用/本周剩余/本周总额度/本周重置
  - 本周使用进度 xxx%
- 命令支持：
  - `MiniMax Usage: Show Details`
  - `MiniMax Usage: Set API Key`
  - `MiniMax Usage: Clear API Key`
  - `MiniMax Usage: Refresh`
  - `MiniMax Usage: Copy Raw Response`
- API Key 使用 VS Code Secret Storage 保存

## 快速开始

1. 在本目录执行：
   ```bash
   npm install
   npm run compile
   ```
2. 用 VS Code 打开本目录
3. 按 `F5` 启动 Extension Development Host
4. 在命令面板运行 `MiniMax Usage: Set API Key`
5. 状态栏查看结果（点击可刷新）

## 打包说明

如果需要导出为 `.vsix` 文件进行发布或本地安装：

1. 确保已安装编译环境：
   ```bash
   npm run compile
   ```
2. 执行打包命令：
   ```bash
   # 使用 package.json 中配置好的 script
   npm run package
   ```
3. 打包完成后，在该目录下会生成一个 `minimax-usage-statusbar-x.x.x.vsix` 文件。
4. **手动安装**：在 VS Code 插件面板点击 `...` -> `Install from VSIX...`，选择该文件即可。

## 独立桌面应用

仓库同时包含 Tauri 独立桌面应用：

- 后端：`src-tauri/`
- 前端：`src-web/`
- 跨平台构建说明：`docs/desktop-cross-platform-build.md`

常用命令：

```bash
npm ci
npm run tauri:dev
npm run tauri:build
```

GitHub Actions 会在 macOS、Linux、Windows 三个平台分别构建桌面安装包，并上传 workflow artifacts。

## 配置项

- `minimaxUsage.refreshIntervalSeconds`: 自动刷新间隔（秒）
- `minimaxUsage.showWeeklyInStatusBar`: 状态栏文本是否展示本周进度
- `minimaxUsage.detailModelLimit`: Tooltip 中展示的模型明细条数
- `minimaxUsage.statusBarAlignment`: 状态栏位置（left/right）
- `minimaxUsage.requestTimeoutMs`: 请求超时（毫秒）

## 说明

- 查询接口：`GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains`
- 数据字段含义与参考项目保持一致
- 倒计时每秒更新，查询结果按配置自动刷新
