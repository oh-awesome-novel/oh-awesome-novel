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

GitHub Pages 发布由 `.github/workflows/wiki-pages.yml` 完成：推送文档相关修改到 `main` 后自动构建并部署，也可从 Actions 手动运行。首次需将仓库 Pages 的发布来源设为 **GitHub Actions**，可通过 `gh` 命令完成。默认发布地址为 <https://oh-awesome-novel.github.io/oh-awesome-novel/>。

阅读入口：[使用文档](index.md)。页面编辑、截图更新与命令行发布步骤见[文档维护](maintenance.md)。原有架构、设计与任务文档继续保存在仓库根目录的 `docs/`。
