# 发布包启动器模板

此目录属于源码工程，是打包时复制到预构建版本根目录的模板。源码工程请在项目根目录使用 `npm ci` 和 `npm run dev`，不要直接运行本目录的 Start.cmd。

`tools/package-release.py` 会把这些启动器与完整 dist 产物组合到生产 ZIP，生产 ZIP 内的 Start.cmd 才是双击启动入口。
