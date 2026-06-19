# Workspace Frontend Layout Plan

> Status: Draft  
> Scope: OAN desktop-ui workspace shell, left navigation, center agent, right review panel.  
> Reference: `reference-only/OpenHands/frontend` is used only as UI interaction reference. Do not copy its React/Zustand/React Router implementation into OAN.

## Goal

把 OAN 主工作界面调整为更接近 Codex 的工作台：

```text
left navigation / file tree
    +
center agent conversation
    +
right file / diff / approval workspace
```

目标不是把 OpenHands 迁移进来，而是吸收它在 conversation workspace 上的交互经验：

- 中间 agent 始终是主工作区。
- 右侧是可隐藏、可切换内容的审阅工作区。
- 左侧是可隐藏的全局导航和文件入口。
- 审批操作不能只藏在右栏；当右栏隐藏时，中间 agent 区域仍然要能完成 PendingAction 审核。
- 消息展示要从简单 transcript 升级为“正文消息 + 工具活动 + 结构化产物 + 审批入口”的工作流时间线。

## Current OAN State

当前主要入口：

- `apps/desktop-ui/src/components/workspace/WorkspaceShell.vue`
- `apps/desktop-ui/src/components/workspace/FileTreePanel.vue`
- `apps/desktop-ui/src/components/workspace/ChapterNavigationView.vue`
- `apps/desktop-ui/src/components/workspace/CopilotPanel.vue`
- `apps/desktop-ui/src/components/workspace/FileViewer.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/ChatTranscript.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/ToolActivityList.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/PendingActionPanel.vue`

当前布局已经是三栏，但存在几个问题：

- 左栏只能普通显示/隐藏，隐藏后没有靠边悬浮唤回机制。
- 右栏是固定 `FileViewer` / `WorkspaceHome`，还不是多用途审阅工作区。
- PendingAction 审批在 `CopilotPanel` 内部，和右侧文件/diff 视图割裂。
- 右栏隐藏时，审核能力没有明确的中间区降级方案。
- `ChatTranscript.vue` 只把 UIMessage 拼成纯文本，缺少 tool、artifact、pending action、error、review report 等事件形态。
- `PendingActionPanel.vue` 当前直接展示 unified diff 文本，没有按文件、旧版/新版/diff、Markdown preview 等审阅模式。

## OpenHands Reference Points

### Workspace Layout

OpenHands 的 conversation 工作台主要参考：

- `reference-only/OpenHands/frontend/src/components/features/conversation/conversation-main/conversation-main.tsx`
- `reference-only/OpenHands/frontend/src/components/features/conversation/conversation-tabs/conversation-tabs.tsx`
- `reference-only/OpenHands/frontend/src/components/features/conversation/conversation-tabs/conversation-tab-content/conversation-tab-content.tsx`
- `reference-only/OpenHands/frontend/src/hooks/use-resizable-panels.ts`
- `reference-only/OpenHands/frontend/src/utils/conversation-local-storage.ts`

可吸收点：

- 右侧 panel 可隐藏，隐藏后中间 chat 占满可用宽度。
- 右侧 panel 以 tab 承载多种工作视图。
- 右侧 panel 宽度可拖拽，并持久化到本地。
- tab 选择和 panel 显隐按 conversation 持久化。
- 点击当前 active tab 可关闭 panel，点击其他 tab 会打开并切换。
- 移动端把右侧 panel 变成 bottom sheet，而不是硬塞三栏。

OAN 应改写为 Vue composable 和 SFC，不吸收 React/Zustand 技术栈。

### Diff And Review

OpenHands diff 相关参考：

- `reference-only/OpenHands/frontend/src/routes/changes-tab.tsx`
- `reference-only/OpenHands/frontend/src/components/features/diff-viewer/file-diff-viewer.tsx`
- `reference-only/OpenHands/frontend/src/components/features/diff-viewer/editor-container.tsx`

可吸收点：

- diff 按文件分组显示。
- 每个文件默认折叠，展开时再加载/渲染内容。
- 每个文件可切换 `old` / `diff` / `new`。
- Markdown 文件可显示 rendered preview。
- added / deleted / modified / renamed / untracked 状态有图标和短标签。
- diff viewer 是审阅工作区的一部分，而不是聊天消息里的长文本。

OAN 第一版不必立刻引入 Monaco，可以先做结构化 diff shell；后续再决定是否使用 Monaco/Vue 适配器。

### Message Display

OpenHands 消息相关参考：

- `reference-only/OpenHands/frontend/src/components/features/chat/messages.tsx`
- `reference-only/OpenHands/frontend/src/components/features/chat/chat-message.tsx`
- `reference-only/OpenHands/frontend/src/components/features/chat/event-message.tsx`
- `reference-only/OpenHands/frontend/src/components/shared/buttons/confirmation-buttons.tsx`
- `reference-only/OpenHands/frontend/src/components/shared/buttons/v1-confirmation-buttons.tsx`

可吸收点：

- 消息不是只有 user/assistant 两类文本，而是事件流。
- action 和 observation 可以配对展示，避免工具调用日志把主线聊天冲散。
- 最后一条需要确认的 agent action 会内联显示确认入口。
- hover 时显示 copy/action 按钮，减少常驻噪音。
- optimistic user message 让发送后立刻有反馈。
- agent running、typing、error、finish、reject 等状态有独立消息组件。
- 高风险动作在确认按钮前显示风险提示。
- 确认/拒绝有快捷键，并防重复提交。

OAN 的消息模型应围绕 AI SDK `UIMessage.parts` 做转换，不需要采用 OpenHands 的 runtime event schema。

## Target UX

### Desktop Layout

桌面布局目标：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Toolbar                                                            │
├───────────────┬───────────────────────────────┬────────────────────┤
│ Left Nav      │ Agent Conversation             │ Right Review Panel │
│ Files/Chapters│ Messages + Tool/Artifact Flow  │ File/Diff/Approval │
│ Search        │ Composer + inline approvals    │ Context/Health     │
└───────────────┴───────────────────────────────┴────────────────────┘
```

左栏显示时：

- 作为正常布局列参与宽度计算。
- 默认宽度可保持当前宽度，后续可加拖拽。
- 包含 Files / Chapters / Search / Pending count 等入口。

左栏隐藏时：

- 中间 agent 区域向左扩展。
- 页面左边缘保留一个不可见或轻微可见的 hover zone，宽度约 10-20px。
- 鼠标进入 hover zone 后，显示悬浮左栏。
- 悬浮左栏高度仍然占满 workspace 内容区高度。
- 悬浮左栏覆盖在内容上，不挤压中间 agent。
- 鼠标离开悬浮左栏后延迟关闭，避免误触。
- 用户点击 pin / toggle 后恢复为常驻左栏。

右栏显示时：

- 作为正常布局列参与宽度计算。
- 中间 agent 宽度随右栏显示而收缩。
- 右栏内容由 tab 控制，而不是固定文件查看器。
- 右栏至少包含 `File`、`Diff`、`Approval`、`Health` 四个 tab。

右栏隐藏时：

- 中间 agent 区域扩展到右侧。
- toolbar 或 agent header 保留右栏唤回按钮。
- PendingAction 审批能力降级到中间 agent 区域。
- 中间 agent 内的 PendingAction card 要能完成 accept / reject。
- 如果用户需要查看完整 diff，中间 card 提供 `Open review panel`，点击后打开右栏 `Approval` 或 `Diff` tab。

### Mobile Layout

移动端不做三栏：

- 左栏作为 drawer。
- 右栏作为 bottom sheet 或 full-screen sheet。
- 中间 agent 默认占满屏幕。
- PendingAction 可在 agent 消息流内审核。

## Right Panel Tabs

第一版建议 tab：

| Tab | Purpose | Content |
| --- | --- | --- |
| `File` | 当前选中文件只读查看 | 替代当前 `FileViewer.vue` |
| `Diff` | 当前 dirty / selected PendingAction diff | 按文件折叠，支持 old/diff/new 的结构 |
| `Approval` | PendingAction 审批队列 | accept/reject、风险提示、touched files、状态 |
| `Health` | 工作区状态 | Project health、Git dirty、PendingAction count |

后续可扩展：

| Tab | Purpose |
| --- | --- |
| `Context` | 当前 agent run 的 Context Package |
| `Artifacts` | session artifacts、author report、prewrite check、settlement bundle |
| `Play` | Play Mode / Scene Rehearsal session |

## Center Agent Behavior When Right Panel Is Hidden

右栏隐藏不能让用户失去审核能力。

中间 agent 区域需要保留两层审批入口：

1. **Inline PendingAction summary**
   - 在消息流中显示 PendingAction 标题、目标文件、短 diff 摘要。
   - 支持 accept / reject。
   - 支持 `Review` 按钮打开右栏。

2. **Compact approval tray**
   - 如果有未处理 PendingAction，在 composer 上方或 agent header 下方显示 compact tray。
   - 展示数量、最近一项标题、`Review all`、`Accept`、`Reject`。
   - 当右栏隐藏时可展开成中间 overlay。

规则：

- accept / reject 必须调用 backend approval API。
- 不允许前端本地标记成功后再等待 backend。
- 完整 diff 审阅默认鼓励去右栏完成。
- 中间区 quick accept 只适合低风险、小变更，仍要能看到 diff 摘要。
- 高风险或多文件 PendingAction 不显示一键 accept，只显示 `Review`。

## Message Display Upgrade

把 `ChatTranscript.vue` 从纯文本列表升级为结构化消息流。

### Message Types

建议第一版转换为以下 UI items：

| Type | Source | Display |
| --- | --- | --- |
| `user-message` | `UIMessage.role === "user"` | 右侧/紧凑气泡，可复制 |
| `agent-message` | assistant text parts | 主体 Markdown 文本，可复制 |
| `tool-activity` | `tool-*` / `data-tool-log` parts | 可折叠工具活动块 |
| `pending-action` | `data-pending-action` parts + persisted pending actions | 审批卡片 |
| `artifact` | future session artifacts | Prewrite check / settlement / report card |
| `error` | failed request / backend error | 错误卡 |
| `status` | streaming / stopped / completed | 小型状态行 |

### OpenHands-Inspired Rules

- user message 可以右对齐；agent message 以宽文本区显示。
- tool activity 默认折叠，只显示工具名、状态、目标文件。
- tool result 只在用户展开时显示，避免污染写作主线。
- PendingAction 是一等消息卡，不再只是工具日志。
- 最后一条等待确认的 PendingAction 可以带固定操作区。
- message hover 时显示 copy / jump-to-file / open-diff 等轻量操作。
- 错误、拒绝、完成、等待 provider 等状态使用独立行。
- 不要在消息流里渲染巨大 diff；显示摘要，完整 diff 去右栏。

### OAN-Specific Message Shape

实现时不要引入 OpenHands event schema。建议新增前端 adapter：

```text
UIMessage[]
    -> AgentTimelineItem[]
    -> AgentTimeline.vue
```

`AgentTimelineItem` 只服务前端展示，不改变 backend 协议。

第一版可以放在：

- `apps/desktop-ui/src/composables/useAgentTimeline.ts`
- `apps/desktop-ui/src/components/agent-checkpoint/AgentTimeline.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/AgentMessage.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/ToolActivityBlock.vue`
- `apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue`

## Component Plan

### Workspace Shell Layer

`WorkspaceShell.vue`

- 保持 workspace 数据加载和高层编排。
- 不继续堆更多面板细节。
- 负责把当前文件、PendingAction、status、health 传给布局组件。

新增：

- `WorkspaceWorkbench.vue`
  - 单一职责：组合 left / center / right 三个区域。
  - Props：workspace state、active file、pending actions、panel state。
  - Emits：open file、select tab、accept/reject、toggle panels。

- `WorkspaceLeftPanel.vue`
  - 单一职责：Files / Chapters / Search 导航。
  - 替代当前 `WorkspaceShell.vue` 中的 sidebar template。

- `WorkspaceLeftHoverRail.vue`
  - 单一职责：左边缘 10-20px hover detector 和悬浮左栏容器。
  - 只在左栏隐藏且桌面宽度时启用。

- `WorkspaceRightPanel.vue`
  - 单一职责：右侧 tab panel 容器。
  - 控制 `File` / `Diff` / `Approval` / `Health` tab。

- `WorkspacePanelTabs.vue`
  - 单一职责：右栏 tab 导航和 close/toggle。

### Composables

新增：

- `useWorkspaceLayoutState`
  - 管理 `leftPinned`、`leftOverlayOpen`、`rightShown`、`rightTab`、`centerWidth`、`rightWidth`。
  - 使用 `shallowRef` 保存 primitive state。
  - 使用 `computed` 派生 CSS class/style。
  - 负责 localStorage 持久化。

- `usePanelResize`
  - 管理右栏宽度拖拽。
  - 桌面启用，移动端禁用。
  - 保存宽度到 localStorage。

- `useLeftEdgeHover`
  - 管理左边缘 hover zone。
  - 支持 open delay / close delay。
  - 鼠标进入悬浮左栏时保持打开。

- `useAgentTimeline`
  - 将 `UIMessage[]` 和 persisted PendingAction 合并为前端 timeline items。
  - 保持 computed 派生，不在 template 中做复杂过滤。

### Right Panel Content

新增或调整：

- `FileReviewTab.vue`
  - 复用/替代 `FileViewer.vue`。

- `DiffReviewTab.vue`
  - 展示当前 selected PendingAction 或 Git diff。

- `ApprovalTab.vue`
  - 展示所有 PendingAction，支持完整审批。

- `ProjectHealthTab.vue`
  - 复用 `WorkspaceHome` 中 health 摘要，减少 Home 和右栏重复逻辑。

- `PendingActionDiffViewer.vue`
  - 第一版可以先解析 `action.diff` 为文件块。
  - 后续支持旧版/新版/diff、Markdown preview。

### Agent Center

调整：

- `CopilotPanel.vue`
  - 保持 agent 请求、quick commands、composer 编排。
  - 不再直接承担完整 PendingAction 审批工作台。
  - 在右栏隐藏时显示 compact approval tray。

- `ChatTranscript.vue`
  - 替换为 `AgentTimeline.vue` 或拆成 adapter + timeline。

- `PendingActionPanel.vue`
  - 拆分为 `PendingActionCard.vue` 和右栏 `ApprovalTab.vue`。
  - card 可在中间和右栏复用。

## Layout State Rules

建议持久化 key：

```text
oan.workspace.layout.<workspace-path-hash>
```

内容：

```yaml
leftPinned: true
rightShown: true
rightTab: approval
rightWidthPercent: 36
sidebarTab: files
activeFilePath: chapters/0001/0001.md
```

约束：

- workspace path 不直接作为 localStorage key，先 hash 或 slug。
- localStorage 只是 UI preference，不作为项目事实源。
- 不写入小说 workspace 文件树。
- 移动端可以忽略 desktop width preference。

## Interaction Details

### Left Hidden Hover

行为：

- 左栏隐藏时渲染 `.left-edge-hover-zone`。
- hover zone 宽度：`16px`，允许配置在 `10-20px` 范围。
- hover zone 位于 workspace 内容区域左侧，不覆盖系统窗口边框。
- `mouseenter` 后 80-150ms 打开 overlay，减少误触。
- overlay 使用 fixed/absolute，占满 workspace 内容高度。
- overlay 宽度与正常左栏一致。
- overlay 层级高于 center/right，但低于 modal/search overlay。
- `mouseleave` 后 150-250ms 关闭。
- overlay 内点击文件后保持 overlay 短暂打开，文件内容在右侧打开。
- 点击 pin 按钮后恢复常驻左栏。

### Right Hidden Approval

行为：

- 右栏隐藏时，`CopilotPanel` 顶部或 composer 上方显示 compact approval tray。
- 有 PendingAction 时显示数量和最近一项。
- 低风险单文件 action 可显示 accept/reject。
- 多文件或高风险 action 只显示 `Review`，打开右栏。
- 用户点击消息里的 PendingAction `Review` 时：
  - 打开右栏。
  - 选中 `Approval` tab。
  - 选中对应 PendingAction。

### Keyboard

可在后续实现：

- `Cmd/Ctrl+B`：toggle left panel。
- `Cmd/Ctrl+J`：toggle right panel。
- `Cmd/Ctrl+Enter`：发送当前 agent 输入。
- `Cmd/Ctrl+Shift+Enter`：打开当前 PendingAction review。
- `Esc`：关闭悬浮左栏或右侧 overlay，不停止 agent。

快捷键第一版可以只文档化，不强制实现。

## Implementation Phases

### Phase 1: Layout State And Panel Shell

目标：先改变布局骨架，不动 backend。

Deliverables：

- `useWorkspaceLayoutState`
- `WorkspaceWorkbench.vue`
- `WorkspaceLeftPanel.vue`
- `WorkspaceRightPanel.vue`
- 右栏 tab shell：`File` / `Approval` / `Health`
- 左栏隐藏后 hover zone + floating overlay
- 右栏隐藏后中间区扩展

验收：

- 左栏常驻/隐藏/hover overlay 都可用。
- 左栏隐藏后 hover 左边缘 10-20px 能唤出满高悬浮左栏。
- 右栏隐藏后中间 agent 区域扩展。
- 面板状态刷新后能恢复。

### Phase 2: Approval Relocation

目标：把 PendingAction 审批从中间 panel 的附属块升级为跨 center/right 共享能力。

Deliverables：

- `PendingActionCard.vue`
- `ApprovalTab.vue`
- `CompactApprovalTray.vue`
- `CopilotPanel.vue` 改为右栏隐藏时显示 compact tray
- accept/reject 状态和错误信息复用当前 backend API

验收：

- 右栏显示时，完整 PendingAction 队列在 `Approval` tab。
- 右栏隐藏时，中间 agent 仍能审核 PendingAction。
- accept/reject 成功后刷新 workspace status、project health、file tree、chapters、当前文件。
- accept/reject 失败不会本地伪成功。

### Phase 3: Structured Diff Viewer

目标：让 diff 审阅从纯文本升级为按文件组织。

Deliverables：

- `PendingActionDiffViewer.vue`
- `DiffFileBlock.vue`
- `DiffReviewTab.vue`
- `old` / `diff` / `new` view mode 的前端状态
- Markdown 文件 preview 的轻量版本

验收：

- PendingAction 多文件 diff 可以按文件折叠。
- 每个文件显示状态、路径、touched file 信息。
- 不在消息流中展示巨大 diff。
- 右栏 `Diff` tab 能从 PendingAction card 跳转打开。

### Phase 4: Agent Timeline

目标：升级消息展示，让写作工作流信息更像工作台事件流。

Deliverables：

- `useAgentTimeline`
- `AgentTimeline.vue`
- `AgentMessage.vue`
- `ToolActivityBlock.vue`
- `AgentStatusLine.vue`
- `ArtifactCard.vue` placeholder

验收：

- user / assistant / tool / pending action / error / status 分类型展示。
- tool activity 默认折叠。
- PendingAction 作为一等 timeline card。
- message hover 支持 copy。
- agent streaming / stopped / failed 状态清晰。

### Phase 5: Responsive And Polish

目标：移动端和细节打磨。

Deliverables：

- 桌面/平板/移动断点。
- 移动端左栏 drawer。
- 移动端右栏 bottom sheet 或 full-screen sheet。
- panel resize。
- 基础键盘快捷键。
- 可访问性标签和 focus 管理。

验收：

- 1366px、1024px、768px、390px 视口没有重叠和不可读文本。
- hover overlay 不阻断正常滚动和文件点击。
- tab / button 有明确 aria label。
- 键盘用户可以打开/关闭左右栏和完成审批。

## Non Goals

- 不迁移 OpenHands React 组件。
- 不引入 Zustand、React Router、TanStack Query。
- 不改变 OAN backend 协议作为第一步。
- 不把 OpenHands 的 runtime confirmation model 替换 OAN PendingAction。
- 不在前端直接执行文件写入、Git 或 tools。
- 不在第一版实现完整 Monaco diff editor，除非后续 task 明确要求。

## Risks

### Hover Left Panel Misfire

左边缘 hover 可能误触。需要 open delay、close delay、pin 按钮和清晰阴影。

### Approval Split Brain

中间和右栏都能审批，容易状态不一致。必须通过同一份 PendingAction state 和同一组 backend API，accept/reject 后统一刷新。

### Message Timeline Over-Engineering

不要一次性做完整 event schema。第一版只把现有 `UIMessage.parts` 映射成前端 timeline items。

### Diff Parsing Complexity

不要把 unified diff parser 做成核心域模型。第一版只是前端展示 helper；真正写入仍以 PendingAction / SemanticPatch / backend accept 为准。

## Suggested Task Split

后续可以拆成 4 个可执行 task：

1. `Workspace panel layout shell`
   - 左栏 hover overlay、右栏 tab shell、layout state 持久化。

2. `PendingAction review workspace`
   - 右栏 Approval tab、中间 compact tray、共享 PendingAction card。

3. `Structured diff review`
   - 按文件 diff viewer、old/diff/new、Markdown preview。

4. `Agent timeline polish`
   - 消息类型化、tool 折叠、hover actions、status/error/finish 显示。

这些 task 应只修改 `apps/desktop-ui` 和必要的 frontend API type；除非缺少 backend endpoint，否则不触碰 core/backend。

