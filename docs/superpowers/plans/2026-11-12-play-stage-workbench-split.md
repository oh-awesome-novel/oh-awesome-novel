# 1580 舞台模式与专业模式拆分实施计划

对应 task：[1580](../../tasks/1580.md)。只改 Desktop UI，不改 Play 协议、会话存储与后端接口。

## 结构

- **共享会话状态**：`usePlayWorkspace` 的返回值（类型 `PlayWorkspaceState`）。`PlayWorkspace.vue` 只创建一次，整体传给两个外壳。输入草稿、行动类型、等待时长、进行中回合、排队、选中分支、候选项都在其中，外壳自己不保存这些内容。
- **`PlayWorkspace.vue`（容器）**：顶栏、会话列表、新建 / 导入 / 升级提示、空状态、模式切换。
- **`PlayWorkbenchShell.vue`（专业外壳）**：原有的推演中栏、世界检查器与 v5 排练工作台，能力不变。首次进入专业模式时挂载，之后切到舞台只隐藏不卸载，面板里正在填的表单、进行中的检查和滚动位置都保留；切换不触发任何请求。
- **`PlayStageShell.vue`（舞台外壳）**：占满会话列表右侧的主区域，内含 `VisualNovelStage` 与 `PlayStageActionBar.vue`。

## 步骤

1. `usePlayPresentationMode`：按工作区 + 会话把模式记在 `localStorage`（应用界面偏好，不进小说工作区）。没有记录的会话默认专业模式；外部请求打开且没有记录的会话进入舞台模式，延续原先“交接后直接打开演出”的行为。
2. 抽出 `PlayWorkbenchShell.vue`；原来嵌在中栏的 `visualNovelOpen` 舞台与 v5“视觉小说回放”按钮改为进入舞台模式的按钮。
3. `VisualNovelStage` 增加 `fill`（占满容器）、`externalEditor`（“改一改 / 自己写”交给外部输入）、`controls` 插槽与返回按钮文案；空格 / 回车只在焦点位于舞台或对话框时推进，其余按钮可正常用键盘触发。
4. `PlayStageActionBar.vue`：绑定共享草稿的行动输入（行动类型、等待时长、Cmd/Ctrl+Enter 提交）；回合进行中同一输入框提供“排队”与“插话”（Alt+Enter），排队列表折叠显示；停止、重演上一回合、存档点下拉跳转。
5. 舞台模式固定玩家视角：进入或停留在舞台模式时关闭导演视角（v5 同时把排练视角切回玩家），舞台内不提供切换；隐藏的专业外壳因此也只持有玩家视角的数据。
6. v5 场景排练在舞台模式只读回放：不渲染选项与行动栏。
7. 测试 `__test__/desktop-ui/src/play-stage-mode.test.ts`：偏好读写；回合进行中来回切换后草稿、provisional 文本一致且只提交一次；舞台内选项、改一改、自己写、停止、重演、存档点跳转与键盘操作；导演视角被关闭、隐藏事件不出现；v5 只读。现有 Play Desktop 测试在默认（专业）模式下保持通过。

## 会失效的数据

无。新增的 `oan:play:presentation-mode:<工作区路径>` 是界面偏好，丢失后会话回到默认的专业模式。
