# OAN Writing Profile 与拆书材料升级计划

> 计划状态：In Progress（W0 + W1 + W2 已于 2026-07-31 完成；必须的 W3a
> adoption 闭环已于 2026-08-01 完成；W3b 体验增强延后）。
>
> 计划日期：2026-07-26。
>
> 最近收敛：2026-07-28。Writing Profile 简化为 workspace 级配置，只影响少量 Writing 提示和参考作品拆书输出；不建立原作绑定、source-canon runtime、Profile snapshot 或复杂 policy engine。
>
> 2026-07-28 第二轮收敛（对照代码复核后）：本计划**不是纯新增**。它必须修改 `0900` 已落地的若干共享契约，包括 quality gate 的阻断语义、publish 完成性判定、work plan 终端单元字段和 manifest output kind 枚举。这些破坏性变更已在 §7 和 §11 中显式列为交付物，不允许在实现时当作“顺手改动”。
>
> 首个关联任务：`docs/tasks/1200.md`（`Writing Profile Configuration And Prompt Reminders`），已完成并在 `Related Plans` 登记本计划。
>
> 本计划已登记到 `docs/README.md` 的计划索引，与 `REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md` 及两份 Play upgrade plan 保持一致。
>
> 主要复用任务：`0900`、`1000`、`1010`、`1020`、`1030`、`1040`、`1070`、`1080`。其中 `0900` 已完成的 D0–D5 深度拆解流水线是本计划扩展拆书产物的基础。
>
> `0900` 状态已对齐为 `Completed`；其 Implementation Notes 已记录 W0 / W1
> 的 D5 Profile gate、1205 的 quality gate warning 语义，以及 1210 已完成的
> per-track publish / manifest v2、provenance 与纯 material context 契约。
>
> W3a 收敛结果：材料采用复用已落地的 Apply Engine；`relationships` 使用角色对象
> `relationships.yaml` 整文件候选，`outline` 登记受限的
> `NarrativePatch{domain:'outline', operation:'replaceFile'}`。细粒度 patch 仍留给
> `docs/tasks/0800.md`，详见 §8.2。
>
> 产品阶段说明：OAN 仍处于未发布的早期开发阶段。本计划不处理旧 endpoint、旧 workspace / reference bundle migration 或系统化无障碍支持；开发期旧数据可以重建，未知 schema 明确报错。

## 1. 结论摘要

Writing Profile 当前只解决两个问题：

1. Writing 的规划、正文、审稿和修订提示中，默认强调哪些写作提醒。
2. 拆解参考作品后，发布抽象写作技巧，还是发布可用于二次创作的世界观、角色、关系、大纲和时间线材料。

OAN 默认提供两个只读 Profile：

- `commercialWriting`：商业写作。
- `fanfictionWriting`：同人二创写作。

用户可以克隆预设或创建自定义 Profile，组合 OAN 提供的固定字段。例如：

```text
拆书输出：
  techniques + world + characters + outline

Writing 提醒：
  originality + AI voice + character consistency
```

推荐结构：

```text
共享 Novel Copilot skill 提示词
  + workspace 当前 Writing Profile 的少量 reminder fragments（按 capability 过滤）
  + 当前小说 Project Truth（Context Package 按 capability 选择）
  + request-local accepted distilled techniques（仅当当前 Profile 包含 techniques 且本次明确选择）
  + 当前用户请求
  -> 正式 Writing

参考作品 source
  -> 共用 D0–D5 的导入、分块、进度、恢复、证据与发布控制框架
  -> Profile 从 Quick Preview 开始选择 typed analysis track
       - Technique Track：技法分析 -> distilled/*
       - Story Material Track：具体事实提取 -> materials/*
  -> 用户显式选择材料并生成 workspace 修改候选
  -> PendingAction / diff / Human Approval
  -> 接受后的世界观、角色卡、大纲等成为 Project Truth
  -> 正式 Writing 读取接受后的 workspace 文件；抽象 techniques 仅走现有 D5 request-local selector
```

关键边界：

- 正式 Writing 不读取参考作品原文。
- 正式 Writing 不读取 reference bundle 的 `materials/*`；只有当前 Profile 包含 `techniques` 且本次请求明确选择时，现有 D5 才可召回少量抽象 `distilled/*`。
- D5 `selectReferenceContext` 的评分与预算逻辑保持不变，只在其外层新增一个 profile 级 gate：当前 Profile 不含 `techniques` 时直接返回空结果并给出 omitted reason。详见 §6.3。
- workspace 不绑定一部或多部“原作”，也不维护原作 checkpoint、canon version 或同步关系。
- `fanfictionWriting` 只改变拆书材料类型和少量 prompt reminder。
- Technique 与 Story Material 共用一套运行控制框架，但不共用模型 prompt、finding schema 或 aggregate contract。
- 拆书材料只有经过用户显式采用并写入当前 workspace 后，才会成为正式 Writing 的依据。
- 版权、授权、相似度和发布风险只在界面提供简短提醒；本计划不新增法律判断或硬性内容 gate。
- 拆书 quality gate 的内容质量判断从 blocking 降级为 warning，交由用户决定是否继续发布；只有“产物无法被读取或无法恢复”这一类结构完整性检查继续阻断。详见 §7.4。

推荐顺序：

```text
W0 简单 Profile 配置与两个内置预设
  -> W1 Writing reminder fragments 与 D5 profile gate
  -> W2a Quality Gate 降级与 publish 完成性松绑
  -> W2b Story Material Analysis Track
  -> W3 材料采用与 Desktop 闭环
```

W2a 必须先于 W2b：现有 publish 链路硬性要求五类 distilled entry 齐备，纯 Story Material run 在松绑前根本走不到发布。

## 2. 产品边界

### 2.1 Writing Profile 不是 runtime mode

Writing Profile 不创建新的 Agent、Runtime、数据库或工具循环。

它只影响：

- 规划、正文、审稿和修订类 capability 中是否加入某个 reminder fragment（精确映射见 §6.2）。
- Reference Deconstruction 从 Quick Preview 开始采用哪条 typed analysis track，并发布哪些 projection。
- D5 是否允许召回抽象 techniques（§6.3）。
- “采用拆书材料”操作默认展示哪些目标类型。

它不影响：

- capability 是否可见。
- capability 推断逻辑本身。
- 文件、工具或 source 权限。
- SemanticPatch、PendingAction、Human Approval 和 Git 工作流。
- 当前小说 Project Truth 的所有权。

### 2.2 Writing Profile 不是小说题材或 workspace 类型

商业写作、同人二创和用户自定义 Profile 是 Writing 策略；玄幻、仙侠、悬疑、推理、综漫、主神空间等只是小说内容。

冻结边界：

- 不新增 `genreType`、`storyType`、`scenarioType` 或“综漫项目”等功能 discriminator。
- 不因为小说题材隐藏或开放 capability。
- workspace 不需要声明绑定多部作品。
- 用户可以先后导入多个 reference，但每份 reference 独立拆解；本计划不建立多原作绑定、联合 canon 或冲突解析。

### 2.3 正式 Writing 的输入边界

正式 Writing 的输入保持为：

```text
已接受的当前小说文件
  - chapters
  - characters
  - world
  - timeline
  - outline / summaries / state
+ 当前 Profile 包含 techniques 且本次明确选择的 accepted distilled entries（可选）
+ 当前用户请求
+ Writing reminder fragments
```

以下内容不进入正式 Writing：

- 动漫、轻小说或其他 reference 原文。
- 未采用的 `materials/*`。
- reference source pointer、原作版本或所谓 canon binding。
- Profile 的显示名、说明和配置文件正文。

“采用拆书材料”是独立、显式的编辑操作。该操作可以读取用户选中的结构化拆书材料和当前目标文件，生成修改候选；它不等于普通章节写作。

### 2.4 与 Play 完全无关

Writing Profile 与 Play 完全无关。本计划不新增、修改或测试任何 Play schema、selector、prompt、endpoint、UI、session 或行为；任何 Play 问题都必须进入独立 Play task。

已复核：Play 相关代码不引用 `selectReferenceContext`、`ReferenceContextIndex` 或 `contextEligible`，因此本计划对 reference 契约的修改不会波及 Play 运行时。

唯一允许的例外是纯机械重构：把 `packages/core/src/play-scene-memory.ts` 的 `writeAtomically` 或 `play-outcome.ts` 的 `writeFileAtomically` 提取为共享 helper 供 Profile 配置写入复用。该提取不得改变 Play 的调用行为或输出，并且必须保留 Play 现有测试。若提取成本高于收益，则直接在 core 内新增一个独立的配置写入 helper，不动 Play 文件。

### 2.5 提示而不是法律或内容 gate

本计划不新增：

- 版权许可判定。
- “可以 / 不可以写同人”的系统结论。
- 根据 `rights` 阻断拆书或材料采用。
- commercial / fanfiction 专属硬性相似度 gate。
- direct quotation receipt、权限闭包或法律工作流。

References 与材料采用界面只显示简短提示：

> 请确认你有权使用所提供的文本。拆书材料可能包含原作角色、设定和情节；采用或发布前请自行审阅。

商业原创性、AI 味、角色一致性等也只是 prompt reminder 和审稿建议，不自动阻断 PendingAction。

现有 D0–D5 的 schema、checksum、source pointer 和候选发布机制继续保留；这些用于保证产物完整、可追踪和可恢复，不代表法律判断。

技术质量校验的姿态在本计划中调整：**内容质量判断一律降级为用户可见 warning，不再阻断发布**。现有 quality gate 把“缺少某个 distilled category”“与原文有 80 字符精确重叠”“存在未消解的 uncertainty”和“hash 不匹配”混在同一个 blocking 通道里，粒度过粗——前几类是作者应当自行判断的内容问题，最后一类才是系统性问题。§7.4 给出拆分方案。

## 3. 当前基线与真实缺口

### 3.1 已有能力

OAN 已完成参考作品深度拆解 D0–D5。注意 D0–D5 只是文档里的里程碑命名，代码中的 stage id 是具名字符串常量数组：

```text
detectStructure -> quickPreview -> chapterAnalysis
  -> aggregateAnalysis -> styleProfile -> distillForOan -> qualityGate
```

D5 不是 pipeline stage，而是发布后的 `selectReferenceContext()`。已落地的能力：

- source、rights、checksum、章节边界和 source drift 检测。
- Quick Preview、分章分析、聚合、Style Profile 和 quality gate。
- run lock（进程内 mutex + 文件锁）、pause / resume / retry。
- 五类 typed distilled technique entries：`writingStyle`、`pacing`、`hooks`、`scene`、`character`。
- 多文件 `ReferenceArtifactPatch` PendingAction 原子发布。
- request-local accepted distilled entry selector。

已发布 bundle 的真实布局（实现 `materials/` 前必须先了解，见 §7.5 的重名风险）：

```text
examples/references/<id>/
├── metadata.yaml
├── sources/source-manifest.yaml, original.<ext>
├── deconstruction-manifest.yaml
├── progress.yaml
├── diagnostics.yaml
├── deconstruction/
│   ├── quick-preview.md
│   ├── chapters/<chapterId>-summary.md
│   ├── plotlines.md
│   ├── characters.md          # Character Techniques，不是角色卡
│   ├── relationships.md       # Relationship Techniques
│   ├── worldbuilding.md       # Worldbuilding Techniques
│   ├── timeline.md            # Timeline Observations
│   ├── tropes.md
│   └── style-profile.md
├── distilled/
│   ├── writing-style.md, pacing.md, hooks.md
│   ├── scene-techniques.md, character-techniques.md
│   └── do-not-copy.md
└── context/
    ├── index.yaml
    └── reference-summary.md
```

现有 Writing 已有：

- 共享 Novel Copilot skill system prompt，定义在 `packages/core/src/novel-copilot-skill.ts`，可由 `.oan/skills/novel-copilot.md` 追加覆盖。
- 14 个 `novel.*` capability id 与对应 quick command（含 `/去AI味` → `novel.de_ai`）。
- Context Package 按推断出的 capability 选择 / 省略 source。
- PendingAction、Human Approval 和 Git accept。

### 3.2 缺口

当前缺少：

- workspace 当前 Writing Profile 配置。
- 两个内置预设与自定义组合。
- 少量 profile-aware prompt reminder，以及承载它们的 fragment 装配位。
- 在现有拆书控制框架内增加独立的 Story Material typed analysis track。
- 审阅拆书材料并显式采用到当前 workspace 的旅程。

必须修改的现有共享契约（这不是新增，而是对 `0900` 产物的破坏性变更）：

- `ReferenceDeconstructionQualityStatus` 增加非阻断状态 `warned`，quality gate 的内容判断降级为 warning（§7.4）。
- `assertReviewReadyForPublication` 与 manifest `completed` 判定不再要求“五类 distilled 齐备”，改为要求“本 run 所选 track 的产物齐备”（§7.5）。
- `ReferenceDeconstructionOutputKind` 与发布候选的路径前缀白名单增加 `materials`（§7.5）。
- `ReferenceDeconstructionWorkPlan` 的 `aggregateRootUnitId` / `styleUnitId` / `distillUnitId` / `analysisQualityUnitId` 从单例字段改为 per-track（§7.1）。
- `REFERENCE_DECONSTRUCTION_STAGE_IDS` 增加 material stage，`ReferenceDeconstructionManifestStages` 的“每个 stage 必须有记录”改为 track 相关（§7.1）。
- `assertReferenceContextIndex` 的“至少 5 条、五个 category 各一条”改为随 track 生效（§7.5）。

不需要新建：

- 第二套端到端拆书运行与控制框架；但必须新增 Story Material 的 prompt、typed findings、aggregate 和 formatter，不能把现有 Technique findings 直接改名后复用。
- Story Material / source-canon selector；抽象 techniques 继续复用现有 D5 recall 的评分逻辑，只在外层加 profile gate。
- 多作品 binding manifest。
- Profile module registry、resolver、fingerprint 或 per-run snapshot。
- vector DB、隐藏 memory 或多 Agent 编排。

## 4. MVP 产品目标

### 4.1 Profile Manager

作者应能：

- 看见“商业写作”和“同人二创写作”两个内置卡片。
- 选择一个作为 workspace 当前 Profile。
- 克隆内置 Profile。
- 创建、编辑和删除自定义 Profile。
- 用固定表单选择拆书产物和 Writing reminders。
- 看见当前 Profile 的简单效果摘要。

内置 Profile 不可原地编辑或删除。

### 4.2 商业写作预设

默认：

- 拆书只发布 `techniques`。
- Writing 加入 originality reminder。
- Review 加入 AI voice reminder。
- 用户本次明确选择参考技法时，继续复用现有 D5 selector 召回少量 accepted distilled entries。
- 不发布具体原作角色、世界观、情节大纲或时间线材料。
- 不把 reference 原文或 Story Materials 传给正式 Writing Copilot；抽象 distilled techniques 继续遵循现有 D5 request-local selector。

提醒只用于帮助作者保持独立表达，不承诺检测所有相似内容，也不阻断正文候选。

### 4.3 同人二创预设

默认拆书发布：

- `world`：世界规则、地点、组织、能力体系和限制。
- `characters`：角色身份、目标、性格、行为锚点和知识边界。
- `relationships`：关系基线和变化。
- `outline`：剧情结构、主要事件和因果链。
- `timeline`：事件顺序和阶段。

默认不发布 `techniques`；同人二创拆书的重点不是把原作抽象成写作技巧，而是形成可审阅、可采用的结构化创作材料。

Writing 默认加入：

- character consistency reminder：依据当前 workspace 已接受角色卡检查人物一致性。
- adaptation freedom reminder：允许作者融合、修改或舍弃已采用材料，不强制复制原作剧情。

正式 Writing 仍不读取原作或 reference Story Materials。只有用户接受进 workspace 的世界观、角色卡、大纲等文件会进入后续 Writing context。

### 4.4 自定义组合

自定义 Profile 可以组合：

- 只输出 techniques。
- 只输出 world + characters。
- 输出 techniques + world + characters + outline。
- 开启 originality + AI voice + character consistency。
- 使用同人拆书材料，同时保留商业写作提醒。

自定义 Profile 不能提供任意 system prompt、脚本、工具或路径。长期自由规则继续写入 Constitution / Workflow。

## 5. 简化数据合同

### 5.1 文件所有权

```text
Host 内置 Profile
  - commercialWriting
  - fanfictionWriting

Workspace 当前选择
  - .oan/config.yaml

Workspace 自定义 Profile
  - .oan/writing-profiles/<safe-id>.yaml
```

`.oan/config.yaml`：

```yaml
version: 1
writingProfile:
  activeProfileId: commercialWriting
```

`writingProfile` 不再自带内层 `version`：它随外层 workspace config `version` 演进，避免两个版本号各自校验、实现时漏掉其中一个。

缺少 `writingProfile` 时使用内置 `commercialWriting` 作为非持久化 fallback。显式指向不存在或无效 Profile 时显示配置错误，不静默修改文件。

严格性范围必须精确限定。现有 `WorkspaceConfigData` 是 `[key: string]: unknown` 的宽松结构，`loadWorkspaceConfig` 遇到非法根对象会静默返回 `{ version: 1 }`，`git.autoCommitOnAccept` 等既有 section 也依赖这种宽松读取。因此：

- 只对 `writingProfile` 子树和 `.oan/writing-profiles/*.yaml` 做 strict 校验并明确报错。
- 不收紧 `loadWorkspaceConfig` 的整体行为，不因为 `writingProfile` 非法而使整个 config 不可读；其余 section 继续按现有宽松语义工作。
- `writingProfile` 非法时的表现是“Profile 配置错误”这一个可定位的 UI 状态，Writing 与拆书回落到内置 `commercialWriting` 并显示错误，而不是 workspace 无法打开。

`docs/FILESYSTEM_SPEC.md` 当前的 `.oan/` 目录树里**没有列出 `config.yaml`**。W0 除了新增 `writing-profiles/`，还必须先把 `config.yaml` 本身补进 spec。

### 5.2 自定义 Profile

自定义 Profile 文件保留自己的 `version`，因为它是独立的用户文件，不随 workspace config 一起演进：

```yaml
version: 1
id: derivative-commercial
displayName: 衍生商业写作
description: 使用具体拆书材料，同时保留商业表达提醒
deconstruction:
  outputs:
    - techniques
    - world
    - characters
    - outline
writingReminders:
  originality: true
  aiVoice: true
  characterConsistency: true
  adaptationFreedom: true
```

允许的 `deconstruction.outputs`：

```text
techniques
world
characters
relationships
outline
timeline
```

所有 reminder 都是 boolean：

- `originality`：提示独立表达和差异化。
- `aiVoice`：在 Review / Revise 中提示机械表达、模板化句式等问题。
- `characterConsistency`：只依据当前 workspace 已接受的角色卡和事实。
- `adaptationFreedom`：提示拆书材料可以被修改、组合或舍弃。

至少选择一个 deconstruction output。所有字段完整保存，不做 Profile 继承；克隆只是复制一份完整配置。

### 5.3 两个内置值

```yaml
# commercialWriting
deconstruction:
  outputs:
    - techniques
writingReminders:
  originality: true
  aiVoice: true
  characterConsistency: false
  adaptationFreedom: false
---
# fanfictionWriting
deconstruction:
  outputs:
    - world
    - characters
    - relationships
    - outline
    - timeline
writingReminders:
  originality: false
  aiVoice: false
  characterConsistency: true
  adaptationFreedom: true
```

内置与自定义 Profile 使用同一 strict loader 和固定字段 mapping，不新增独立 resolver。

### 5.4 生效边界

- 普通 Plan / Write / Review / Revise 请求开始时读取一次当前 Profile；变更从下一次请求生效。
- 新的拆书 run 开始时，把 `profileId + deconstruction.outputs` 写入已有 run request metadata。
- 已开始或恢复的拆书 run 继续使用它启动时记录的 outputs；新 run 才读取当前 Profile。
- 这只是复用现有拆书 request，不创建 Profile snapshot、fingerprint 或新的恢复系统。
- Profile 变更不改写已发布拆书产物，也不改写当前小说文件。
- Profile Manager 的 create / clone / update / delete / activate 是用户显式确认的普通配置操作，并保持 Git-visible。
- MVP 不允许 AI 创建或修改 Profile。

配置写入使用的 helper 需要先落地。现有 `.oan/config.yaml` 唯一的写入点 `saveWorkspaceOnboarding` 用的是普通 `writeFile`，不是原子写；可复用的原子写实现目前是 Play 模块私有的（`play-scene-memory.ts` 的 `writeAtomically`、`play-outcome.ts` 的 `writeFileAtomically`）。W0 需要二选一：

- 按 §2.4 的例外条款把其中一个提取为 core 共享 helper，不改变 Play 行为；或
- 在 core 内新增独立的配置原子写 helper，完全不碰 Play 文件。

不要在计划或 task 中把这一步描述为“复用现有 atomic file helper”，因为该 helper 今天并不存在于配置写入路径上。

## 6. Writing Reminder Fragments

### 6.1 现状装配链路

实现前必须以现状为准，不要按“共享 prompt + capability prompt”这种想象结构动手。今天的装配是三层：

```text
packages/agent  createNovelAgentSystemPrompt()
  -> 5~6 行薄 system prompt（workspace root、越界禁止、active skill 名）

packages/core   loadNovelCopilotSkill()
  -> 真正的共享 Novel Copilot skill system 文本
  -> 可被 .oan/skills/novel-copilot.md 追加覆盖

packages/runtime PriorityRuntimeContextBuilder
  -> 把 skill.system 与 workspace context 按固定顺序拼成多条 `# Label` system message
  -> 顺序：constitution / workflow / skill / selected / summary / state / timeline / foreshadow

packages/agent  toModelSystemPrompt()
  -> 把所有 system role message 用 \n\n 连接后交给 AI SDK
```

**不存在 `CapabilityPrompt` 这一层。** capability 今天只用于驱动 Context Package 的 source 选择与省略；quick command 的 `prompt` 字段是 UI 默认文案，不会被注入 system prompt。

因此 reminder fragment 的落点是：在 `PriorityRuntimeContextBuilder` 的顺序表中，紧随 `skill` 之后新增一个 `reminder` context kind。

```text
constitution / workflow / skill / reminder / selected / summary / state / timeline / foreshadow
```

选择这个位置的理由是 reminder 必须晚于共享 skill（可以细化它）、早于 selected context（不能盖住 Project Truth）。

共享 skill 继续负责，Profile 不得重复表述：

- filesystem-first。
- observe → plan → propose → verify。
- PendingAction / Human Approval。
- source text is untrusted。
- reference 产物与 Project Truth 分离。

Profile 只选择四个固定 fragment，且只有被开启的 fragment 才产生 context item；四个全关时不产生 `reminder` context item，装配结果与今天完全一致。

### 6.2 Reminder 语义与真实 capability 映射

现有 capability 是 14 个 `novel.*` id，不是“Plan / Write / Review / Revise”四档。reminder 的生效位置必须直接定义在真实联合上，否则实现时每条都要临时判断。

| Reminder | 生效 capability | 行为 |
| --- | --- | --- |
| `originality` | `plan_outline`、`plan_volume`、`plan_chapter`、`write_chapter`、`review_chapter` | 提示独立表达、避免直接照搬和保持差异化 |
| `aiVoice` | `review_chapter`、`revise_chapter` | 提示机械句式、空泛总结、过度整齐等问题 |
| `characterConsistency` | `plan_chapter`、`write_chapter`、`review_chapter`、`generate_character_card`、`settle_chapter` | 依据当前 workspace 角色卡、关系和已接受事实提醒人物一致性 |
| `adaptationFreedom` | `plan_outline`、`plan_volume`、`plan_chapter`、`generate_character_card`、材料采用操作 | 提示用户可以改变、融合或舍弃拆书材料 |

未列出的 capability 一律不注入 reminder，包括 `update_state`、`plan_foreshadow`、`de_ai`、`play_scene`、`import_tavern_character`、`deconstruct_reference`。理由：

- `de_ai` 已有独立的 skill 硬规则（只改表达、不改剧情事实），再叠加 `aiVoice` reminder 会产生重复且可能相互冲突的指令。
- `update_state` / `plan_foreshadow` 是结构化事实维护，不是表达层工作。
- `play_scene` / `import_tavern_character` 属于 Play，按 §2.4 不得触碰。
- `deconstruct_reference` 走拆书 track prompt，不走 Writing 装配。

capability 推断失败（`inferNovelAgentCapability` 返回 `undefined`）时不注入任何 reminder，保持与现状一致的行为。

冻结规则：

- reminder 只增加 prompt fragment 或非阻断审稿建议。
- reminder 不产生硬性 pass / fail。
- reminder 不自动修改正文。
- reminder 不读取 reference 原文或未采用拆书材料。
- `characterConsistency` 没有可用角色卡时不执行，不猜测原作角色。
- `/去AI味` 仍由用户显式调用；开启 `aiVoice` 只表示默认在 `review_chapter` / `revise_chapter` 中提示。
- Profile 的 id、显示名和说明不进入模型 prompt。

### 6.3 D5 selector 的 profile gate

这是本计划对 D5 的**唯一**改动，其余关于“D5 保持不变”的表述均指评分与预算逻辑。

现有 `selectReferenceContext`（`packages/core/src/reference-work.ts`）完全不感知 Profile：它按 capability match、category match 和 token 重叠打分，并且在无任何命中时走 fallback 分支——返回第一个 capability 可用条目、score 记 1、reason 记 `fallback`。因此“fanfictionWriting 不召回 techniques”**无法**通过调整评分实现，必须有显式 gate。

改动方式：

- 在调用 selector 之前判断当前 Profile 的 `deconstruction.outputs` 是否包含 `techniques`。
- 不包含时直接返回空选择结果，附带 omitted reason（例如 `profileExcludesTechniques`），不进入评分与 fallback。
- 包含时行为与今天完全一致，仍需先通过现有 `hasExplicitReferenceRecallIntent` 闸门。
- gate 放在 backend 的调用点还是 core selector 入参，由 1200 / 1210 的实施 plan 决定；无论放哪里都不得改动评分函数与 token 预算。

## 7. 拆书 Analysis Tracks 与 Projection

### 7.1 共用控制框架，不共用分析合同

“不新建第二套拆书流水线”只表示不复制运行与控制基础，不表示两种 Profile 继续使用同一套 AI prompt 和 output schema。

现有 D1–D4 从 Quick Preview、分章 finding、aggregate 到 distill 都是 Technique 导向：finding 要求输出 `technique`，聚合要求形成可迁移技巧，最终又主动剔除具体角色、地点、组织和事件排列。若只在最后 formatter 分叉，Story Material 所需的具体世界观、角色和大纲信息已经被抽象掉，无法可靠恢复。

以下基础共用：

- source import、checksum 和章节边界。
- chapter / chunk work plan 与有界 source window。
- opaque evidence pointer。
- run lock、进度、pause / resume / retry 和 source drift。
- provider 调用边界、prompt-injection isolation。
- candidate review、PendingAction publish 和 Git。

从 Quick Preview 开始分成两条 typed analysis track：

```text
Shared Deconstruction Control Plane
  |
  ├─ Technique Track
  |    -> Technique Quick Preview
  |    -> Technique Chapter Findings
  |    -> Technique Aggregate / Style
  |    -> Distilled Technique Projection
  |    -> distilled/*
  |
  └─ Story Material Track
       -> Material Coverage Preview
       -> Material Chapter Findings
       -> Material Aggregate
       -> Story Material Projection
       -> materials/world.yaml
       -> materials/characters.yaml
       -> materials/relationships.yaml
       -> materials/outline.yaml
       -> materials/timeline.yaml
```

冻结边界：

- 两条 track 共用 controller、source windows、evidence ids、run storage 和发布机制。
- 两条 track 各自拥有 system prompt、typed model output、normalizer、aggregate schema 和质量诊断。
- track 可以拥有不同 stage plan：Technique Track 保留 Style / Distill，Story Material Track 使用 Material Aggregate / Projection，不为形式统一强制执行无意义的 Style stage。
- Story Material Track 不能消费已经抽象化的 Technique findings 来反推具体事实。
- `fanfictionWriting` 只运行 Story Material Track。
- `commercialWriting` 只运行 Technique Track。
- 自定义 Profile 同时选择两类 output 时，在同一个 deconstruction run 中复用相同 work plan 和 source windows，分别执行两条 typed track；这是两条分析轨道，不是两套端到端拆书系统。
- 第一版优先保持两个 typed call / output contract 清晰，不为节省一次模型调用而强行设计容易互相污染的巨型 combined schema。

#### track 化需要的破坏性 schema 变更

“共用 work plan”在当前类型定义下无法直接成立，必须先改 schema。现有 `ReferenceDeconstructionWorkPlan` 的终端单元字段是**单例必填**的：

```text
aggregateRootUnitId: string
styleUnitId: string
distillUnitId: string
analysisQualityUnitId: string
```

custom both 需要两个 aggregate root、两个 projection 单元和两套诊断，因此这些字段必须改成 per-track 结构，例如：

```text
tracks:
  technique?:
    aggregateRootUnitId, styleUnitId, distillUnitId, analysisQualityUnitId
  storyMaterial?:
    aggregateRootUnitId, projectionUnitId, analysisQualityUnitId
```

同时：

- `REFERENCE_DECONSTRUCTION_STAGE_IDS` 是闭合 const 数组，需要新增 material 相关 stage id。
- `ReferenceDeconstructionManifestStages` 今天要求**每个** stage id 都有记录，manifest `completed` 判定也要求每个 stage 都是 `completed`。新增 material stage 后，stage 的存在性与完成性必须变成 track 相关，否则纯 Technique run 会因为 material stage 缺失而无法完成，反之亦然。
- `createReferenceDeconstructionWorkPlan` 的构造顺序（chapter chunks → aggregate tree → style → distill → analysisQuality）需要按选中的 track 集合分支生成。
- chapter chunk 单元本身共用：两条 track 读同一批 source window 和同一批 evidence pointer，只是各自派生不同的 typed finding 单元。这是“共用 work plan”的真实含义，需要在 task 中写清，避免被实现为两份 chunk 计划。

这些是 `0900` 已发布数据结构的变更。按项目阶段说明，开发期旧 run 与旧 bundle 可以重建，不做 migration，但未知 / 缺失 schema 必须明确报错而不是静默通过。

### 7.2 Technique Track 与 Projection

Technique Track 保持现有 D1–D5 合同：

- Quick Preview、chapter findings 和 aggregate 继续寻找可迁移的写作观察。
- 把结构、节奏、场景和角色塑造抽象为可迁移技巧。
- 不保留具体角色、地名、组织和事件排列。
- 继续使用现有 typed distilled entries、formatter 和技术质量校验。

商业写作内置 Profile 只选择这一 projection。

### 7.3 Story Material Track 与 Projection

Story Material Track 从 Quick Preview 开始确认 source 是否覆盖所选 material kinds；分章阶段提取具体、可追踪的事实和解释，aggregate 阶段再合并实体、关系、事件与时间顺序。最终 Projection 不做“技法抽象”，而是生成结构化材料：

#### `world`

- 世界规则。
- 地点和组织。
- 能力体系、资源和限制。
- 社会结构和冲突来源。

#### `characters`

- 身份与别名。
- 目标、性格、价值和恐惧。
- 行为锚点。
- 知识边界。
- 可修改的角色卡草案字段。

#### `relationships`

- 关系基线。
- 依赖、冲突和变化。
- 关键事件对关系的影响。

#### `outline`

- 主要剧情阶段。
- 事件、转折和因果。
- 角色命运节点。
- 可拆分的大纲材料。

#### `timeline`

- 事件顺序。
- 阶段与时间范围。
- 不确定或冲突的位置。

每条材料至少包含：

- 稳定 entry id。
- 简短结构化内容。
- verified finding / source pointer。
- confidence。
- `fact | interpretation | uncertain`。

Story Material Projection 只能消费本 track 的 verified material findings / aggregate；需要核对时，宿主可以按 evidence pointer 提供最小 source window。它使用独立 typed schema、normalizer、quality diagnostics 和 formatter，不放宽 Technique Track 的抽象合同。

产物使用结构化摘要，不复制长段原文。这里的限制是产物形态设计，不是法律判定或 hard copyright gate。

#### 精确重叠检查的处理

现有 quality gate 有一条确定性规则：分析产物与 source 出现 `REFERENCE_ANALYSIS_EXACT_OVERLAP_CHARS`（80）字符精确重叠即 blocking，诊断码 `quality.copyRisk.exactOverlap`；Quick Preview 阶段也有同码的 blocking 诊断。

抽象技法几乎不会触发这条规则，但 Story Material 会：世界规则的定义式表述、能力体系术语列表、组织名称清单和事件顺序，天然接近原文措辞。若沿用现状，同人二创 track 会被系统性误判为抄袭风险而无法发布。

决策：

- 阈值不变，检查继续运行，覆盖两条 track。
- 命中后不再 blocking，一律降级为 warning，在 Material Review 与 Publish Review 中按条目展示重叠位置，由作者决定改写还是照发。
- 诊断码保持 `quality.copyRisk.exactOverlap` 不变，只改 `blocking` 与 `severity`，便于沿用既有 UI 与测试。
- 不新增 material 专属阈值，也不做启发式相似度评分；确定性的、可解释的单一阈值加清晰提示优于一个作者无法预测的打分器。

### 7.4 Quality Gate 从阻断改为提示

现有 quality gate 粒度过粗：`evaluateReferenceDeconstructionAnalysisQuality` 把结构完整性问题和内容判断问题塞进同一个 `blocking: boolean` 通道，最终只输出 `passed | failed`；`failed` 会同时卡住三处——`assertReviewReadyForPublication`、manifest `completed` 判定和 progress projection 的 `contextEligible`。结果是一个“缺了某个 distilled category”这类作者本可以接受的情况，表现为整个 run 无法发布。

本计划把默认姿态改为提示。

#### 状态模型

`ReferenceDeconstructionQualityStatus` 从 `notEvaluated | passed | failed` 扩展为：

```text
notEvaluated | passed | warned | failed
```

- `passed`：无任何诊断。
- `warned`：只有内容质量类诊断。**可以正常发布**，manifest 可以进入 `completed`，`contextEligible` 不受影响。
- `failed`：存在结构完整性类诊断，仍然阻断发布。

`ReferencePublishedDeconstructionStatus` 现有的 `qualityFailed` 语义保持不变，只在 `failed` 时出现。

#### 诊断分类

降级为 warning（内容质量判断，作者自行决定）：

- `quality.copyRisk.exactOverlap`：与原文精确重叠。
- `quality.distill.missingCategory`：缺少某个 distilled category。
- uncertainty 类诊断（今天已是 `blocking: false`，保持）。
- 章节 / 聚合覆盖不完整，但产物本身自洽可读。
- Story Material Track 新增的一切内容类诊断，例如某个 material kind 覆盖不足、某条材料缺少 confidence 标注。

保持 blocking（结构完整性，产物无法被读取或恢复）：

- work plan 形状非法、单元 id 重复、predecessor 闭包断裂。
- input fingerprint / output hash 不匹配。
- 选中 attempt 缺失或对应输出缺失、无法解析。
- evidence pointer 指向不存在的 source window。
- 诊断数量超过 `MAX_REFERENCE_DECONSTRUCTION_DIAGNOSTICS` 的溢出保护。
- copy-risk 扫描因超出确定性上界而无法完成（`quality.copyRisk.scanOverflow`）——这是“没检查成”，不是“检查通过”。

分类原则：**如果放行会导致产物不可解释、不可追踪或不可恢复，就继续阻断；如果只是作者可能不满意，就降级为 warning。** 这条原则也是 `AGENTS.md` 中“产物完整、可追踪、可恢复”要求的落点，不能因为降级而放弃。

Quick Preview 阶段的两条 blocking 诊断需要区别对待：

- `copyRisk.exactOverlap`（preview）：按上述规则降级为 warning，与 full run 保持一致。
- `coverage.incomplete`（preview）：**保持 blocking**。它表达的是“用户选了 N 章但只分析了 M 章，不要在此基础上批准整本拆解”，是工作流前置条件而非内容判断，降级会让用户在信息不足时批准长时间运行。

#### 连带修改

- `assertReviewReadyForPublication` 接受 `passed` 与 `warned`。
- manifest `completed` 判定接受 `qualityStatus` 为 `passed` 或 `warned`。
- progress projection 的 `contextEligible` 不再因 `warned` 而降级。注意这与 §7.5 中“纯 material run 的 `contextEligible` 为 `false`”不冲突：后者表达的是“本 bundle 没有可召回的 techniques”，与质量结论无关，两个原因需要在 UI 中分别说明。
- run 级 `diagnostics.some(d => d.blocking)` 的阻断保留，但只会被结构完整性类诊断触发。
- manifest 需要持久化 warning 摘要（数量与诊断码），使发布后仍能在 UI 中说明“这份产物带哪些提示”。
- 发布 PendingAction 的 diff 描述中带上 warning 计数，让 Human Approval 环节能看到。
- `coveragePercent === 100` 这项要求的松绑属于 track 化范围，放在 W2b 而不是 W2a；W2a 阶段该要求保持不变，因为纯 Technique run 的覆盖率语义没有变化。

#### 不做的事

- 不移除任何检查。所有检查继续运行并产出诊断，只改变阻断性。
- 不引入“忽略此警告并记住”的持久化 suppression 列表；MVP 只是展示。
- 不把 warning 变成模型输入，quality 诊断只面向用户。

### 7.5 发布所有权

先纠正一个常见误解：现有 D4 一次 publish 写入的**远不止** `distilled/`。它同时写 `deconstruction/` 下 9 类文件（含逐章 summary）、`context/index.yaml`、`context/reference-summary.md`、`deconstruction-manifest.yaml`、`diagnostics.yaml`、`progress.yaml`，以及 `examples/references.yaml` 索引条目。设计部分发布时必须把这些一并考虑。

两个 projection 各自拥有的目录：

- Technique Projection 拥有 `distilled/`，以及 `deconstruction/` 下的技法类聚合文件与 `style-profile.md`。
- Story Material Projection 拥有 `materials/`。
- `deconstruction/quick-preview.md`、逐章 summary、`context/*`、manifest、diagnostics、progress 和索引条目是**共享产物**，由本次 run 按所选 track 重写。

#### 命名歧义必须显式处理

`deconstruction/` 下已经存在 `characters.md`、`relationships.md`、`worldbuilding.md`、`timeline.md`、`plotlines.md`，它们是 **Character Techniques / Relationship Techniques / Worldbuilding Techniques / Timeline Observations** 等技法观察，不是具体事实。新增的 `materials/characters.yaml`、`materials/relationships.yaml`、`materials/timeline.yaml` 与它们同名不同义。

处理要求：

- `materials/*` 文件头部注明“具体原作事实材料，非技法观察”，`deconstruction/*` 对应文件头部注明“技法观察，不含可采用的具体事实”。
- Desktop 的 bundle 浏览与 Material Review 必须把两组文件分区展示并标注差异，不能混在一个平铺列表里。
- 材料采用旅程只读取 `materials/*`，不得把 `deconstruction/*.md` 当作可采用材料来源。
- task 中需要一条针对该歧义的测试：采用候选生成时传入的文件集合不包含任何 `deconstruction/` 路径。

#### 部分发布语义

一次 publish 只替换本次 Profile 选择的 projection，未选择的既有 projection 保持不变：

- `techniques`：更新 `distilled/` 与技法类 `deconstruction/*`，保留 `materials/`。
- `world + characters + outline`：只更新对应 `materials/*`，保留 `distilled/`、技法类 `deconstruction/*` 和未选择的 material 文件。
- 同时选择多项：作为一个现有 multi-file PendingAction 原子发布。

为此需要的契约修改：

- `ReferenceDeconstructionOutputKind` 从 `deconstruction | distilled | context` 扩展为增加 `materials`；`assertReferenceDeconstructionManifest` 的 `requireEnum` 白名单同步扩展。
- manifest `completed` 时“必须存在每一种 output kind”改为“必须存在本 run 所选 track 对应的 output kind”。
- 发布候选的 `canonicalCandidateFileKind` 路径前缀白名单增加 `materials/`，否则 `materials/*` 会直接抛 `candidate target is not allowed`。
- 发布候选的 `requiredPaths` 中 `context/index.yaml` 与 `context/reference-summary.md` 的处理见下。
- manifest revision 语义需要写清：部分发布仍然递增 revision，未被本次替换的 output 条目沿用上次的 checksum 与 output hash，并记录其来源 run id，以便 UI 说明“world 来自 run A，distilled 来自 run B”。

#### `context/index.yaml` 在纯 material run 下的形态

现有 `assertReferenceContextIndex` 要求 `entries` 至少 5 条、五个 distilled category 各至少一条、`contextEligible === true`，而 entries 完全由 distillation 派生。纯 Story Material run 没有 distillation，所以今天必然校验失败。

决策：`context/` 保持为 **Technique Track 专属的 D5 召回索引**，不承载 material。

- 纯 material run 仍然生成 `context/index.yaml`，但 entries 为空，并新增显式字段说明原因（例如 `techniqueTrackRan: false`），`assertReferenceContextIndex` 的“至少 5 条 / 每类齐备”改为仅在 Technique Track 参与本次发布时生效。
- 保持文件存在而不是从 `requiredPaths` 移除，理由是 D5 selector 与 readiness inspection 都依赖它存在；空 entries 比缺文件更容易保持既有读取路径不变。
- `contextEligible` 语义相应细化为“D5 可召回 techniques”，纯 material bundle 该值为 `false` 但 bundle 状态仍是 `completed`。这与 §6.3 的 profile gate 结论一致，不会让 material bundle 显示为损坏。
- `context/reference-summary.md` 继续生成，内容按本次 track 组合描述。

#### stale 语义

manifest 记录每个 projection / material kind 的 source checksum 和 output hash。source checksum 变化时，沿用 D0–D5 stale 语义；旧产物不能被用于新的材料采用候选，直到对应 kind 重新发布。stale 判定按 kind 独立进行：重跑 material track 不应把未变的 `distilled/` 标记为 stale。

## 8. 从拆书材料扩充当前小说

### 8.1 显式“采用为创作材料”

References 页面为已发布的 `materials/*` 提供：

```text
选择一份 reference
  -> 选择 world / characters / relationships / outline / timeline entries
  -> 选择当前 workspace 目标
  -> Preview
  -> Copilot 读取 selected materials + current target baseline
  -> 生成 create / update / skip 候选
  -> diff / PendingAction
  -> Accept 后写入当前 workspace
```

第一版一次采用操作只选择一份 reference，不建立多作品 binding。用户之后可以对另一份 reference 再执行一次独立采用操作。

### 8.2 目标映射

现有 `SemanticPatch` 的 domain 是闭合枚举：`ObjectPatch.domain` 为 `character | world | constitution`，`CollectionPatch.domain` 为 `state | timeline | foreshadow`，`NarrativePatch.domain` 为 `chapter | summary`。对照后有两个 material kind 没有落点：

| Story Material | Workspace 候选目标 | W3a 落法 |
| --- | --- | --- |
| `world` | `world/` 下的新文件或 `ObjectPatch{domain:'world'}` | 已支持 |
| `characters` | `characters/<id>/` 角色卡候选，`ObjectPatch{domain:'character'}` | 已支持 |
| `relationships` | `characters/<id>/relationships.yaml` | 角色 ObjectPatch 整文件候选 |
| `outline` | `outline/**/*.md` | 受限 NarrativePatch `outline + replaceFile` |
| `timeline` | `timeline/` 候选，`CollectionPatch{domain:'timeline'}` | 已支持 |

W3a 已选择“先闭环、后细化”：

- `relationships` 不新增平行 domain，继续落在角色对象树的确定文件中；
- `outline` 只增加一个与 filesystem spec 对齐的受限整文件 Narrative domain，不支持
  scene / beat 局部操作。

这项决策已登记到 `0800`，避免后续另建同义 domain。W3a 的价值是打通
“审阅 → 采用 → diff → accept”闭环，不扩张为通用 patch 引擎。

执行 task 必须对照现有 filesystem spec 选择真实 target；本计划不通过 reference id 创建新的正式小说目录。

### 8.3 采用边界

- Copilot 在材料采用操作中只读取用户选中的结构化 `materials/*`，不读取原作 source text，也不读取 `deconstruction/*` 的技法观察文件。
- 先读取当前 target baseline，再提出 create / update / skip。
- AI 不能自动覆盖现有世界观、角色卡或大纲。
- Accept 前 materials 只是 reference artifact，不是 Project Truth。
- Accept 后目标文件成为普通当前小说文件；正式 Writing 从具体材料侧只读取这些目标文件，不读取其 reference 来源。抽象 techniques 仍可按现有 D5 规则 request-local 进入。
- reference 重新拆解不会自动同步、回滚或覆盖已经采用的 workspace 文件。
- 不维护 source binding、canon checkpoint、upstream link、divergence ledger 或多 source conflict engine。

## 9. Desktop 旅程

### 9.1 Profile Manager

设置页提供：

- 两张内置 Profile 卡片。
- 当前 Profile 标记。
- “设为当前”“克隆”“新建自定义 Profile”。
- deconstruction outputs 多选。
- 四个 Writing reminder 开关。
- 简短效果摘要。
- 删除自定义 Profile；当前 Profile 删除前必须先切换。
- Git-visible 状态和现有 quick commit 入口。

不提供 prompt 编辑器、module graph、权限配置器或 source binding UI。

### 9.2 Reference Deconstruction

开始新拆书 run 前显示：

- 当前 Writing Profile。
- 本次 outputs。
- 简短内容提示。

示例：

```text
当前 Profile：同人二创写作
将生成：世界观、角色、关系、大纲、时间线
提示：拆书材料可能包含原作设定和情节，采用前请自行审阅。
```

不要求用户完成法律问卷，也不因提示未确认而增加新的 hard gate。

### 9.3 Material Review

拆书完成后：

- 按 world / characters / relationships / outline / timeline 分组展示。
- 与 `deconstruction/*` 的技法观察文件分区展示，明确标注“具体事实材料”与“技法观察”的差别（§7.5）。
- 显示 source pointer、confidence 和 uncertainty。
- 允许选择单条或多条材料。
- 提供“采用为创作材料”。
- 在写入 workspace 前展示目标文件和 diff。

### 9.4 质量提示展示

Quality gate 降级为提示后，UI 必须承担起原先由阻断承担的告知责任，否则降级等于静默放行。

Publish Review 页面：

- 顶部显示本次质量结论：`passed` / `带 N 条提示` / `失败（结构问题）`。
- `warned` 时按诊断码分组列出提示，每条给出所属 stage、chapter、evidence pointer 和一句可执行建议。
- 精确重叠提示需要能定位到具体产物条目，让作者可以直接判断是否改写。
- 发布按钮在 `warned` 状态下可用，但需要用户先展开过提示列表；这是一次交互确认，不是新增 hard gate。
- `failed` 时说明这是结构完整性问题（产物不可解释或不可恢复），并提供 retry 对应 unit 的入口。

Material Review 与 References 列表：

- 已发布 bundle 显示常驻的提示计数徽标，点击可回看提示详情。
- 采用候选生成前，如果所选材料命中过重叠提示，在 Preview 中再次标注。

### 9.5 正式 Writing

Writing 页面只显示当前 reminder 摘要，例如：

```text
Writing Profile：同人二创写作
Reminders：角色一致性、改编自由
```

不显示“已绑定原作”，也不把 reference 原文、source pointer 或未采用 materials 放入正式 Writing context；抽象 techniques 的现有 D5 选择说明保持不变。

## 10. 包职责

```text
packages/core
  -> WritingProfile strict codec
  -> 两个内置值与 custom loader
  -> active Profile config（.oan/config.yaml 的 writingProfile 子树）
  -> reminder fragment 文本（与共享 skill 同源，见下）
  -> 共用 deconstruction controller / work plan / evidence contract
  -> work plan 的 per-track 终端单元重构
  -> quality status 四态模型与诊断分类
  -> Story Material chapter findings / aggregate / projection typed records
  -> Story Material normalizer / formatter / manifest projection
  -> D5 selector 的 profile gate 入参
  -> material adoption target plan

packages/agent
  -> 现有 Technique Track prompt / typed output 保持独立
  -> Material Preview / Chapter / Aggregate / Projection prompt
  -> selected materials -> workspace candidate

packages/runtime
  -> context builder 顺序表新增 reminder context kind
  -> 不新增 Profile runtime、planner 或恢复机制

packages/backend
  -> Profile list / create / clone / update / delete / activate
  -> 同一 deconstruction run/controller 调度一个或两个 typed track
  -> 复用现有 run lifecycle、source windows、resume 与 publish
  -> D5 召回前的 profile gate 判断
  -> material review / adoption preview / PendingAction composition

packages/client
  -> strict Profile / materials / adoption request-response guards

apps/desktop-ui
  -> Profile Manager
  -> output preview、材料审阅和采用旅程
  -> 质量提示展示（§9.4）
  -> Writing reminder 摘要
```

reminder fragment 的包归属需要注意：共享 Novel Copilot prompt 的正文在 `packages/core/src/novel-copilot-skill.ts`，不在 `packages/agent`。因此 reminder 文本应与共享 skill 同包定义，由 `packages/runtime` 的 context builder 注入；`packages/agent` 只负责按推断出的 capability 决定注入哪些 fragment，不持有 prompt 正文。

建议文件：

```text
packages/core/src/writing-profile.ts
packages/core/src/writing-profile-reminders.ts
packages/core/src/reference-story-material.ts
packages/core/src/reference-material-adoption.ts
packages/agent/src/reference-story-material.ts
```

不新增独立 Profile resolver、snapshot store、source-canon store、第二套 deconstruction controller 或 Profile 专属 workflow engine。

## 11. 分阶段实施

### W0：Profile 配置

交付：

- `WritingProfile` strict schema。
- 两个内置 Profile。
- `.oan/config.yaml` 的 `writingProfile.activeProfileId`。
- `.oan/writing-profiles/<id>.yaml` custom loader。
- 配置原子写 helper（提取或新增，见 §5.4）。
- Profile CRUD / activate。
- 最小 Profile Manager。
- 更新 `FILESYSTEM_SPEC.md`，补入 `config.yaml` 本身与 `writing-profiles/`。
- 创建 `docs/tasks/1200.md`，登记本计划到 `Related Plans`，并把本计划加入 `docs/README.md` 索引。
- 修正 `docs/tasks/README.md` 中 0900 的状态标记。

完成标准：

- 新 workspace 默认使用 `commercialWriting`。
- 内置 Profile 只读。
- 用户可以创建自定义 outputs + reminders 组合。
- `writingProfile` 子树与自定义 Profile 文件的未知字段、非法 output、id / 文件名不一致明确报错。
- `writingProfile` 非法不导致整个 workspace config 不可读；`git`、`onboarding` 等既有 section 的宽松读取行为不变。
- 不存在题材类型、source binding 或 run Profile snapshot。

### W1：Writing Reminder Fragments

交付：

- `packages/runtime` context builder 顺序表新增 `reminder` context kind，位于 `skill` 之后、`selected` 之前。
- 四个 reminder fragments，文本与共享 skill 同包定义。
- 按 §6.2 表格映射到真实 `novel.*` capability id。
- D5 selector 的 profile gate（§6.3）。
- Profile 状态摘要。
- prompt assembly 的 golden test 基线。

完成标准：

- 不复制两份完整 prompt；共享 skill 文本在装配结果中只出现一次。
- 四个 reminder 全关时，装配结果与改动前逐字一致。
- reminder 只使用当前 workspace Project Truth。
- 未列入 §6.2 表格的 capability 不注入任何 reminder；capability 推断失败时同样不注入。
- 正式 Writing 不读取 reference source 或 `materials/*`。
- 当前 Profile 不含 `techniques` 时，D5 返回空选择并给出 omitted reason，不进入评分与 fallback 分支；评分函数与 token 预算未被修改。
- reminder 不阻断 PendingAction。
- custom Profile 组合可通过 prompt assembly golden tests。注意 `__test__/agent/` 目前没有 snapshot 测试，本阶段需要引入该测试范式并说明基线更新流程。

### W2：Quality Gate 松绑与 Story Material Analysis Track

W2 是本计划唯一包含破坏性变更的阶段，按 §15 拆成两个 task。

#### W2a：Quality Gate 降级（`1205`，Completed 2026-07-31）

这一步与 track 无关，只改质量判定的阻断语义，因此可以独立交付并独立验证。

交付：

- `ReferenceDeconstructionQualityStatus` 扩展为 `notEvaluated | passed | warned | failed`。
- 按 §7.4 重新分类现有诊断的 `blocking` 与 `severity`，诊断码保持不变。
- `assertReviewReadyForPublication`、manifest `completed` 判定和 progress `contextEligible` 接受 `warned`。
- manifest 持久化 warning 摘要（数量与诊断码）。
- 发布 PendingAction diff 描述带上提示计数。
- Publish Review 的质量提示展示（§9.4 前半）。

完成标准：

- 现有 `commercialWriting` 拆书流程行为不变，除了内容类诊断不再阻断发布。
- 只有内容类诊断的 run 得到 `warned`、可以发布，且提示在 Publish Review 中可见。
- 每一类结构完整性诊断仍然阻断，且各有测试。
- 没有移除任何检查；所有诊断继续产出。
- `0900` 的现有测试全部更新并通过，不留下“因为降级而失效”的断言。

#### W2b：Story Material Analysis Track（`1210`，Completed 2026-07-31）

交付的共享契约修改：

- `ReferenceDeconstructionWorkPlan` 终端单元字段改为 per-track（§7.1）。
- `REFERENCE_DECONSTRUCTION_STAGE_IDS` 新增 material stage；`ReferenceDeconstructionManifestStages` 的存在性与完成性改为 track 相关。
- `assertReviewReadyForPublication` 的完成性要求从“全部单元完成”改为“本 run 所选 track 的必需单元完成”。
- `ReferenceDeconstructionOutputKind` 与 manifest `requireEnum` 白名单新增 `materials`。
- 发布候选路径前缀白名单新增 `materials/`。
- `assertReferenceContextIndex` 的 5 条 / 每类齐备约束改为仅在 Technique Track 参与发布时生效；纯 material run 生成空 entries 索引（§7.5）。

交付的新增能力：

- 在现有 deconstruction controller 中增加 `technique | storyMaterial` track selection。
- 在现有 work-plan builder 中支持 track-specific stages；不为 Story Material Track 创建第二个 controller。
- Material Coverage Preview typed schema / prompt。
- Material Chapter Findings typed schema / prompt / normalizer。
- Material Aggregate typed schema / prompt / evidence closure。
- world / characters / relationships / outline / timeline Projection 与 formatter。
- custom Profile 选择 both 时，共用 work plan / source windows 并调度两条 track。
- independent diagnostics 与 projection manifest。
- 部分发布语义与 per-kind stale 判定。
- `materials/*` 与 `deconstruction/*` 的文件头标注与分区展示。
- Material Review 的提示展示（§9.4 后半）。
- References grouped review。

完成标准：

- 不复制 import、chunk planner、controller、run lock、resume 或 source drift；publish framework 被**扩展**而不是复制，且扩展点与上述契约清单逐条对应。
- Story Material Track 不消费 Technique findings，也不从已抽象 aggregate 反推原作事实。
- `fanfictionWriting` 默认不生成 techniques，且纯 material run 能够走到 `completed` 并发布。
- Technique Projection 的现有抽象合同保持不变。
- Story Materials 可以包含具体角色、设定和情节事实。
- 所有材料有 evidence 或 uncertainty。
- 不复制长原文；精确重叠命中时产出 warning 而不是阻断。
- custom both 在一个 run 中完成两条 typed track，任一 track 失败都不会伪装成对应 projection 已完成。
- selected projection 原子更新，未选择 projection 不被删除也不被标记 stale。
- 旧 schema 的 run / bundle 在读取时明确报错，不静默通过。

实现结果：上述共享契约与新增能力均已通过 task `1210` 落地。commercial、
fanfiction 与 custom both 分别覆盖 Technique-only、material-only 和双轨同 run；
`materials/*` 通过既有 PendingAction 发布，per-output provenance 支持安全部分发布，
Desktop 已完成 Preview / Publish Review / References 分区展示。selected material
adoption 与 workspace truth-file 写入仍属于 W3，没有在 W2b 提前实现。

### W3：材料采用与 Desktop 闭环（W3a Completed 2026-08-01）

交付：

- 单 reference、selected entries 的 adoption preview。
- current target baseline + selected materials prompt。
- create / update / skip。
- `world` / `characters` / `timeline` 走现有 SemanticPatch domain；`relationships` / `outline` 按 §8.2 的决策走整文件候选或新增 domain。
- multi-file PendingAction。
- Profile、拆书、材料审阅和采用的 Desktop 旅程。

完成标准：

- materials 在 Accept 前不改变 workspace。
- 采用候选的输入文件集合只含 `materials/*`，不含任何 `deconstruction/*` 或 `sources/*` 路径。
- 正式 Writing 从 Story Material 侧只读取 Accept 后的目标文件；抽象 techniques 继续走现有 D5 selector 的评分逻辑（外加 §6.3 的 profile gate）。
- reference 后续变化不自动同步已采用内容。
- 没有原作 binding、多 source manifest 或 Story Material selector。
- 若选择新增 patch domain，已与 `0800` 对齐范围，不出现两个 task 各自扩同一枚举。
- 界面提供简短提示，但没有新增法律 / 内容 hard gate。

实现结果：task `1220` 已落地单 reference、selected entries 的受控 adoption。
Catalog 只接受 current、checksum 闭合的已发布 `materials/*`；模型输入只包含选中
entry、对应材料文件身份和当前 target baseline。逐目标 `create | update | skip`
结果转换为受限 SemanticPatch，prepare preview 与 PendingAction promotion 分离，确认
和 Accept 前都会复核 reference identity、catalog fingerprint 与 target baseline。
Desktop 已提供选择、目标映射、warning、decision 与 diff 审阅入口，并复用全局
Review 完成 Accept。Accept 前真实文件不变，Accept 后成为普通 Project Truth；后续
reference 变化不会自动同步。批量筛选、搜索、拖拽映射、历史与细粒度 patch 属于
可选 W3b，未纳入本次必须闭环。

## 12. 测试矩阵

### 12.1 Core

- built-in / custom Profile strict codec。
- missing config fallback 与 invalid active id。
- `writingProfile` 非法时其余 config section 仍可读，且 workspace 可打开。
- safe-id、文件名一致性、内置 id 冲突。
- outputs 非空、去重和固定 enum。
- reminder boolean round-trip。
- request / config 不接受题材或 source binding 字段。
- 配置写入为原子操作，进程中断不产生半写文件。
- Technique / Story Material track work units 共用 run identity、source windows 和 evidence pointer contract，但使用不同 typed output。
- work plan per-track 终端单元：technique-only / material-only / both 三种组合的构造与校验。
- manifest stages 的 track 相关存在性：technique-only run 不因缺少 material stage 而失败，反之亦然。
- quality status 四态：无诊断 → `passed`；仅内容类 → `warned`；含结构类 → `failed`。
- `warned` 状态下 `assertReviewReadyForPublication` 通过、manifest 可 `completed`、`contextEligible` 不被降级。
- 每一类结构完整性诊断（plan 形状、fingerprint / hash 不匹配、attempt 或输出缺失、evidence 断链、诊断溢出、copy-risk 扫描溢出）仍然阻断。
- `quality.copyRisk.exactOverlap` 与 `quality.distill.missingCategory` 产出 `blocking: false`，诊断码不变。
- Quick Preview 的 `coverage.incomplete` 仍然阻断，`copyRisk.exactOverlap` 已降级。
- Story Material entry / projection manifest strict codec。
- `materials` output kind 被 manifest 与发布候选路径白名单接受；未知 kind 与非法路径仍报错。
- 纯 material run 生成空 entries 的 `context/index.yaml`，bundle 状态为 `completed` 而 `contextEligible` 为 `false`。
- projection 独立 ownership：techniques → materials → both。
- 部分发布：未被本次替换的 output 沿用上次 checksum / output hash 并记录来源 run id。
- source drift 复用现有 stale 语义，且 per-kind 独立：重跑 material track 不把 `distilled/` 标记 stale。
- material target mapping 与 path confinement。

### 12.2 Agent

- shared prompt 只出现一次。
- 四个 reminder 全关时装配结果与改动前逐字一致（golden test）。
- reminder context item 位于 `skill` 之后、`selected` 之前。
- commercialWriting：originality + AI voice。
- fanfictionWriting：character consistency + adaptation freedom。
- 按 §6.2 表格逐 capability 断言注入与不注入；`de_ai`、`update_state`、`plan_foreshadow` 不注入任何 reminder。
- capability 推断失败时不注入 reminder。
- fanfictionWriting 不包含 techniques：即使请求文本命中 `hasExplicitReferenceRecallIntent`，profile gate 也返回空选择并给出 omitted reason，不进入评分与 fallback。
- techniques 在 Profile 中时，selector 的评分结果与改动前一致。
- custom Profile reminder 组合。
- 正式 Writing prompt 不含 reference 原文、source pointer 或未采用 materials。
- Technique Projection 保持抽象。
- Technique Chapter / Aggregate prompt 不因新增 Story Material Track 而改变既有合同。
- Material Coverage / Chapter / Aggregate 从本 track 的 typed findings 保留具体实体、关系、事件和时间顺序。
- Material Projection 拒绝把 Technique findings 当作自己的 verified predecessor。
- Story Material Projection 保留具体 world / character / outline facts。
- fact / interpretation / uncertain 与 evidence closure。
- malicious source 不能改变 schema 或调用工具。
- adoption prompt 只收到 selected materials 与 current target baseline。

### 12.3 Backend / Client

- Profile CRUD / activate strict transport。
- built-in edit / delete 拒绝。
- 当前 custom Profile 删除前要求先切换。
- 新 deconstruction run 记录最小 `profileId + outputs`，并在同一 controller 下派生所需 track work units。
- resume 使用原 run outputs。
- commercial 只调度 Technique Track；fanfiction 只调度 Story Material Track；custom both 调度两条 track，但不创建第二个 run/controller。
- 纯 material run 端到端走到发布成功。
- `warned` run 可以发布，`failed` run 被拒绝并给出结构问题说明与 retry 入口。
- publish PendingAction 的描述中带有 warning 计数。
- projection publish accept / reject / failure。
- adoption preview / accept / reject。
- 未选材料不进入 adoption prompt；`deconstruction/*` 路径永不进入 adoption prompt。
- reference 变化不自动修改 accepted workspace 文件。

### 12.4 Desktop 旅程

#### 旅程 A：商业写作

```text
选择 commercialWriting
  -> 拆书只生成 techniques
  -> Writing 使用当前 workspace，并可按本次请求选择少量抽象 techniques
  -> Review 显示 originality / AI voice 建议
```

断言：没有 Story Materials 或原作内容进入正式 Writing；只有用户本次明确选择的抽象 techniques 可以按现有 D5 规则进入。

#### 旅程 B：同人二创

```text
选择 fanfictionWriting
  -> 拆书生成 world / characters / relationships / outline / timeline
  -> 不生成 techniques，context/index.yaml entries 为空
  -> 若命中精确重叠，展示 warning 而非阻断，用户确认后发布
  -> 审阅并选择部分材料（与 deconstruction/* 分区展示）
  -> 采用为当前 workspace 候选
  -> diff / PendingAction / Accept
  -> 正式 Writing 使用接受后的世界观、角色卡和大纲
```

断言：正式 Writing 不读取原作或 `materials/*`；具体世界观、角色和大纲只来自已经成为当前小说文件的内容；该 Profile 下 D5 直接返回空选择并给出 omitted reason。

#### 旅程 C：自定义组合

```text
克隆 fanfictionWriting
  -> outputs 增加 techniques
  -> 开启 originality / aiVoice
  -> 设为当前
  -> 同一次拆书发布 techniques + selected materials
```

断言：无需 module graph、source binding 或 run Profile snapshot。

## 13. 明确延期或独立计划

以下能力不属于当前 Writing Profile MVP：

- 把 reference 原文直接注入正式 Writing Copilot。
- workspace 绑定一部或多部原作。
- canon checkpoint、版本、namespace 和 divergence ledger。
- 多 source 的自动融合、换算和冲突解析。
- 已采用材料与 reference 的自动同步。
- 自有 TXT / Markdown 旧稿导入当前 workspace。
- Profile 任意 prompt、module marketplace、插件和版本 pin。
- Profile per-run snapshot、fingerprint 和跨版本 resume。
- 新的法律权限、quotation receipt 或版权 gate。
- deterministic 大规模抄袭检测。
- 质量提示的持久化 suppression 列表（“忽略并记住此警告”）。
- material 专属的相似度阈值或启发式打分器；§7.3 只保留现有确定性阈值并降级为提示。
- 把 quality 诊断作为模型输入回灌给 Copilot。
- PDF / EPUB / DOCX / OCR 或联网 source adapter。
- 旧 endpoint / bundle migration。
- 系统化无障碍支持。

如果后续需要“导入现有小说后续写”，应创建独立 `Manuscript Continuation Import` task；它不是 Writing Profile 配置的一部分。

## 14. 完成定义

- [x] Workspace 可以选择当前 Writing Profile。
- [x] OAN 提供只读 `commercialWriting` 与 `fanfictionWriting`。
- [x] 用户可以组合固定 deconstruction outputs 和 Writing reminders。
- [x] Profile 不引入题材类型、source binding 或 capability gate。
- [x] Writing prompt 由 shared skill + reminder context item 组成，reminder 全关时装配结果不变。
- [x] reminder 生效位置定义在真实 `novel.*` capability 联合上。
- [x] D5 只新增 profile gate，评分与预算逻辑未被修改。
- [x] commercialWriting 默认只发布 techniques。
- [x] fanfictionWriting 默认发布 world / characters / relationships / outline / timeline，不发布 techniques，且能正常走到 `completed` 并发布。
- [x] 两种 Profile 共用 import / chunk / run / resume / evidence / publish 控制框架，但从 Quick Preview 开始使用独立 typed analysis track。
- [x] work plan 终端单元、stage id 与 manifest output kind 已完成 track 化改造，且旧 schema 缺失时明确报错。
- [x] quality gate 的内容质量判断为非阻断 warning，结构完整性判断仍然阻断。
- [x] `warned` 产物可以发布，且提示在 Publish Review 与 References 列表中可见。
- [x] W3 adoption Preview 显示已发布产物携带的 warning。
- [x] Technique Projection 保持现有抽象合同。
- [x] Story Material Track 拥有独立 Preview、Chapter Findings、Aggregate 和 Projection，并可以保留有 evidence 的具体原作设定、角色和剧情材料。
- [x] `materials/*` 与同名 `deconstruction/*` 技法文件已明确区分并分区展示。
- [x] custom both 在一个 deconstruction run 中执行两条 track，不复制第二套 controller。
- [x] 用户可以显式选择 materials，生成 workspace 修改候选。
- [x] materials 只有 Accept 后才成为当前小说文件。
- [x] 正式 Writing 不读取 reference 原文或未采用 materials。
- [x] Reference deconstruction、Publish Review 与 References 界面提供简短内容提示，不新增法律或内容 hard gate。
- [x] W3 adoption Preview 提供对应内容提示，且不新增法律或内容 hard gate。
- [x] Profile、prompt、Technique / Story Material projection 与 W2 Desktop 拆书旅程测试通过。
- [x] W3 adoption 与 Accept 后 Desktop 闭环测试通过。
- [x] `FILESYSTEM_SPEC.md`（含 `config.yaml`）、`docs/README.md` 索引、对应 task 和 W0 / W1 Implementation Notes 同步更新。
- [x] `0900` 的状态标记已对齐，Implementation Notes 已记录 W2 对 quality gate、per-track publish / manifest、provenance 与 context 契约的修改。

## 15. 推荐任务拆分

`1200`、`1205`、`1210` 与必须的 W3a `1220` 已创建并完成；W3b 体验增强延后。

| Slice | 推荐任务 | 状态 |
| --- | --- | --- |
| W0 + W1 | `1200 Writing Profile Configuration And Prompt Reminders` | Completed |
| W2 前半 | `1205 Reference Quality Gate Warning Degradation` | Completed |
| W2 后半 | `1210 Reference Story Material Analysis Track` | Completed |
| W3a | `1220 Reference Material Adoption And Desktop Closure` | Completed |
| W3b | Material adoption UX polish | Deferred，按真实使用反馈再拆 task |

W2 建议拆成两个 task。`1205` 只做 quality gate 降级与相关 publish 完成性判定的松绑，它对现有 `commercialWriting` 流程立即有价值（作者不再因为一条内容提示而无法发布），并且可以独立验证；`1210` 再在已经松绑的框架上增加 Story Material track。把两者塞进一个 task 会让“修改 0900 契约”和“新增 track”的失败原因混在一起，回滚粒度也过粗。

`1205` 需要在 `Related Plans` 中同时链接本计划与 `REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md`，因为它修改的是后者交付的契约。

1200、1205、1210 与 1220 W3a 已完成。用户已经能使用两个内置 Profile 和自定义组合，
Technique Track 的内容质量提示不再阻断发布，Story Material Track 也已支持
material-only / custom both、证据闭包、部分发布与分组审阅；selected material
adoption 已通过 diff / PendingAction / Accept 接入 Project Truth。W3b 只保留批量
筛选、搜索、映射和历史等体验增强。
不要复制第二套 controller，也不要为了将来可能需要的原作绑定、
source-canon selector 或复杂 Profile 能力提前扩展范围。
