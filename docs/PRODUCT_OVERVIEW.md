# Product Overview

`oh-awesome-novel` 是一个面向长篇小说创作的桌面 Novel IDE。它不是通用 Agent 平台，而是把小说项目直接组织成 Markdown / YAML 文件树，让作者在本地文件、Git 历史和 AI Copilot 之间工作。

产品的完整形态可以概括为：

```text
桌面 Novel IDE
  + filesystem-first 小说工程
  + Writing / Play 顶级工作模式
  + Writing 中央 Agent Copilot
  + Play 互动世界工作区
  + 右侧真实文件查看 / diff 预览
  + PendingAction 人类审批
  + Git 历史与回滚
```

## 产品体验

作者打开应用后，先进入全局 workspace 列表。这里可以新建、打开、导入、改名或移除最近使用的小说项目，也可以切换 Light / Dark 外观和配置 LLM Provider。

新建 workspace 后，应用会进入一个可跳过的创作引导：填写小说名字、基础灵感、角色方向，并选择先生成角色卡、规划第一章或开始写章节。引导不会绕过审批写入正文，而是把这些信息保存到 workspace config，并整理成 Copilot 的第一条工作请求。

进入 workspace 后，作者先在同层级的 `Writing | Play` 顶级模式间切换：

- Writing 是小说编写工作台，面向正文、对象文件、Copilot 和 PendingAction。
- Play 是互动世界工作台，面向 session、角色、场景、世界事件、Play-local state 和 adoption。

Play 不是 Writing 右侧面板中的一个 tab。两种模式共享同一个小说 workspace、canonical sources、provider 与审批基础设施，但各自拥有完整的主区域、导航状态和内部布局。

Writing 界面采用三栏工作区：

- 左侧是文件树和章节导航。
- 中间是 Novel Agent Copilot，是主要交互区。
- 右侧是真实文件内容查看器、workspace 首页和后续 diff / 上下文视图承载区。

Play 界面使用独立主工作区：中间承载 transcript / narrative 与 action composer，两侧或可折叠区域承载 scene / cast、world HUD、事件、上下文和 adoption。Play 内部可以使用右侧 inspector，但不能复用“右栏 Play tab”作为整个模式的容器。

Copilot 会读取 `.oan/workflow.yaml`、constitution、summary、state、timeline、foreshadow、角色卡和章节正文等项目文件，并通过工具调用提出修改建议。所有正文、角色、状态、时间线、伏笔、摘要等写入都先生成 PendingAction，作者接受后才会写入真实文件。

## 当前功能

- Workspace 管理：新建空 workspace、导入已有 OAN workspace、打开最近项目、重命名、移除、刷新列表。
- 新建引导：小说名、基础灵感、角色生成方向、开始写作目标，可跳过。
- Light / Dark：应用级主题切换，配置经由 core / desktop 封装，不由 UI 直接操作 localStorage。
- Provider 配置：应用级 LLM Provider 设置入口，workspace 进入时有 provider gate。
- Filesystem-first 项目结构：`chapters/`、`characters/`、`world/`、`state/`、`timeline/`、`foreshadow/`、`summaries/`、`.oan/`。
- 文件浏览：workspace 文件树、文件内容只读查看。
- 章节导航：按卷和章节扫描 `chapters/<volume>/<chapter>.md`，支持重新扫描章节索引。
- Novel Agent Copilot：中央聊天区、快捷指令、工具活动记录、流式输出。
- 快捷指令：`/生成角色卡`、`/规划下一章`、`/写下一章`、`/整理本章`、`/审稿`、`/更新状态`、`/补伏笔`、`/去AI味`。
- PendingAction 审批：列出、接受、拒绝待写入修改；接受后才落盘。
- 写作工具：章节草稿、章节摘要、角色 personality、state、timeline、foreshadow 等写入意图工具。
- 本地 backend：Electron 启动本地 HTTP backend，UI 通过 client 封装调用，不关心底层是 HTTP 还是 Electron IPC。
- Agent loop：Aider-style 多轮 tool calling，工具结果回填，PendingAction event 输出。
- Git 状态：workspace 首页显示当前 git clean / dirty / unknown 状态和待审批数量。

## 产品边界

AI 是 Copilot，不是小说数据所有者。项目的事实来源始终是文件树和 Git 历史。

当前产品不追求重型多 Agent 平台、自动后台写作、私有数据库或隐藏记忆系统。写作体验的核心是：作者提出意图，Copilot 阅读项目文件并提出 PendingAction，作者通过 diff / 文件视图确认后再写入。

后续演进重点包括全局搜索、Git 历史与同步页面、SemanticPatch Apply Engine 完整落地、摘要工作流 polish，以及更完整的文件 diff / 上下文查看体验。
