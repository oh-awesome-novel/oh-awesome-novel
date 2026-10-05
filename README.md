# oh-awesome-novel

`oh-awesome-novel` 是一个 filesystem-first 的长篇小说 AI Copilot / Novel IDE。

小说正文、角色卡、世界观、状态、时间线、伏笔、摘要与项目规则保存在 Markdown、YAML、对象文件树和 Git 历史中。AI 读取固定快照、在受限内存沙箱中形成候选修改，作者审阅 diff 并明确 Accept 后，系统才把不可变候选事务化写入真实文件。

## 项目定位

它不是通用 Agent 框架、黑箱自动代笔系统或私有数据库，而是为小说工程准备的本地 IDE：

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- Runtime 保持 Aider-style 极简 tool loop。
- 文件修改统一走 `bash-tool + just-bash + CandidateChangeSet + PendingAction + Git approval`。
- 任意 canonical 文件在作者 Accept 前必须保持字节不变。

## 核心能力

- Filesystem-first 小说工作区与细粒度对象文件树
- Novel Constitution、Workflow、Writing Profile 与 Skill 约束
- Vercel AI SDK Tool Calling 与 Aider-style Runtime
- 固定 `InMemoryFs` 投影、host-selected capability 与最终文档校验
- create / update / delete `CandidateChangeSet`
- PendingAction、diff 审阅、Accept / Reject 与崩溃恢复
- operation-aware `ChangeMaterializer` 与 Git auto-commit / quick commit
- 本地 HTTP backend、Vue workspace 与 Electron 桌面承载
- Reference Deconstruction、Reference Adoption 与 Play Adoption

## 架构概览

```text
Novel Constitution + Workflow
    ↓
Copilot Runtime (Aider-style)
    ↓
Vercel AI SDK ToolSet
    ↓
bash-tool / just-bash over fixed InMemoryFs
    ↓
CandidateChangeSet (create / update / delete)
    ↓
PendingAction + display-only diff
    ↓
Human Accept
    ↓
ChangeMaterializer transaction
    ↓
Object File Tree + Git
```

确定性的 Reference / Play producer 不需要伪造 shell 命令；它们直接生成同一种 `CandidateChangeSet`，并复用相同的审批、materialization 与 Git 边界。

## Monorepo 结构

```text
apps/
  desktop-ui/      Vue + Vite renderer
  desktop/         Electron shell
  http-backend/    standalone backend launcher

packages/
  core/            workspace/config/domain contracts
  tools/           read tools + Sandbox Change Engine
  runtime/         provider-agnostic Aider-style loop
  agent/           prompt/context/model composition
  backend/         local HTTP/SSE transport
  client/          strict frontend/backend client

__test__/          root-level test workspaces
docs/              architecture, specs, plans, tasks
wiki/              VitePress user guides and screenshots
examples/          local example workspaces and global config
reference-only/    research inputs, never product code
```

## 使用文档

面向作者的中文使用指南位于根目录 [wiki/](wiki/index.md)，使用 `vitepress@2.0.0-alpha.20` 原生默认主题。

```sh
npm install
npm run docs:dev
```

访问 `http://127.0.0.1:5174/`。构建文档执行 `npm run docs:build`，预览构建结果执行 `npm run docs:preview`。文档站独立运行，无需启动应用后端；截图清单见 [wiki/screenshots.md](wiki/screenshots.md)。

## 本地开发

桌面安装包由 GitHub Actions 构建，推送版本标签后发布到 [GitHub Releases](https://github.com/oh-awesome-novel/oh-awesome-novel/releases)。支持 macOS arm64/x64、Windows x64 和 Linux x64，不配置证书签名或公证。构建验证与发布步骤见 [Electron Release](docs/ELECTRON_RELEASE.md)。

优先使用独立 HTTP backend + Vite Web UI：

```sh
REPO_ROOT="$(pwd)"

npm run dev --workspace @oh-awesome-novel/http-backend -- \
  --workspace-root "$REPO_ROOT/examples/simple-novel" \
  --global-config-dir "$REPO_ROOT/examples/global" \
  --port 3210
```

另开终端：

```sh
npm run dev --workspace @oh-awesome-novel/desktop-ui
```

打开 `http://127.0.0.1:5173/`。完整配置与测试说明见 [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)。

提交前运行 `npm run quality`：依赖顺序构建、生产源码严格类型检查、七个测试 workspace、文档状态/术语检查和 Wiki 构建使用同一入口。PR、main 与发行前检查复用这条命令；发行只打包通过质量门禁的精确源码提交。

## 关键文档

- [Project Vision](docs/PROJECT_VISION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Filesystem Specification](docs/FILESYSTEM_SPEC.md)
- [Sandbox Change Engine](docs/SANDBOX_CHANGE_ENGINE.md)
- [Agent Runtime And Tools](docs/AGENT_RUNTIME_AND_TOOLS.md)
- [Human Approval And Git](docs/HUMAN_APPROVAL_AND_GIT.md)
- [Development Plan](docs/DEVELOPMENT_PLAN.md)
- [Development Tasks](docs/tasks/README.md)
- [Agent Operating Manual](docs/AGENT_OPERATING_MANUAL.md)

## 开发原则

- 不新增旧式根目录 `src/`；核心实现放在 `packages/*`，应用放在 `apps/*`。
- 测试放在根目录 `__test__/<module>/` 独立 workspace。
- frontend 不得直接访问 filesystem、tool execution 或 materializer。
- host shell、host filesystem、network、Python 与 JavaScript 不暴露给模型。
- diff、command log 与 mutation log 都不是 Accept authority。
- AI 产生的真实文件修改必须进入 PendingAction；Accept 后再按配置进行 Git commit。

## License

MIT
