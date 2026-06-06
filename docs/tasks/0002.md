# 0002 Desktop Build Foundation

> Status: Completed
> Milestone: M1 Project Scaffolding
> Completed in: `8bbdb1f feat(desktop): serve renderer with tsdown forge plugin`

## Goal

建立 Electron desktop 的开发和打包基础，让 main/preload 使用 `tsdown`，renderer 保持独立 Vite 工程。

## Delivered

- `packages/forge-plugin-tsdown` 负责构建 Electron main/preload。
- `apps/desktop` 使用 `@oh-awesome-novel/forge-plugin-tsdown`。
- `apps/desktop-ui` 保持独立 Vite/Vue renderer 工程。
- `electron-forge start` 时插件通过 Vite JS API 启动 renderer dev server。
- 插件把 renderer dev server URL 写入 `OAN_DESKTOP_UI_DEV_SERVER_URL`。
- Forge 日志显示 renderer root、dev server env 和 local URL。
- package 阶段仍从 renderer `dist` 复制静态产物。

## Done Criteria

- `npm run build --workspace @oh-awesome-novel/forge-plugin-tsdown` 通过。
- `electron-forge start` 能先启动 renderer dev server，再启动 Electron。
- Electron main process 能通过 env 加载 renderer dev server。
- renderer 生产构建仍由 `apps/desktop-ui` 自己执行。

## Non Goals

- 不把 renderer 打包逻辑塞进 tsdown。
- 不把 desktop-ui 合并进 desktop package。
- 不引入额外 dev server CLI 包装层。
