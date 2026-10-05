# Application Icon Implementation Plan

Related task: [1320](../../tasks/1320.md)

## Design And Assets

- [x] 使用内置imagegen生成单一书页/笔尖图标，检查透明边缘与小尺寸辨识度。
- [x] 保存母版、完整prompt和设计说明；从母版生成PNG、ICNS和多尺寸ICO，资源纳入源码管理。
- [x] 启动页和浏览器favicon使用相同图标；彩色图标不随深色主题反相。

## Electron Integration

- [x] 按本地Forge/Electron/maker合同配置应用本体、Windows Setup和Linux包图标。
- [x] runtime资源从packaged extraResource或开发assets目录解析；macOS开发Dock与BrowserWindow一致。
- [x] 验证实际macOS bundle Info.plist、ICNS与runtime资源，执行既有packaged journey。

## Verification And Documentation

- [x] 检查图标容器格式、尺寸、alpha，运行受影响类型/构建检查。
- [x] 更新task状态和发行文档；区分本机验证与跨平台配置。

验证：macOS arm64应用本体图标、runtime资源、Vue构建及两进程packaged journey通过。Windows/Linux仅完成配置与资源核对，详见1320。
