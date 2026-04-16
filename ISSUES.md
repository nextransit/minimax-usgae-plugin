# 项目 Issues 与解决方案记录

## [已解决] VS Code 插件商店发布不支持 SVG 图标
- **问题描述**: 在配置 `package.json` 的 `icon` 字段时，VS Code Marketplace 安全策略限制不支持直接上传 `SVG` 格式文件。
- **解决方案**: AI 设计完矢量 `icon.svg` 后，在本地调用 `npx svgexport` 命令行工具，将其静默渲染为 `256x256` 尺寸的高清 `icon.png` 文件，成功规避格式兼容性问题。
