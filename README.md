# oh-awesome-novel

`oh-awesome-novel` 是一个 filesystem-first 的长篇小说 AI Copilot / Novel IDE。

它面向长篇小说创作，把小说项目保存在 Markdown、YAML、对象文件树和 Git 历史中；AI 作为 Copilot 读取上下文、调用工具、提出修改，并通过可审阅 diff 交给作者确认。

## 项目定位

`oh-awesome-novel` 不是通用 Agent 框架，也不是黑箱自动代笔系统。它更接近一个为小说工程准备的本地 IDE：

- 小说正文、角色卡、世界观、时间线、伏笔、摘要和状态都落在文件系统中。
- Git 负责历史、diff、回滚、审阅和提交。
- AI 只提出修改意图，不静默写入正式小说文件。
- 文件修改走 `SemanticPatch -> Apply Engine -> Diff Preview -> Accept / Reject`。
- Runtime 保持 Aider-style 极简循环，不引入重型多 Agent 平台。

## 核心能力

- Filesystem-first 小说工作区
- Markdown / YAML 对象文件树
- Novel Constitution 与 Workflow 约束
- 角色、世界观、章节、状态、时间线、伏笔、摘要等领域工具
- Vercel AI SDK tool calling 接入
- 本地 HTTP backend + Vue web workspace
- Electron 桌面承载
- PendingAction 审阅流
- Git diff human approval
- 参考作品导入与拆解
- Play / Roleplay Sandbox 方向规划

## 架构概览

```text
Novel Constitution
    ↓
Workflow
    ↓
Copilot Runtime (Aider-style)
    ↓
Vercel AI SDK Tool Calling
    ↓
Tool Registry
    ↓
Markdown / YAML Engine
    ↓
SemanticPatch Apply Engine
    ↓
Object File Tree
    ↓
Git + Human Approval
```

## Monorepo 结构

```text
apps/
  desktop-ui/      Vue + Vite web workspace
  desktop/         Electron shell
  http-backend/    Standalone HTTP backend launcher

packages/
  core/            workspace/config/provider 纯核心能力
  tools/           Markdown/YAML domain tools
  runtime/         Aider-style runtime loop
  agent/           prompt/context assembly + model bridge
  backend/         local HTTP/SSE transport
  client/          frontend/backend client

__test__/          root-level test workspaces
docs/              architecture, specs, plans, tasks
examples/          local example workspaces and global config
reference-only/    reference projects, not product code
```

## 本地开发

优先使用独立 HTTP 后端 + Vite Web UI 进行开发：

```sh
REPO_ROOT="$(pwd)"

npm run dev --workspace @oh-awesome-novel/http-backend -- \
  --workspace-root "$REPO_ROOT/examples/simple-novel" \
  --global-config-dir "$REPO_ROOT/examples/global" \
  --port 3210
```

另开一个终端：

```sh
npm run dev --workspace @oh-awesome-novel/desktop-ui
```

打开：

```text
http://127.0.0.1:5173/
```

更完整的启动、配置、测试说明见 [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)。

## 关键文档

- [docs/PROJECT_VISION.md](docs/PROJECT_VISION.md): 项目愿景、边界和非目标
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): 当前架构蓝图
- [docs/FILESYSTEM_SPEC.md](docs/FILESYSTEM_SPEC.md): 小说项目文件系统规格
- [docs/APPLY_ENGINE.md](docs/APPLY_ENGINE.md): SemanticPatch 与 Apply Engine
- [docs/HUMAN_APPROVAL_AND_GIT.md](docs/HUMAN_APPROVAL_AND_GIT.md): 写入确认与 Git 工作流
- [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md): 分阶段开发计划
- [docs/tasks/README.md](docs/tasks/README.md): 可执行任务列表
- [docs/AGENT_OPERATING_MANUAL.md](docs/AGENT_OPERATING_MANUAL.md): 开发 Agent 操作手册

## 开发原则

- 不新增旧式根目录 `src/`。
- 测试放在根目录 `__test__/` 对应 workspace 中。
- 不让 frontend 绕过 backend 直接访问 filesystem/tools/apply engine。
- 不把运行时私有状态当作小说项目的事实来源。
- AI 生成的真实文件修改必须进入 PendingAction 审阅。
- 接受 PendingAction 后，按配置进行 Git commit。

## License

MIT
