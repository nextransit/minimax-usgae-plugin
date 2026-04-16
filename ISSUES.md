# 项目 Issues 与解决方案记录

## [已解决] vsce package 打包报错：Couldn't detect the repository
- **问题描述**: 当 `package.json` 中的 `repository.url` 为私有/内网 Git 地址（例如 `https://192.168.19.70/...`）时，由于 VSCE 无法像解析 GitHub/GitLab 公开项目那样自动推导原始图片链接地址，会在打包包含本地相对路径图片（如 `<img src="./images/icon.png">`）的 `README.md` 时报错阻止打包。
- **解决方案**: 在 `package.json` 的 `scripts` 中封装命令，通过添加 `--baseContentUrl` 和 `--baseImagesUrl` 手动提供图片在线解析的基础 URL，例如：`vsce package --baseContentUrl https://192.168.19.70/ai/minimax-usgae-plugin/-/raw/master --baseImagesUrl https://192.168.19.70/ai/minimax-usgae-plugin/-/raw/master`。此后使用 `npm run package` 进行打包。

## [已解决] VS Code 插件商店发布不支持 SVG 图标
- **问题描述**: 在配置 `package.json` 的 `icon` 字段时，VS Code Marketplace 安全策略限制不支持直接上传 `SVG` 格式文件。
- **解决方案**: AI 设计完矢量 `icon.svg` 后，在本地调用 `npx svgexport` 命令行工具，将其静默渲染为 `256x256` 尺寸的高清 `icon.png` 文件，成功规避格式兼容性问题。
