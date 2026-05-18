# Changelog

All notable changes to this project will be documented in this file.

## 0.0.11

- 修复风险告警误报：将当前窗口和每周配额分开判断，避免每周剩余低时误报为当前窗口耗尽
- 告警消息明确标注「每周」以区分时间窗口

## 0.0.10

- 完善多 API Key、悬停显示、桌面版功能

## 0.0.9

- 统一桌面端构建与发布 CI 流程
- 修复 countdown 闪烁、状态栏 per-key tooltip
- 修复 webview HTML 重建、状态栏百分比四舍五入

## 0.0.8

- add direct Marketplace publish script
- add GitLab CI automatic Marketplace publishing on `v*` tags
- add release validation for tag/version matching and `VSCE_PAT`
- update packaging rules for Marketplace-friendly extension bundles

## 0.0.7

- initial local `.vsix` based release
