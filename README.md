# MiniMax Usage StatusBar (VS Code)

基于 [Eyozy/minimax-usage](https://github.com/Eyozy/minimax-usage) 的 MiniMax Token Plan 用量查询逻辑，封装成 VS Code 插件，并在状态栏展示详细信息。

## 功能

- 状态栏显示当前窗口用量（已用/总额/百分比）
- 可选显示本周用量进度
- Hover 展示详细信息：状态、时间窗口、重置倒计时、模型明细
- 命令支持：
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
