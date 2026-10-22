# 设定工坊引导式共创向导升级计划 (Setting Workshop Guided Forge)

> 状态：Planned
>
> 优先级：P1
>
> 对标参考：`reference-only/CicaTavern/server/forge/` 及分析报告 [`docs/research/CICATAVERN_REFERENCE_ANALYSIS.md`](../research/CICATAVERN_REFERENCE_ANALYSIS.md)
>
> 核心目标：为创作者提供一套告别空白表单与粗糙一次性生成的“引导式设定共创向导（Forge）”。通过“台词样例挑性格、试写片段挑文风、性格调色盘、三面性、二次反刻板解释、诚实归属与项锁定”，帮助作者从模糊想法逐步提炼出立体生动的同人/原创角色档案、世界舞台、场景地点与开场白，并通过 OAN 规范的 `CandidateChangeSet` 经人类确认后落盘入库。
>
> 核心约束：
> 1. **Filesystem-first**：生成的设定必须直接落盘为 OAN 标准对象文件树（`characters/<id>/profile.md`、`world/places/`、`world/rules.md`、`world/timeline/`），不存私有数据库。草稿暂存于 `.workspace/forge/drafts/<draft-id>.yaml`。
> 2. **Human Approval**：生成的新设定必须通过 `CandidateChangeSet` + `PendingAction` 提请人类 Git Diff 审查，经确认后方可写入 canonical 目录并触发 Git 提交。
> 3. **双向贯通**：生成的角色与舞台支持“一键直接开启 Play 模式推演”，或“一键纳入 Writing 创作引用源”。

---

## 目录

1. [背景与核心痛点](#1-背景与核心痛点)
2. [总体架构与业务闭环](#2-总体架构与业务闭环)
3. [Phase 1：共创交互协议与想法商讨引擎 (Discuss Engine)](#3-phase-1共创交互协议与想法商讨引擎-discuss-engine)
4. [Phase 2：深度角色塑造与方案规整系统 (Plan & Character Depth)](#4-phase-2深度角色塑造与方案规整系统-plan--character-depth)
5. [Phase 3：分块结构化撰写与实时质检器 (Writer & Local Checker)](#5-phase-3分块结构化撰写与实时质检器-writer--local-checker)
6. [Phase 4：向导式前端交互界面 (Forge UI & ChangeSet 审批落盘)](#6-phase-4向导式前端交互界面-forge-ui--changeset-审批落盘)
7. [Phase 5：推演与写作双向联动打通 (Play & Writing Integration)](#7-phase-5推演与写作双向联动打通-play--writing-integration)
8. [执行路线图与验收矩阵](#8-执行路线图与验收矩阵)

---

## 1. 背景与核心痛点

在同人创作与小说设定构建中，创作者常面临三大瓶颈：
1. **“空白表单冷启动恐惧”**：面对姓名、性格、背景、世界观等几十个空字段，创作者脑中往往只有一个模糊的直觉形象或某张图，不知从何下笔。
2. **“AI 一键生成空洞面谱化”**：直接让通用 AI“帮我写个傲娇角色”，产出的往往是充满“温柔善良、美目盼兮、嘴角上扬”等烂俗套话的纸片人，缺乏立体动机与行为依据。
3. **“设定无法在推演与写作中无缝流转”**：市面上的工具要么仅是聊天卡片生成器，要么是静态设定集，做出的角色无法一键投入 Play 模式跑团推演，也无法被 Writing Copilot 深度理解。

`CicaTavern` 的 Forge（共创向导）模块给出了极具启发性的工程方案：通过生动的“台词样例”帮用户做直觉抉择、通过“试写片段”选文风、通过“性格调色盘与三面性”打破刻板标签、通过“LINT 正则”实时剔除套话，并区分模型推测与用户确认。

本计划将这一整套方法论引入 OAN，打造符合 Filesystem-first 与 Human Approval 原则的**“设定工坊引导式共创向导（Setting Forge）”**。

---

## 2. 总体架构与业务闭环

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Setting Forge Workflow                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Step 1: 聊想法 (Discuss)]                                                  │
│   • 提问带生动台词样例 (sample) 凭直觉选                                    │
│   • 给出 2~3 段不同写法试写 (taste) 选文风                                  │
│   • 诚实标记 by: user / by: assistant，支持草图项锁定 (locked: true)        │
│   • 实时跟踪就绪度 (Readiness 0% -> 100%)                                   │
│                                  │                                          │
│                                  ▼                                          │
│  [Step 2: 定方案 (Plan)]                                                    │
│   • 角色调色盘 (底色 + 主色调 + 点缀 + 衍生场景行为)                        │
│   • 角色三面性 (不同压力下的面孔、习惯动作、纯台词语料)                      │
│   • 二次反刻板解释 (纠正模型对该特质的刻板理解)                              │
│   • 舞台、规则、地点场景与开场白规划                                        │
│                                  │                                          │
│                                  ▼                                          │
│  [Step 3: 动笔写 (Write & Check)]                                           │
│   • 分块并发或流水线撰写 (YAML 风格紧凑条目，拒绝散文废话)                   │
│   • 本地反套话 LINT 规则库毫秒级过滤 (破折号、嘴角勾起、心湖泛起涟漪等)     │
│   • 模型审稿并微创修正 (original -> suggestion)                             │
│                                  │                                          │
│                                  ▼                                          │
│  [Step 4: 审查与落盘 (Human Approval & Materialize)]                        │
│   • 转换为 OAN CandidateChangeSet                                           │
│   • 写入 Canonical 对象文件树:                                              │
│     - characters/<id>/profile.md & roster-profile.yaml                      │
│     - world/places/<place-id>.md & world/rules.md                           │
│   • Git 自动提交生成版本                                                    │
│                                  │                                          │
│                                  ▼                                          │
│  [Step 5: 价值闭环] ──────────────────────────────────────────┐             │
│   • [一键开演] -> 启动 Play Session (带入场景与角色)          │             │
│   • [一键入书] -> 成为 Writing Copilot 激活参考资料 (Sources) │             │
└───────────────────────────────────────────────────────────────┴─────────────┘
```

---

## 3. Phase 1：共创交互协议与想法商讨引擎 (Discuss Engine)

### 3.1 核心理念：直觉化、可感化、反术语
不逼迫用户做抽象定义，而是将问题包装为具体的台词、试写与场景。向导负责把零散想法结构化为“设定草图（Brief Sketch）”。

### 3.2 详细设计契约

#### 1. 提问与样例协议 (`ForgeQuestion`)
在 `packages/core/src/forge-types.ts` 中定义向导返回的数据契约：
```typescript
export interface ForgeOption {
  label: string; // 简短选项名称，如“傲娇但重情义”
  detail?: string; // 一句话补充说明
  sample?: string; // 关键：角色可能说的活人台词，或一两句情境描写
}

export interface ForgeQuestion {
  id: string;
  title: string; // 核心问题，如“她平时是怎么跟你相处的？”
  why: string; // 为什么需要定这个，一句话解释其对故事的影响
  kind: 'single' | 'multi' | 'taste'; // taste 为试写挑选文风
  options: ForgeOption[];
}
```

- **文风试写（`kind: 'taste'`）**：针对同一场景生成 2~3 段不同语调的短试写（各 60~120 字），让作者选出最中意的语感与叙述腔调；
- **拒斥行话**：交流中不出现“世界书”、“MVU”、“Token 深度”等术语，改用“舞台”、“你们的关系”、“随情节变化的数值（如好感、精力）”。

#### 2. 设定草图数据结构 (`ForgeBrief`) 与锁定机制
```typescript
export interface BriefItem {
  key: 'stage' | 'lead' | 'user' | 'bond' | 'play' | 'tone' | 'style' | 'cast' | 'track' | 'opening';
  label: string;
  value: string; // 具体的设定事实
  by: 'user' | 'assistant'; // 诚实来源：用户明说的，还是模型脑补的
  locked?: boolean; // 用户显式锁定的项，模型后续轮次不得擅自篡改
}

export interface ForgeBrief {
  title: string; // 暂定作品/卡片名
  readiness: number; // 就绪度 0~100
  items: BriefItem[]; // 设定事实条目列表
  openPoints: string[]; // 尚未确定的关键盲区提示
}
```

#### 3. 商讨轮次驱动（Discuss Prompt & Parser）
在 `packages/core/src/forge-discuss.ts` 中实现：
- 向导 System Prompt 明确角色：共创陪伴者，先用一两句肯定并复述当前理解，每次只问 2~3 个最关键问题；
- 结构化返回协议：严格输出 `<reply>`、`<questions>`、`<brief>` 三大 XML 块，由解析器安全解析并做 JSON 容错。

---

## 4. Phase 2：深度角色塑造与方案规整系统 (Plan & Character Depth)

### 4.1 核心理念：拒绝纸片人标签
当就绪度达到 75% 以上，或用户主动点击“生成方案”时，系统将零散草图规整为完整的**角色与舞台方案（Forge Plan）**。方案中强制要求落地以下高级文学塑造机制：

### 4.2 深度塑造机制

#### 1. 性格调色盘 (Personality Palette)
- **底色 (Base)**：角色深层最本质的认知与世界观底色（如“安全感缺失带来的掌控欲”）；
- **主色调 (Main Tones)**：日常最显性的 1~2 个性格特质（如“克制的礼貌”、“敏锐的观察力”）；
- **点缀 (Accents)**：反差萌或隐藏特质（如“面对小动物时的笨拙”）；
- **具体衍生**：每个特质必须衍生出 2~3 条具体场景行为准则（“当遇到...她会...，绝不...”），严禁只留抽象标签。

#### 2. 角色三面性 (Character Facets)
强制拆解角色在不同情境与压力下的面孔：
- **常态面**：日常社交时的言谈举止；
- **压力面**：极端危机、背叛或疲惫时暴露的真实状态；
- **私密面**：独处或面对绝对信任者时的破防反应；
- 每一面必须提供：**触发条件**、**身心状态**、**5~10 句纯台词语料（不含动作与心理）**、**习惯动作**。严禁在三面性中用“因为、本质上、其实”进行心理学事后解释。

#### 3. 二次反刻板解释 (Clarifications / De-cliche)
专门纠正 AI 常见的刻板印象理解偏差：
- 针对选定的性格特质，明确定义：“关于该特质，它**真正意味着什么**，**什么时候展现**，**什么绝对不是它**（例如：傲娇不是无脑刻薄打骂，而是自尊心过强导致的言不由衷）”。

#### 4. 舞台世界与开场白设计
- **舞台世界**：分为真实背景或架空设定，必须列出与常识不同的规则、核心势力、重要地点场所及影响当前局势的历史往事；
- **开场白（Greeting）**：必须遵循“头三行见悬念/反常/冲突”、“角色凭动作与台词出场”、“提供给玩家明确的话头与行动切入点”。

---

## 5. Phase 3：分块结构化撰写与实时质检器 (Writer & Local Checker)

### 5.1 模块化分块撰写 (Chunked Writing)
在方案被作者核准后，进入动笔阶段（`packages/core/src/forge-writer.ts`）。
为保证内容密度与格式规范，动笔采用**分块并行撰写**：
1. **世界观与规则块**（世界框架、社会规则、势力分布，YAML 风格）；
2. **地点与场景块**（每个场所的样子、氛围、出没人物、常发事件）；
3. **核心角色档案与调色盘块**；
4. **角色三面性与语料块**；
5. **反刻板二次解释块**；
6. **抓人开场白块**。

每个条目只写模型会搞错的事实与核心表现依据，缩进清晰，拒绝空洞散文。

### 5.2 实时本地套话过滤与审稿修正
撰写生成文本后，立即调用 Phase 5 的 `NovelLintEngine`（反套话质检器）进行毫秒级过滤：
- **扫描**：检查是否出现了“嘴角勾起/上扬”、“似乎/仿佛”、“心湖泛起涟漪”、“温柔善良”等 11 类套话；
- **模型审稿（Review Request）**：将扫描出的命中点连同原文送入审稿提示词，要求模型返回精准修改列表：
  ```json
  [
    {
      "target": "角色档案",
      "type": "表情套话",
      "original": "嘴角泛起一丝冷笑",
      "suggestion": "微微眯起眼"
    }
  ]
  ```
- **自动应用**：就地微创替换原文，确保进入作者眼睛的是经过高标准文学质检的优质设定。

---

## 6. Phase 4：向导式前端交互界面 (Forge UI & ChangeSet 审批落盘)

### 6.1 前端向导组件设计
在 `apps/desktop-ui/src/components/forge/` 下构建完整的沉浸式向导模态框：

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 设定共创工坊 (Setting Forge)                                           [×]   │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 左侧：向导商讨区 (Discuss Panel)     │ 右侧：实时设定草图 (Live Brief)      │
│                                      │                                      │
│  [AI 向导]                           │  【暂定名】夜城侦探社                │
│  “听起来你想要一个外表冷酷但在暗中   │  【就绪度】████████░░ 80% [出方案]   │
│   保护主角的搭档。她平时怎么说话？”  │ ──────────────────────────────────── │
│                                      │  • 舞台: 赛博朋克九龙城寨 [🔒 锁定]  │
│  [选项 A: 惜字如金，指令明确]         │  • 核心角色: 凌雪 [by: user]         │
│  台词：“子弹还有三发，别废话，跟紧。”│  • 性格底色: 机械义体带来的异化感    │
│                                      │  • 你们的关系: 欠债搭档 [by: AI ✏️]   │
│  [选项 B: 毒舌挖苦，实则护短]         │ ──────────────────────────────────── │
│  台词：“要是死在这儿，你的欠条谁还？”│  【未决关键点】                      │
│                                      │  - 她身体义体化的具体代价？          │
│  [选项 C: 我有别的想法... (自定义输入)│                                      │
│                                      │                                      │
│  [输入框: 补充你的想法...]  [发送]   │  [锁定此项] [编辑修改] [放弃重置]    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

- **交互体验**：单选/多选一键点击推进；台词样本清晰标注；草图条目一键锁定；
- **方案编辑**：点击“出方案”后进入方案大纲看板，作者可直接拖拽调整条目、修改三面性台词。

### 6.2 转换为 CandidateChangeSet 与受控落盘
当作者点击“定稿生成并入库”时：
1. 后端将生成的设定转换为对应目录结构的改动集合：
   - `characters/<character-id>/profile.md`
   - `characters/<character-id>/roster-profile.yaml`
   - `world/places/<place-id>.md`
   - `world/rules.md`
2. 打包生成 OAN 标准的 `CandidateChangeSet`；
3. 前端弹出标准的 `PendingAction` 确认视窗，展示即将新建或修改的文件 Git Diff；
4. 作者点击 **Accept**，系统原子写入文件系统，并执行自动 Git 提交（如 `feat(forge): create character 凌雪 and setting 夜城`）。

---

## 7. Phase 5：推演与写作双向联动打通 (Play & Writing Integration)

入库成功后，界面提供两条明确的即时闭环动作：

```text
┌────────────────────────────────────────────────────────┐
│              🎉 设定已成功保存并提交入库！              │
│                                                        │
│  [ 🎮 一键以此角色与场景开启推演 (Play Mode) ]          │
│  -> 自动创建 Play Session，装载该角色名册与开场白，     │
│     直接进入视觉小说视窗展开互动剧情。                 │
│                                                        │
│  [ ✍️ 作为当前小说的设定参考资料 (Writing Mode) ]       │
│  -> 自动将生成的角色档案与地点加入当前卷/章的激活素材， │
│     Writing Copilot 在写作与审稿时自动引用。           │
└────────────────────────────────────────────────────────┘
```

- **与 Play 模式打通**：调用已有的 Play Session 创建服务，将 Forge 产出的角色名册与精编开场白直接作为第一轮回合呈现；
- **与 Writing 模式打通**：更新作品的 `novel.config.yaml` 或元数据，使其出现在 Copilot 的可用设定资源面板中。

---

## 8. 执行路线图与验收矩阵

| 任务编号 | 交付模块 | 核心工作内容 | 验收标准 (Done Criteria) |
|---|---|---|---|
| **F-1** | `ForgeTypes` & `DiscussEngine` | 1. 定义 `ForgeQuestion`、`ForgeBrief`、`BriefItem` 类型。<br>2. 实现带台词样例（sample）和试写文风（taste）的商讨 System Prompt。<br>3. 实现 XML 结构安全解析与容错 JSON 抽取。 | 1. 模拟 3 轮商讨，返回的每个选项均包含生动台词样例。<br>2. 区分 `by: user` 与 `by: assistant` 标记。<br>3. 单元测试覆盖草图项锁定与就绪度演进。 |
| **F-2** | `PlanGenerator` & Character Depth | 1. 实现方案大纲生成提示词与归一化逻辑。<br>2. 嵌入性格调色盘（底色/主色/点缀）、三面性与反刻板二次解释。<br>3. 整合世界观与开场白规范。 | 1. 输出完整的 `ForgePlan`，包含三面性纯台词语料（每面 5 句以上）。<br>2. 二次解释明确阐明特质边界。<br>3. 开场白头三行具备反常/悬念。 |
| **F-3** | `ChunkedWriter` & Lint Hook | 1. 分块并行撰写世界观、角色档案、三面性、二次解释与开场白。<br>2. 接入 `NovelLintEngine` 实时套话过滤与微创修正。 | 1. 产出条目为规范紧凑的 YAML/Markdown 格式。<br>2. 11 类套话在生成后被自动扫描并修正，无明显陈词滥调。 |
| **F-4** | `ForgeWizardModal.vue` & ChangeSet | 1. 开发向导模态框（商讨区 + 实时草图看板 + 方案审查看板）。<br>2. 转换为标准 `CandidateChangeSet` 并提请 `PendingAction` 审查。 | 1. 用户完成向导后，可在 Diff 视窗中直观看到将要写入的 canonical 文件。<br>2. 点击 Accept 成功落盘为合法文件并触发 Git 提交。 |
| **F-5** | Play & Writing Linkage | 1. 落地“一键开演”与“一键入书”动作接口。<br>2. 与现有 Play Session 及 Writing Context 引用打通。 | 1. 点击“一键开演”能够无缝在新创建的 Play Session 中看到该角色与开场白并开始交互。 |

---

## 9. 总结

本计划将 `CicaTavern` 中备受好评的“共创向导哲学”完全原生化移植到 OAN。它不是一个浮于表面的聊天插件，而是一个**将文学创作规律（调色盘、三面性、反套话）、人机协同伦理（来源透明、用户锁定）与现代软件工程（Filesystem-first、Git Diff 审批）深度熔铸一体的高级设定生产力引擎**。
