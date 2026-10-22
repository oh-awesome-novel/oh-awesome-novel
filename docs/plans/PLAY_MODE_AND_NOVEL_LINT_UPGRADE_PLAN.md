# Play 模式与小说去 AI 味反套话质检升级计划

> 状态：Planned
>
> 对标参考：`reference-only/CicaTavern` (v1.8.1) 及分析报告 [`docs/research/CICATAVERN_REFERENCE_ANALYSIS.md`](../research/CICATAVERN_REFERENCE_ANALYSIS.md)
>
> 既有底座：
> - Play 模式已具备独立一级工作区、session schema v4、turns 结构化事实、world clock 与事件调度、单一只读 world referee 及 `PendingAction` 采纳机制（见 `docs/tasks/1120.md`）。
> - Writing 模式已具备 `/去AI味` 快速指令、保护规则定义 `DE_AI_PROTECTION_RULES` 与审稿契约 `ReviewFinding`（见 `packages/core/src/writing-review.ts` 与 `docs/tasks/1030.md`）。
>
> 规划边界与约束：
> 1. 严格遵守 **Filesystem-first** 原则，所有推演状态、名册扩展、剧情存档均落盘为 Markdown / YAML / Object File Tree，不引入私有数据库。
> 2. 严格遵循 **Human Approval** 机制，推演产生的新设定、LINT 提出的正文润色修改，必须走 `CandidateChangeSet` + `PendingAction`，经人类 Git Diff 确认后方可合入 canonical 文件。
> 3. 本期聚焦推演核心体验与反套话文本质检，**明确不接入生图与 TTS 接口调用**，仅在名册与场景协议中建立完备的数据契约与结构化预留。
> 4. 计划包含五个核心阶段：
>    - **Phase 1 (P0)**：Play 模式 Prompt Cache 布局重构 (Frozen Prefix & Tail Injection)
>    - **Phase 2 (P0)**：五维剧情存档协议 (Play Compaction)
>    - **Phase 3 (P1)**：独立视觉小说推演视窗 (Visual Novel View)
>    - **Phase 4 (P1)**：角色名册与形象/声线一致性体系 (名册与协议层，暂不接入生图/TTS)
>    - **Phase 5 (P0)**：写作与设定反套话质检器 (Novel LINT，结合既有去 AI 味体系)

---

## 目录

1. [背景与核心目标](#1-背景与核心目标)
2. [总体架构与模块关系](#2-总体架构与模块关系)
3. [Phase 1 (P0)：Play 模式 Prompt Cache 布局重构](#3-phase-1-p0play-模式-prompt-cache-布局重构)
4. [Phase 2 (P0)：五维剧情存档协议 (Play Compaction)](#4-phase-2-p0五维剧情存档协议-play-compaction)
5. [Phase 3 (P1)：独立视觉小说推演视窗 (Visual Novel View)](#5-phase-3-p1独立视觉小说推演视窗-visual-novel-view)
6. [Phase 4 (P1)：角色名册与形象/声线一致性体系 (暂不接生图与TTS)](#6-phase-4-p1角色名册与形象声线一致性体系-暂不接生图与tts)
7. [Phase 5 (P0)：写作与设定反套话质检器 (Novel LINT & 去AI味融合)](#7-phase-5-p0写作与设定反套话质检器-novel-lint--去ai味融合)
8. [执行路线图与验收矩阵](#8-执行路线图与验收矩阵)

---

## 1. 背景与核心目标

在消化 `CicaTavern` 的架构与设计亮点后，结合 OAN 作为“个人同人/综漫创作工作台（Play 推演 + Writing 写作双核心）”的定位，我们发现以下核心机会与痛点：

1. **推演成本高、首字延迟大**：当前 Play 模式每轮回合都重新拼装 Prompt，导致发送给模型的 System/User 文本无法保持字节级稳定，破坏了 Claude/DeepSeek/OpenAI 的 Prompt Cache，数十轮后单次回合成本剧增。
2. **长对话遗忘与上下文超限**：推演进入中后期，上下文容易膨胀，缺乏结构化的“剧情压缩与记忆提炼”协议，新会话也无法平滑延续文风与未结线索。
3. **推演表现形态单一**：目前仍以普通聊天列表为主，缺乏让同人作者身临其境的“视觉小说（Galgame）”演出模式（分句对白、说话人名字牌、立绘排布、中央选项）。
4. **角色多模态设定碎片化**：角色档案缺乏统一的固定外貌（Booru tags）、衣着、声线标识与结构化场景描述协议，多人同场时无法保证特征稳定。
5. **AI 写作套话与面谱化严重**：OAN 虽定义了 `/去AI味` 保护规则，但缺少快速准确的“本地套话规则扫描（LINT）”，且缺乏“针对可疑套话的局部微创替换”工作流。

本计划旨在通过 5 个阶段彻底打通上述瓶颈，使 OAN 的推演更省钱（降本 80%+）、更有代入感（视觉小说演出）、记忆更持久（五维存档），同时让小说正文与角色设定的去 AI 味真正具备毫秒级自动化质检能力。

---

## 2. 总体架构与模块关系

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                OAN Core                                     │
├──────────────────────────────────────┬──────────────────────────────────────┤
│             Play 核心系统             │              Writing 质检系统        │
│                                      │                                      │
│  [PlayPromptLayout]                  │  [NovelLintEngine]                   │
│   • 冻结系统前缀 (Frozen Prefix)       │   • 11类反套话正则规则库             │
│   • 尾部增量追加 (Tail Injection)     │   • 本地毫秒级命中定位 (LintHit)     │
│   • Cache 断点精准标记               │                                      │
│                                      │  [De-AI Workflow]                    │
│  [PlayCompaction]                    │   • DE_AI_PROTECTION_RULES 保护规则  │
│   • 五维剧情存档协议                 │   • 局部替换建议 (original -> fix)   │
│   • 二分截断与无缝续写接续           │   • ReviewFinding / ChangeSet 审批   │
│                                      │                                      │
│  [CharacterRoster]                   │                                      │
│   • 固定外貌 (Booru tags) / 衣着     │                                      │
│   • 别名映射与预留音色声线           │                                      │
│   • 结构化画面拆解协议               │                                      │
└──────────────────────────────────────┴──────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Apps & UI (Vue 3)                                 │
│                                                                             │
│  [VisualNovelStage.vue]               [WritingLintBar.vue]                  │
│   • 自然语言分句流式输出 (Beats)        • 编辑器实时/手动套话高亮标记         │
│   • 说话人识别与名字牌着色              • 一键拉起微创去AI味审批              │
│   • 半身立绘与场景背景渲染              • Diff 对比与人类 Accept 确认         │
│   • 屏幕中央选项卡 (快捷键 1~9)                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phase 1 (P0)：Play 模式 Prompt Cache 布局重构

### 3.1 动机与设计原则
在推演对话中，**“不可变的前置事实”占 80% 以上，而“单轮动态变化的事实”仅占 20%**。
必须遵循 Cache-First 原则：
- **前缀必须字节级不可变**：一旦 Session 启动，System Prompt 不得再被动态修改。
- **动态内容严格下沉至尾部**：无论是触发的世界书、当前局部状态变更，还是本轮字数要求，一律放进最新的一条 User 消息内。
- **精准设置断点**：针对 Anthropic/Claude 等提供显式缓存端点的 provider，在 System Prompt 与最近稳定回复处打上 `cache_control`。

### 3.2 详细设计契约

#### 1. 冻结系统前缀（Frozen System Prompt）
在 `packages/core/src/play-session.ts` 中升级 `buildPlayFrozenSystemPrompt`：
```text
┌────────────────────────────────────────────────────────────┐
│ 1. 核心叙述者准则 (叙事角色、拒绝元信息、第三人称/第二人称)  │
│ 2. 作品宪法约束 (世界观常驻铁律)                            │
│ 3. 参与角色核心档案 (姓名、身份、基础性格、对话样例)        │
│ 4. 玩家角色档案 (Persona)                                  │
│ 5. 常驻世界设定 (Constant World Lore)                      │
│ 6. 每轮回复都要遵守的固定规则 (输出格式、oan-play-settlement)│
└────────────────────────────────────────────────────────────┘
```
此字符串在 Session 初始化或重构前缀时计算生成，写入 `session.yaml` 的 `metadata.frozenSystemPrompt`，在整个分支推演过程中保持不变。

#### 2. 尾部增量组装（Turn Tail Message）
每轮用户发送行动时，由 `packages/core/src/play-turn-prompt.ts` 组装最新 User 消息：
```markdown
<开场>（仅首轮存在）</开场>
<前情提要>（仅压缩后的新会话首轮存在，见 Phase 2）</前情提要>
<世界设定>
【词条名】
本轮关键词触发的临时世界设定...
</世界设定>
<当前状态>
{"好感度": 45, "体力": 80, "地点": "后山树林"}
</当前状态>
<本轮回合要求>
篇幅约 500 字，按规定输出结算块。
</本轮回合要求>
<玩家输入>
我拔出木剑，警惕地看向灌木丛。
</玩家输入>
<本轮提醒>本轮回复同样遵守系统前缀末尾「每轮回复都要遵守」一节的全部要求。</本轮提醒>
```

#### 3. 原位缓存辅助提问 (`askInPlayContext`)
在 `packages/backend` 与 `packages/runtime` 中提供 `askInPlayContext(sessionId, turnId, instruction)` 方法：
- 复用该 Session 的 `frozenSystemPrompt` 与历史消息；
- 仅在末尾追加单条指令（如提取局部场景、总结当前气氛）；
- 充分命中已有前缀缓存，实现毫秒级辅助问答。

### 3.3 涉及文件与改动
- `packages/core/src/play-session.ts`：增加 `frozenSystemPrompt` 字段与编译函数。
- `packages/core/src/play-turn-prompt.ts`：重构单轮回合 prompt 组装逻辑。
- `packages/backend/src/play-service.ts`：在调用 LLM 时设置缓存断点（Anthropic `cache_control: { type: 'ephemeral' }`）。
- `__test__/core/src/play-prompt-cache.test.ts`：编写单测验证前缀内容在多次回合间的一致性。

---

## 4. Phase 2 (P0)：五维剧情存档协议 (Play Compaction)

### 4.1 动机与核心策略
当推演超过一定轮数（例如 20~30 回合，或 token 达到预设水位）时，模型上下文将逐渐面临窗口限制与长程遗忘。
本阶段建立专用的 **五维剧情存档协议（Play Compaction）**，在上下文温暖时进行结构化精炼，并以平滑续写机制开启轻量新会话。

### 4.2 详细设计契约

#### 1. 五维剧情存档数据结构 (`PlayCompactionSchema`)
在 `packages/core/src/play-compaction.ts` 中定义标准归档协议：
```typescript
export interface PlayCompactionData {
  version: 1;
  turnsCovered: number;
  characters: Array<{
    name: string;
    identity: string;
    relationshipChange: string;
    currentSituation: string;
  }>;
  chronicle: string[]; // 按时间顺序的关键事实，保留地点、物品、约定和台词原话
  unresolvedThreads: string[]; // 伏笔、悬念、未兑现承诺、正在激化的冲突
  currentScene: {
    timeAndPlace: string;
    presentCharacters: string[];
    atmosphere: string;
    immediateCrisis: string;
  };
  voiceAndStyle: {
    pov: string;
    rhythm: string;
    tonePoints: string[];
  };
}
```

#### 2. 剧情归档提示词协议
向模型发送专属归档指令：
```text
【暂停推演：生成剧情存档】
本条不是剧情，请勿续写。当前推演将转移到全新上下文中继续。
请根据上述对话历史，按要求提炼一份剧情存档，包含：
1. 人物：出场重要人物的身份变化、与主角的关系演进、当前处境。
2. 经过：按时间顺序记录核心事实。必须保留具体细节（地点、道具、数字、约定、关键台词）。
3. 未完的线：伏笔、悬念、未结冲突与承诺。
4. 当前场景：时间地点、在场人员、当下危机与气氛。
5. 文风基调：人称、节奏与典型语调。
严格输出在 <剧情存档> 与 </剧情存档> 之间。
```

#### 3. 无缝新会话接续机制
- 归档成功后，在当前 Session 的 turn 节点上打上 `compaction: PlayCompactionData` 标记；
- 开启新推演会话时：
  1. 系统前缀（`frozenSystemPrompt`）保持**完全相同**（继续吃全系统缓存）；
  2. 第一轮 User 消息中嵌入 `<前情提要>`：
     ```markdown
     <前情提要>
     故事已推进一段时间，之前记录已收起。以下是剧情存档与最近两轮回合原文，请自然接续：
     <剧情存档>
     ...五维结构化提炼文本...
     </剧情存档>
     <最近原文>
     【主角】...
     【角色】...
     </最近原文>
     </前情提要>
     ```
  3. 后续回合恢复常规推进，上下文重新归零并保持极低消耗。

### 4.3 涉及文件与改动
- `packages/core/src/play-compaction.ts`：定义 schema、提炼 prompt 与解析逻辑。
- `packages/backend/src/routes/play-compaction-routes.ts`：提供 `POST /api/play/sessions/:id/compact` 路由。
- `apps/desktop-ui/src/components/play/PlayCompactionModal.vue`：UI 上提供“剧情归档”按钮、预览提炼内容与一键开启新阶段。
- `__test__/core/src/play-compaction.test.ts`：覆盖解析器对合法与容错 XML 标签的测试。

---

## 5. Phase 3 (P1)：独立视觉小说推演视窗 (Visual Novel View)

### 5.1 动机与交互体验提升
OAN 当前的 Play 视窗虽然已经支持回合查看与分支选择，但交互仍偏向纯文本气泡。对于同人/综漫创作者而言，“视觉小说（Galgame）”形态能带来无与伦比的临场感与代入感。
本阶段在保留现有专业工作台视窗的同时，新增**全屏/主区域的独立视觉小说演出视窗**。

### 5.2 详细设计契约

#### 1. 自然语言切分与流式演出引擎 (`TextSpeakerParser`)
在 `packages/core/src/text-speaker-parser.ts` 中实现：
- **分句切分（Beats 切分）**：依据中文标点（`。！？…`）与引号将长叙述流式切为演出节拍；
- **说话人识别（Speaker Inference）**：
  - 引语前动词推断：`念念轻声说` $\to$ 说话人为“念念”；
  - 引语后动词推断：`……林师兄苦笑道` $\to$ 说话人为“林师兄”；
  - 常见行当称谓识别：`掌柜`、`店小二`、`老伯`、`侍女` 自动赋予独立说话人身份；
  - 严格排除误判（`NOT_NAME`）：过滤 `沉默片刻`、`忽然`、`笑得很短` 等常见叙述误词；
- **标签安全携带（`carryTags`）**：在分句切分时，跨句的 Markdown 或 HTML 格式标签自动闭合并在下一句重新开启，避免打字机流式渲染崩溃。

#### 2. 视觉小说演出主视窗 (`VisualNovelStage.vue`)
在 `apps/desktop-ui/src/components/play/` 下构建组件：
- **背景层**：根据当前场景（`currentScene`）匹配地点背景；支持日落、深夜等 CSS 氛围色调；
- **立绘层**：居中或左右排布当前说话角色的半身像（优先展示去底立绘或头像）；
- **对白对话框**：
  - 角色名字牌：根据角色自动分配专属色调；
  - 对白与旁白区分：对白高亮上色，旁白适度弱化；
  - 打字机流式播放，支持空格/回车快速跳过当前句；
- **中央抉择面板**：
  - 检测结算中的分支建议或行动选项（如 `1️⃣... 2️⃣...`），在屏幕中央以优雅卡片浮出；
  - 支持键盘数字键 `1~9` 快速做出选择并派发下一回合。
- **辅助功能栏**：
  - `Log`：一键调出全历史文本回看抽屉；
  - `View Switch`：一键在“Galgame 沉浸演出模式”与“专业推演工作台模式”之间平滑切换。

### 5.3 涉及文件与改动
- `packages/core/src/text-speaker-parser.ts`：实现中文分句、说话人识别与标签携带算法。
- `apps/desktop-ui/src/components/play/VisualNovelStage.vue`：视觉小说主演出视窗。
- `apps/desktop-ui/src/components/play/VisualNovelTextBox.vue`：名字牌与文本打字机组件。
- `apps/desktop-ui/src/components/play/VisualNovelChoiceOverlay.vue`：中央分支抉择组件。
- `__test__/core/src/text-speaker-parser.test.ts`：针对各种复杂中文句式的说话人解析单测。

---

## 6. Phase 4 (P1)：角色名册与形象/声线一致性体系 (暂不接生图与TTS)

### 6.1 动机与范围明确
- **范围澄清**：按照用户明确指令，**本阶段先不接入真实生图（ComfyUI/SD/OpenAI）与 TTS 语音接口调用**。
- **核心重点**：构建规范的**角色名册（Character Roster）数据结构、别名映射与结构化场景描述协议**，把数据模型和协议契约做扎实，为未来随时点亮生图与语音打下坚实基础。

### 6.2 详细设计契约

#### 1. 角色名册规范（`CharacterRoster` Schema）
在 `packages/core/src/character-roster.ts` 中定义并扩展 OAN 角色数据结构：
```typescript
export interface RosterCharacter {
  id: string; // 唯一标识符
  name: string; // 标准名称
  aliases: string[]; // 常用别名、昵称、尊称（直接供 Phase 3 说话人识别使用）
  genderKind: 'girl' | 'boy' | 'other';
  isPlayer: boolean; // 是否代表当前玩家/主角
  // 外观一致性数据（预留给未来绘图）
  looks: {
    fixedBooruTags: string; // 不变的外貌 tags (如 "silver hair, red eyes, ponytail")
    outfitDescription: string; // 默认日常衣着
    outfitTags: string; // 衣着 booru tags
    refImagePath?: string; // 人设参考图相对路径
    loraName?: string; // 专有 LoRA 模型名称
    loraTrigger?: string; // LoRA 触发词
  };
  // 声线配置预留（预留给未来 TTS）
  voiceConfig?: {
    preferredVoiceId: string; // 推荐音色 ID
    pitchOffset?: number;
  };
}
```
存储方式严格遵循 **Filesystem-first**：
- 保存在角色目录 `characters/<character-id>/roster-profile.yaml` 或与现有 `profile.md` 紧密关联。

#### 2. 结构化场景画面拆解协议（Scene Frame Protocol）
为避免未来生图或视觉小说模式中多人同框产生特征混乱，定义统一的场景画面拆解文本协议：
```text
场景: <环境地点, 光影, 天气氛围>
[角色A] <当前衣着, 姿势, 动作, 表情> | left
[角色B] <当前衣着, 姿势, 动作, 表情> | right
```
当系统需要推演场景的视觉呈现时，辅助模型仅需输出上述极简结构；引擎层将自动把 `looks.fixedBooruTags` 和参考图映射进去。本期先完成该协议的解析与测试验证。

### 6.3 涉及文件与改动
- `packages/core/src/character-roster.ts`：定义 Roster Schema、YAML 序列化/反序列化与别名查找函数。
- `packages/core/src/scene-frame-protocol.ts`：结构化画面描述的解析与验证器。
- `__test__/core/src/character-roster.test.ts`：名册解析、别名匹配与冲突处理单测。

---

## 7. Phase 5 (P0)：写作与设定反套话质检器 (Novel LINT & 去AI味融合)

### 7.1 动机与与既有去 AI 味体系的融合
- **既有底座**：
  - OAN 已经在 `packages/core/src/writing-review.ts` 中建立了 `DE_AI_PROTECTION_RULES`（去 AI 味保护规则：只改表达不改事实，不删伏笔钩子等），并在 Copilot quick commands 中注册了 `/去AI味`。
  - 目前的痛点是缺乏**快速客观的本地规则判定**，且完全依赖 LLM 全段重写，往往改动过大。
- **本阶段目标**：
  - 吸收 CicaTavern 经过实战检验的 **11 类中文反套话 LINT 规则库**；
  - 建立“**本地正则毫秒级扫描 $\to$ 标记高亮 $\to$ LLM 定向审稿建议 $\to$ CandidateChangeSet 局部微创替换**”的完整闭环。

### 7.2 详细设计契约

#### 1. 11 类中文反套话 LINT 正则规则库 (`NovelLintRuleSet`)
在 `packages/core/src/novel-lint.ts` 中实现：

```typescript
export interface LintRule {
  id: string;
  name: string;
  category: 'punctuation' | 'cliche' | 'style' | 'meta' | 'translation_ese';
  pattern: RegExp;
  description: string;
  suggestionHint: string;
}

export const NOVEL_LINT_RULES: LintRule[] = [
  { id: 'dash', name: '破折号滥用', category: 'punctuation', pattern: /——/g, description: '滥用破折号制造刻意停顿', suggestionHint: '改为逗号或调整句式直接叙述' },
  { id: 'vague_words', name: '模糊词', category: 'style', pattern: /似乎|仿佛|宛如|如同/g, description: '减弱叙述确定性与力量感', suggestionHint: '去除模糊词，写确切发生的事实或动作' },
  { id: 'facial_stock', name: '表情套话', category: 'cliche', pattern: /嘴角.{0,4}(上扬|勾起)|闪过一丝/g, description: '网络小说高度脸谱化套话', suggestionHint: '用具体眼神、肢体变化或语言反应代替' },
  { id: 'voice_stock', name: '声线套话', category: 'cliche', pattern: /带着.{1,8}的(口吻|语气)|用.{1,8}的语气/g, description: '说明性修饰，无法通过台词传达情绪', suggestionHint: '删去语气修饰，直接靠对白用词体现态度' },
  { id: 'stale_metaphor', name: '陈旧比喻', category: 'cliche', pattern: /心湖|泛起涟漪|投石入湖|像.{0,2}小兽/g, description: '烂俗陈词滥调', suggestionHint: '换用具有角色生活经验的原创比喻或直接描写' },
  { id: 'exaggerated_emotion', name: '夸张情绪大词', category: 'style', pattern: /万念俱灰|陷入(了)?极大的/g, description: '缺乏铺垫的悬浮情绪词', suggestionHint: '描写具体的生理反应或下意识小动作' },
  { id: 'negation_pivot', name: '否定转折啰嗦', category: 'style', pattern: /不是.{1,10}[，,]\s*(只是|而是)/g, description: '说理式句式，拖慢叙事节奏', suggestionHint: '直接写是怎样的状态' },
  { id: 'abstract_name', name: '名称不具体', category: 'style', pattern: /某(城市|学校|组织|公司|地方|小镇)|那个地方/g, description: '虚构偷懒，破坏世界真实感', suggestionHint: '赋予具体地名或专有名词' },
  { id: 'meta_leak', name: '元信息泄露', category: 'meta', pattern: /本卡|写作要点|戏剧(用途|作用)|详见|见上文/g, description: 'Prompt 或给作者看的设定泄露到正文', suggestionHint: '立即彻底删除' },
  { id: 'distant_emotion', name: '隔着讲情绪', category: 'style', pattern: /[她他](感到|意识到)|对自己说|并不知道/g, description: '违反 Show, don\'t tell，隔空说教', suggestionHint: '把情绪落实为当下的具体动作与感知' },
  { id: 'false_subject', name: '假主语/翻译腔', category: 'translation_ese', pattern: /一股.{0,8}(涌|蔓延)|被一种.{0,10}包裹|念头在.{0,4}(心里|心中)成形/g, description: '典型的西化翻译腔句式', suggestionHint: '改以人物或具体客观事物为主语' },
];
```

#### 2. 本地扫描与微创去 AI 味流程 (De-AI Workflow)
```text
┌────────────────────────────────────────────────────────┐
│ 1. 本地毫秒级扫描 (NovelLintEngine.scan)                │
│    • 遍历正文，匹配得到 LintHit 列表                   │
│    • 标明 offset、行号、原文片段、规则说明              │
├────────────────────────────────────────────────────────┤
│ 2. 送入模型进行微创修改建议 (Review & Suggest)           │
│    • 严格注入 DE_AI_PROTECTION_RULES 保护规则          │
│    • 严禁整段推倒重写！                                │
│    • 仅输出针对 Hit 的局部替换数组：                    │
│      [{"original": "嘴角微微上扬", "suggestion": "笑了笑"}]│
├────────────────────────────────────────────────────────┤
│ 3. 转化为 OAN 标准 CandidateChangeSet                  │
│    • 自动比对生成精准 Git Diff                          │
│    • 用户在审核面板逐项勾选，一键 Accept 落盘并 Git 提交 │
└────────────────────────────────────────────────────────┘
```

#### 3. 角色卡与设定导入反套话门禁
在导入外部 SillyTavern 角色卡或通过 Copilot 创建角色档案时，自动运行 LINT 过滤：
- 提前截获角色档案中的“温柔善良”、“嘴角勾起”等套话；
- 提示作者进行个性化细化，保证 Canonical 设定库的文字质量。

### 7.3 涉及文件与改动
- `packages/core/src/novel-lint.ts`：实现 11 类正则规则库与文本扫描器。
- `packages/core/src/writing-review.ts`：融合 LINT 结果至 `ReviewFinding` 与 `DE_AI_PROTECTION_RULES`。
- `packages/agent/src/tools/de-ai-tool.ts`：升级去 AI 味 Copilot 工具，支持微创局部替换提案。
- `apps/desktop-ui/src/components/editor/WritingLintBar.vue`：编辑器底部套话提示条。
- `__test__/core/src/novel-lint.test.ts`：11 类套话匹配与边界情况的完备单测。

---

## 8. 执行路线图与验收矩阵

| 阶段 | 优先级 | 核心交付物 | 验收标准 (Done Criteria) |
|---|---|---|---|
| **Phase 1** | **P0** | `PlayPromptLayout` (Frozen Prefix) | 1. Session 初始化生成静态前缀并固化在 session 元数据中。<br>2. 连续 5 回合推演，System Prompt 字节完全相同。<br>3. 动态设定与状态仅在尾部 user 消息增量注入。<br>4. 单元测试覆盖前缀不变性验证。 |
| **Phase 2** | **P0** | `PlayCompaction` (五维剧情存档) | 1. 结构化提取人物、经过、未完线索、场景与文风。<br>2. 归档后开启新会话，首轮成功注入 `<前情提要>` + 2 轮原文。<br>3. 历史 turns 树指针保留，不破坏分支回溯。<br>4. 容错解析 XML 标签单元测试通过。 |
| **Phase 3** | **P1** | `VisualNovelStage` (独立视觉小说视窗) | 1. 长文本流式切分为 Beats，正确渲染打字机动效。<br>2. 说话人识别准确推断常见引语前后动词与行当称谓，排除 `NOT_NAME`。<br>3. 跨句 Markdown/HTML 标签不崩溃（`carryTags`）。<br>4. 选项在屏幕中央弹出并支持按键 `1~9` 推进。 |
| **Phase 4** | **P1** | `CharacterRoster` (名册与协议层) | 1. 角色名册 Schema 完整定义（Booru tags、衣着、别名、预留声线）。<br>2. 别名查找与说话人推断平滑打通。<br>3. 结构化场景画面拆解协议解析器就绪。<br>4. 纯数据模型与协议测试通过（无真实外部生图/TTS 调用）。 |
| **Phase 5** | **P0** | `NovelLintEngine` (反套话质检器) | 1. 11 类反套话正则命中率在测试集上达 100%。<br>2. 严格遵守 `DE_AI_PROTECTION_RULES`，仅针对命中片段给出微创替换。<br>3. 替换建议成功转换为 `CandidateChangeSet` 并支持人类审批落盘。<br>4. 角色卡导入时套话扫描生效。 |

---

## 9. 结论

本升级计划既汲取了 `CicaTavern` 在**提示词缓存控制**、**视觉小说交互**、**长剧情归档**与**文学质检**上的精髓，又完全坚守了 OAN 的 **Filesystem-first** 和 **Human Approval** 铁律。通过这一系统性升级，OAN 将在保持轻量优雅架构的同时，实现推演体验与写作质检能力的代际飞跃。
