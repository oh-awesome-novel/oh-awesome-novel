# 文档维护

本文面向维护这份使用文档的贡献者。阅读应用使用说明，请从[安装与启动](./guide/getting-started.md)开始。

## 本地预览

仓库要求 Node.js 24 和 npm。在仓库根目录安装依赖后启动：

```sh
npm install
npm run docs:dev
```

访问 `http://127.0.0.1:5174/`。修改 Markdown 后会自动刷新。文档站可独立运行，无需启动小说应用或配置模型。

## 文件位置

| 路径（相对于仓库根目录） | 用途 |
| --- | --- |
| `wiki/index.md` | 使用文档首页 |
| `wiki/guide/` | 面向作者的操作指南 |
| `wiki/.vitepress/config.mts` | 中文导航、侧边栏和本地搜索 |
| `wiki/public/screenshots/` | 实际应用界面截图 |
| `wiki/screenshots.md` | 截图清单、来源与补图状态 |
| `docs/` | 项目架构、设计、计划与任务，继续单独维护 |

文档使用 VitePress 原生默认主题。不要新增自定义 CSS、覆盖主题或引入仅用于装饰的组件。

## 更新操作说明

1. 从实际界面确认入口、按钮文字和操作顺序。
2. 核对后端是否已接入，避免把计划、占位按钮或底层工具写成可用功能。
3. 用“在哪里操作、填写什么、点击后会发生什么”的顺序写步骤。
4. 涉及正式稿修改时，明确审阅、接受、拒绝与 Git 提交的区别。
5. 更新页面链接和对应截图；无法运行应用时，保留清楚的待补说明，先交付准确文字。

本地页面链接使用相对 Markdown 链接，例如 `[认识工作区](./guide/workspace.md)`。新增页面后，把它加入 `.vitepress/config.mts` 的侧边栏。

## 更新界面截图

截图应来自当前应用的真实界面。使用独立的演示工作区与全局配置目录，不加载私人小说、真实 API Key 或用户正在使用的数据。具体清单和运行记录见[截图说明](./screenshots.md)。

推荐流程：

1. 启动本地 HTTP backend 与桌面 Web UI，指定隔离的演示目录。
2. 使用中文界面、统一浅色主题与窗口尺寸，完成页面中的对应步骤。
3. 等待加载完成，确认文字可读、没有密钥或私人路径后截图。
4. 保存为语义明确的 PNG 或 JPG 文件，例如 `workspace.jpg`，放入 `public/screenshots/`。
5. 在相应步骤附近插入截图，提供描述操作位置的替代文本，并更新截图清单。

例如，**实际文件存在后**才加入：

```md
![工作区中左侧的文件导航与中央的 Copilot 面板](/screenshots/workspace.jpg)
```

不要用界面草图、合成图片或模拟成功状态替代实拍截图。涉及 AI 生成或审批的页面，应说明截图使用的是哪种演示数据；截图本身不能证明模型调用或审批成功。

## 构建检查

```sh
npm run docs:build
npm run docs:preview
```

默认预览地址为 `http://127.0.0.1:4174/`。构建会检查页面间的无效链接；构建后还应在浏览器检查图片、侧边栏、文档搜索、深浅色模式和窄屏导航。

构建输出在 `wiki/.vitepress/dist/`，已通过仓库的 `.gitignore` 排除，不要提交生成文件或缓存。

## GitHub Pages 自动发布

流水线文件为 `.github/workflows/wiki-pages.yml`。`main` 分支的 `wiki/**`、根依赖清单和锁文件、`.npmrc` 或流水线自身更新时，会自动构建并发布。也支持手动运行。

首次发布需要仓库管理员将 **Settings → Pages → Build and deployment → Source** 设为 **GitHub Actions**。也可以在本机登录 `gh` 后执行以下命令，无需打开设置页面：

```sh
gh auth status
gh api --method POST repos/oh-awesome-novel/oh-awesome-novel/pages -f build_type=workflow
```

如果已经启用 Pages，改用更新命令：

```sh
gh api --method PUT repos/oh-awesome-novel/oh-awesome-novel/pages -f build_type=workflow
```

配置文件提交并推送到 `main` 后会自动触发首次发布。手动重新发布、查看最近运行和站点状态：

```sh
gh workflow run wiki-pages.yml --repo oh-awesome-novel/oh-awesome-novel --ref main
gh run list --repo oh-awesome-novel/oh-awesome-novel --workflow wiki-pages.yml --limit 5
gh api repos/oh-awesome-novel/oh-awesome-novel/pages --jq '{build_type, status, html_url}'
```

通过 `gh run watch <运行ID> --repo oh-awesome-novel/oh-awesome-novel --exit-status` 等待某次运行结束；失败时用 `gh run view <运行ID> --repo oh-awesome-novel/oh-awesome-novel --log-failed` 查看错误。

默认站点地址为 <https://oh-awesome-novel.github.io/oh-awesome-novel/>。流水线从 Pages 配置读取实际子路径，通过构建参数注入 VitePress 的 `base`，保证导航、截图和搜索资源使用正确地址。将来配置自定义域名后，重新运行流水线即可使用更新后的路径。本地开发仍使用 `/`。

流水线使用 Node.js 24、锁文件和根依赖构建文档，跳过安装脚本及其他 workspace 的安装。安装时将锁文件中的 `registry.npmmirror.com` 地址映射到 `.npmrc` 配置的 npm 官方源，保留锁定版本和完整性校验。部署使用 GitHub 自动提供的 `GITHUB_TOKEN` 和 OIDC；无需额外配置 PAT、SSH 密钥或 `gh-pages` 分支。若组织限制了 Actions，需要允许流水线中的官方 `actions/*`；若 `github-pages` 环境要求人工审批，需要在部署时完成该审批。

在本地检查与 Pages 相同的子路径：

```sh
npm run docs:build -- --base /oh-awesome-novel/
npm run docs:preview -- --base /oh-awesome-novel/
```

访问 `http://127.0.0.1:4174/oh-awesome-novel/`，检查页面、截图和搜索。

配置方式见 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)；命令行设置见 [Pages REST API](https://docs.github.com/en/rest/pages/pages)。

## 部署到其他静态服务器

将构建输出目录作为静态网站根目录即可。默认构建使用根路径 `/`；部署到子路径时，通过命令指定后重新构建，例如 `npm run docs:build -- --base /oh-awesome-novel/`。

VitePress 版本固定为 `2.0.0-alpha.20`。配置写法可查阅 [VitePress 官方文档](https://vitepress.dev/guide/getting-started)；升级版本时同时复核配置与锁文件。
