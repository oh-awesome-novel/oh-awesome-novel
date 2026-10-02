# 使用文档站

本站使用精确版本 `vitepress@2.0.0-alpha.20` 和原生默认主题，不包含自定义主题、组件或 CSS。

在仓库根目录执行：

```sh
npm install
npm run docs:dev
```

默认访问 `http://127.0.0.1:5174/`。

```sh
npm run docs:build
npm run docs:preview
```

构建输出：`wiki/.vitepress/dist/`；预览地址：`http://127.0.0.1:4174/`。

阅读入口：[使用文档](index.md)。页面编辑、截图更新与发布子路径配置见[文档维护](maintenance.md)。原有架构、设计与任务文档继续保存在仓库根目录的 `docs/`。
