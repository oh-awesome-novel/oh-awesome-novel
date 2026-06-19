# SillyTavern 可吸收点候选清单

> 状态：候选参考笔记。  
> 约束：本文不会自动修改 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`。所有“可吸收点”都标记为来自 SillyTavern，等待用户确认后，才能合并进 OAN 的 agent 写作指引参考笔记。  
> 基准：`reference-only/SillyTavern` 本地当前 HEAD `51ad27fb8`。  
> 许可证提醒：SillyTavern 使用 AGPL-3.0。OAN 只能吸收产品模式、抽象设计和 workflow 启发，不应复制实现代码、prompt 文本或默认资产。

## 吸收原则

SillyTavern 对 OAN 的价值集中在 **角色扮演式 Play 体验**，不是主架构。这个方向不应只被理解为“写正文前的草稿试跑”，而应规划成 OAN 的独立 Play 功能：用户可以在阅读小说之外进入小说世界，和角色互动、探索场景、体验剧情分支；Play 中产生的 transcript、状态变化和观察结果，再作为草稿或参考交给写作 agent。

OAN 的稳定边界仍然是：

- filesystem-first。
- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 真实目标文件写入必须经过 PendingAction / diff / Human Approval。
- Runtime 保持 Aider-style 极简循环，不引入重型多 Agent 平台。
- 正式小说事实必须来自已确认章节、状态、时间线、伏笔和摘要，而不是未确认聊天 transcript。

因此，SillyTavern 中可以吸收的是 **角色卡表达、动态 lore 激活、沉浸式对话 Play、候选回复分支、多角色场景调度和短期 steering**。不能吸收的是 AGPL 代码、重型扩展生态、直接落盘聊天状态、无证据的自动 lore 注入，或把 RP transcript 自动当成小说正文事实源。

## 候选吸收点

### 1. 强化 OAN 角色卡的“可交互人格面”

来源：SillyTavern 的 Tavern Card V1 / V2 / V3 字段、角色卡 PNG 元数据、角色字段 prompt 拼装。`[SillyTavern-reference]`

SillyTavern 的角色卡不只是人物档案，而是一个可用于对话生成的“人格包”。它包含描述、性格、场景、首句、示例对白、作者备注、系统提示、历史后置指令、备用问候、talkativeness、depth prompt 和角色专属 character book。

OAN 已经有角色卡，但更偏小说工程事实。可以吸收 SillyTavern 的交互面，给角色卡增加或规范这些字段：

- `voice_examples`：角色典型对白、口头禅、句式和禁用语。
- `scene_entry`：适合用于角色试跑的初始场景或首句，不等同于正文开头。
- `interaction_notes`：角色在交互时应遵守的行为边界。
- `post_history_instructions`：多轮互动后仍需坚持的长期角色约束。
- `depth_prompt`：只在特定深度插入的短提示，用于稳定角色声线或秘密动机。
- `character_lorebook`：角色专属的小型 lorebook，用于关系、秘密、术语、个人过去等触发式上下文。

OAN 适配方式：

- 字段落在 OAN 自己的 `characters/` Object File Tree 中。
- 这些字段服务于写作和 sandbox，不直接复制 Tavern Card 格式。
- 角色事实字段和交互提示字段要分开，避免把 prompt 技巧混进 canonical state。

确认状态：待用户确认后，可写入 `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，来源标注为 `[SillyTavern-reference]`。

### 2. 引入轻量动态 lore 激活，不引入重型 WorldInfo 系统

来源：SillyTavern 的 WorldInfo / lorebook 扫描、关键词激活、secondary key、预算、递归、位置和 timed effect。`[SillyTavern-reference]`

SillyTavern 的 WorldInfo 很强，但整体过重。OAN 可以吸收理念，而不是复制系统。

OAN 可吸收为轻量 `ContextActivation`：

- 每个 context source 可以声明 `triggers`，例如角色名、地点名、术语、物品、势力、伏笔 id。
- 可选 secondary triggers，用于避免单个泛词误触发。
- 每条激活记录有 source id、文件路径、触发原因、优先级和预算。
- agent 写作前的 context package 记录：
  - 哪些 source 被触发。
  - 哪些 source 被省略。
  - 触发来自用户输入、章节契约、上一章结尾、当前状态，还是草稿正文。
- 对于世界规则、角色秘密和伏笔，只能作为上下文读取，不能自动写入事实源。

不建议吸收：

- 复杂递归激活作为第一版能力。
- sticky / cooldown / delay 全量配置。
- 无 source log 的隐式 lore 注入。

确认状态：待用户确认。

### 3. 把 Author's Note / depth prompt 转译成 OAN 的短期 steering artifact

来源：SillyTavern 的 `authors-note.js`、角色 `extensions.depth_prompt` 和 extension prompt 注入。`[SillyTavern-reference]`

SillyTavern 允许用户在不改角色卡和世界书的情况下插入临时提示。这个能力对小说写作很有价值，例如：

- 本场景要压住节奏，不要过早爆发冲突。
- 本章某角色表面平静，内心焦虑。
- 下一段只写动作和环境，不揭示真相。
- 当前试跑不要修改任何长期设定。

OAN 可吸收方式：

- 新增 session 级 `steering.md` 或 shadow artifact。
- 写作前 context package 标明 steering 来源和有效范围。
- steering 只影响本次生成，不自动写进角色卡、世界观或状态。
- 如果用户希望长期保留，必须转成 PendingAction，让用户确认落到 `.oan/constitution/*`、角色卡或 workflow。

确认状态：待用户确认。

### 4. 将 Roleplay Sandbox 升级为独立 Play 功能

来源：SillyTavern 的普通聊天、群聊、Visual Novel Mode、swipe、branch、checkpoint。`[SillyTavern-reference]`

SillyTavern 最核心的启发是：用户可以用对话方式进入小说世界，而不只是让 agent 生成一段可采纳草稿。对 OAN 来说，这应成为独立 Play 功能，而不是藏在写作流程里的辅助步骤。

OAN 可以设计一个独立的 `Play Mode`：

1. 读取小说当前状态、相关角色卡、地点 / 世界规则、时间线局部、active hooks，以及用户选择的 Play 起点。
2. 生成 play context package，说明本次 Play 读取了哪些事实源、哪些材料被压缩或省略。
3. 用户以第一人称、旁观者、指定角色或自定义 persona 进入场景。
4. Play runtime 负责叙事裁判、角色发言、场景反馈和世界规则约束。
5. transcript 与 play-local state 保存在 `.oan/play/`、`.oan/sessions/` 或 workspace shadow 中，默认不改小说事实源。
6. Play 结束或用户主动要求时，agent 输出 observation log：
   - 哪些角色反应值得保留。
   - 哪些对白可以转为正文素材。
   - 哪些状态变化只属于 Play session，不能自动入 canon。
   - 哪些内容建议生成 PendingAction。
7. 只有用户确认后，才把候选内容转为章节草稿或状态 / 时间线 / 伏笔 patch。

这能让 OAN 把 Play 做成一个正经的一等功能：它既能提供沉浸式小说世界体验，也能在用户需要时把 Play 结果转成写作参考。关键边界是：Play 可以有自己的 session continuity，但小说 canonical truth 仍由 Object File Tree + PendingAction + Human Approval 决定。

确认状态：用户已确认应规划为独立 Play 功能。

### 5. 学习 swipes：保留同一位置的多个候选回复 / 场景版本

来源：SillyTavern 的 message `swipes`、`swipe_id`、`swipe_info`。`[SillyTavern-reference]`

小说写作经常需要比较多个版本：一句对白、一个场景转折、一段章尾钩子。SillyTavern 的 swipe 机制可以转译成 OAN 的“候选变体”。

OAN 可吸收方式：

- 对同一个 scene beat 或段落，允许 agent 生成多个 `variant`。
- 每个 variant 记录：
  - 生成目的。
  - 读取上下文。
  - 差异摘要。
  - 风险提示。
- 用户选择某个 variant 后，才生成 PendingAction。
- 未选择的 variant 留在 session artifact，不污染章节事实源。

适合场景：

- 章尾爆点多个版本。
- 关键对白多个版本。
- 角色反应多个版本。
- 伏笔揭示程度多个版本。

确认状态：待用户确认。

### 6. 学习 branch / checkpoint：把试跑分叉和正式 Git 历史分开

来源：SillyTavern 的 `bookmarks.js` branch / checkpoint 快照。`[SillyTavern-reference]`

SillyTavern 的 branch / checkpoint 是聊天层的快照。OAN 可以吸收“轻量试错”的体验，但不要把它混同于 Git 分支。

OAN 可吸收方式：

- 在 `.oan/sessions/` 或 `.workspace` 中保存 scene rehearsal checkpoint。
- checkpoint 指向：
  - 当前章节契约版本。
  - context package。
  - transcript / draft variant。
  - 用户选择状态。
- 正式章节文件仍由 PendingAction 写入。
- Git 历史只记录用户确认后的结果。

这样能支持“先玩几条走向，再决定写哪条”，同时不制造真实文件历史噪音。

确认状态：待用户确认。

### 7. 多角色 Play 默认采用“世界裁判 + 角色模块”，而不是重型多 Agent runtime

来源：SillyTavern 的 group activation strategy：NATURAL / LIST / MANUAL / POOLED，以及 `talkativeness`。`[SillyTavern-reference]`

SillyTavern 的群聊解决了一个具体问题：多角色在场时，下一句由谁说？这对 RP 效果很重要，但不等于必须把每个角色都做成独立 Agent。

效果判断：

- 对沉浸式角色扮演，默认更适合 **单一 Play runtime / 世界裁判 + 多角色 voice/state modules + 发言调度**。
- 重型多 Agent runtime 容易带来角色各说各话、上下文重复、成本高、延迟高、设定漂移、难以统一叙事节奏等问题。
- 多 Agent 更适合少数场景：角色有隐藏目标、阵营有独立计划、离屏事件需要模拟，或者用户明确想看 NPC 自主博弈。

OAN 可吸收的默认调度策略：

- `manual`：用户指定下一个发言角色。
- `outline_order`：按本场景 beat 指定角色顺序。
- `natural`：根据被点名、最近发言者、角色参与度选择。
- `pooled`：一轮中优先让尚未表达立场的角色发言。

这可以用于 Play、对白生成和群像戏排练。OAN 可以把多角色互动做成 Play 的核心体验，但不应让多个 Agent 自主改写事实源。需要独立模拟时，也应是 Play runtime 的可选策略，而不是默认核心架构。

确认状态：待用户确认。

### 8. Prompt preset 和 prompt provenance 可继续强化

来源：SillyTavern 的 context / instruct / sysprompt / novel preset，以及 PromptManager、扩展提示和 itemized prompt。`[SillyTavern-reference]`

SillyTavern 很强调用户能控制 prompt 组合。OAN 不需要照搬大量 preset，但可以强化：

- 当前写作用了哪个 agent guide 版本。
- 用了哪个 genre / style / roleplay profile。
- 用户临时 steering 是什么。
- 哪些角色互动字段进入了 prompt。
- 哪些 lore source 被触发。
- 哪些材料因预算被省略。

这和 OAN 已有的 context package / trace 候选方向一致。SillyTavern 的启发在于：对 power user 来说，prompt provenance 本身就是可用性。

确认状态：待用户确认。

### 9. Slash commands 可启发 OAN 的快捷写作动作

来源：SillyTavern 的 slash command parser 与大量内置命令。`[SillyTavern-reference]`

OAN 已经有 `/规划下一章`、`/写下一章`、`/整理本章`、`/审稿` 等 quick commands。SillyTavern 可启发新增或细化 sandbox 相关命令：

- `/试跑场景`
- `/角色回应`
- `/多角色对白`
- `/生成变体`
- `/保存试跑检查点`
- `/从试跑生成正文候选`
- `/从试跑提取观察`

这些命令应统一进入 OAN 的 action intent / PendingAction 流程，不能绕过 human approval。

确认状态：待用户确认。

### 10. 视觉资产可作为角色和场景辅助，不进入核心事实源

来源：SillyTavern 默认背景、Seraphina 情绪 sprite、Visual Novel Mode、图像生成集成。`[SillyTavern-reference]`

SillyTavern 证明视觉素材可以增强角色扮演沉浸感。OAN 后续如果做桌面 Novel IDE，可以考虑：

- 角色头像。
- 情绪参考图。
- 场景 mood board。
- 地点背景图。
- 章节试跑时的视觉小说式面板。

但这些不应成为 OAN 当前 agent 写作指引的核心。它们是 UX 增强，不是事实源。

确认状态：低优先级，待用户确认。

## 与 InkOS Play 的组合参考

SillyTavern 和 InkOS Play 都能启发 OAN 的“互动场景”方向，但各自贡献不同。

SillyTavern 更值得学：

- 角色卡交互字段。
- 世界书动态激活。
- 对话 swipes / branch / checkpoint。
- 群聊发言策略。
- 作者注和短期 steering。

InkOS Play 更值得学：

- 回合结果的事务式提交。
- transcript、state、event、projection 的一致性。
- 失败时不留下半推进状态。

OAN 如果要做 Play / Roleplay Sandbox，建议组合方式是：

```text
SillyTavern 的角色扮演交互体验
    +
InkOS Play 的事务式状态提交
    +
OAN 的 PendingAction / SemanticPatch / Git diff 审批
```

换句话说：SillyTavern 负责启发“怎么玩、怎么试”；InkOS Play 负责启发“怎么结算”；OAN 负责确保“怎么进入真实小说文件树”。

## 不建议直接吸收

### 1. AGPL 代码、prompt 和默认资产

SillyTavern 是 AGPL-3.0。OAN 不应复制实现代码、默认 preset 文本、角色资产或 UI 文案。

### 2. 完整 provider 与扩展生态

SillyTavern 的 provider、extension、UI 复杂度很高。OAN 当前不应把这套复杂面搬入核心 runtime。

### 3. 把聊天 transcript 当成 canon

RP 对话很容易出现即兴发挥、设定漂移和未确认信息。OAN 只能把 transcript 当成草稿、试跑或素材来源。任何事实变更都必须经过 evidence-only settlement 和用户确认。

### 4. 无 source log 的自动 lore 注入

WorldInfo 机制很强，但 OAN 必须知道模型读了什么。所有动态 context activation 都应出现在 context package 或 trace 中。

### 5. 把独立 Play 做成重型多 Agent 平台

Play 可以是 OAN 的一等功能，但默认不应做成重型多 Agent 平台。更适合的基础形态是一个 Play runtime 统一承担世界裁判、叙事节奏和状态约束，再按角色卡生成具体角色发言。多 Agent 只作为离屏模拟、隐藏目标或阵营博弈等高级选项。

### 6. 直接保存 AI 结果到真实目标文件

SillyTavern 的聊天保存是直接写 JSONL。OAN 不能照搬。真实目标文件必须走 PendingAction。

## 建议加入 OAN 总参考笔记的候选条目

以下条目如果用户确认，可后续写入 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，并添加来源标签 `[SillyTavern-reference]`。

### A. 新增独立 Play Mode / Roleplay Sandbox

用途：让用户在阅读和写作之外，以对话方式沉浸进入小说世界，和角色互动、探索场景、体验剧情分支。它也可以在需要时作为写作草稿和 agent 参考来源，但不是只为草稿服务。

约束：

- Play transcript 对 Play session 有连续性，但默认不进入小说 canonical truth。
- 必须读取相关角色卡、当前状态、世界规则、时间线和 active hooks。
- Play runtime 应维护世界裁判、角色发言、场景反馈和规则约束。
- Play 结束或用户要求转写时，先输出 observation log。
- 只有用户确认后，才生成章节草稿或状态 patch。

### B. 强化角色卡中的互动字段

候选字段：

- `voice_examples`
- `scene_entry`
- `interaction_notes`
- `post_history_instructions`
- `depth_prompt`
- `character_lorebook`

目标：让 agent 在写对白、试跑场景和生成角色回应时更稳定。

### C. 建立轻量 Context Activation

用途：按关键词、实体、伏笔、地点或场景目标激活相关对象文件。

必须记录：

- source id。
- 文件路径。
- 触发原因。
- token / 字数预算。
- included / omitted。

### D. 支持同一段落或场景的多个 variant

用途：像 swipe 一样比较多个候选输出。

约束：

- variant 存在 session artifact 中。
- 选中后才进入 PendingAction。
- 未选中 variant 不影响事实源。

### E. 多角色互动作为 Play 调度，不作为默认多 Agent runtime

用途：群像戏、会议戏、争吵戏、队伍互动。

约束：

- 可以指定 manual / natural / pooled 等策略。
- 默认采用世界裁判 + 多角色模块 + 发言调度。
- 重型多 Agent 只作为隐藏目标、离屏事件或阵营模拟的可选高级能力。
- 不允许角色 agent 自主改真实文件。

## 建议优先级

### 近期

- 强化角色卡互动字段。
- 规划独立 Play Mode v0，而不是仅把 scene rehearsal 当写作前草稿工具。
- 支持段落 / 对白 variant。
- 在 context package 中记录动态激活来源。

### 中期

- 引入角色专属 lorebook。
- 做轻量 Context Activation。
- 增加 Play observation log 到 PendingAction 的转化规则。
- 增加 `/开始Play`、`/试跑场景`、`/角色回应`、`/多角色互动`、`/生成变体` 等 quick commands。

### 远期

- 多角色 Play 调度。
- 视觉小说式场景面板。
- 角色头像、情绪参考图、场景 mood board。

## 参考文件

- SillyTavern 项目说明：`reference-only/SillyTavern/.github/readme.md`
- 包信息与许可证：`reference-only/SillyTavern/package.json`
- 角色卡解析：`reference-only/SillyTavern/src/character-card-parser.js`
- 角色卡校验：`reference-only/SillyTavern/src/validator/TavernCardValidator.js`
- 角色导入、转换、保存：`reference-only/SillyTavern/src/endpoints/characters.js`
- 聊天保存与导入导出：`reference-only/SillyTavern/src/endpoints/chats.js`
- 世界书后端：`reference-only/SillyTavern/src/endpoints/worldinfo.js`
- WorldInfo 激活：`reference-only/SillyTavern/public/scripts/world-info.js`
- 生成主流程：`reference-only/SillyTavern/public/script.js`
- 群聊与多角色调度：`reference-only/SillyTavern/public/scripts/group-chats.js`
- 分支与 checkpoint：`reference-only/SillyTavern/public/scripts/bookmarks.js`
- 作者注：`reference-only/SillyTavern/public/scripts/authors-note.js`
- slash commands：`reference-only/SillyTavern/public/scripts/slash-commands.js`
- 默认内容与 preset：`reference-only/SillyTavern/default/content/*`
