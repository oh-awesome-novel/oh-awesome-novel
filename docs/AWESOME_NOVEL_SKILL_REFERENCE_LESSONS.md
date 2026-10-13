# awesome-novel-skill 可吸收点候选清单

> **导航**：前置：[现状分析](AWESOME_NOVEL_SKILL_REFERENCE_OVERVIEW.md) ｜ 既有合并候选：[多项目横向分析 · 当前仍值得评估的增量](NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md) ｜ 同类：[StoryForge 候选清单](STORYFORGE_REFERENCE_LESSONS.md)
>
> **本文内部**：[与既有候选的关系](#与既有候选清单的关系) → [P0](#p0优先对照现有实现复核) → [P1](#p1核心闭环稳定后再增强) → [P2](#p2只作产品形态参考) → [不建议吸收](#不建议吸收的部分)

> 状态：候选参考笔记，不是 OAN 架构规范或实施计划。
>
> 当前基准：`reference-only/awesome-novel-skill` 已检出 `main@dcd1920`（2026-09-25，`v4.28.0`）。
>
> 配套现状分析：`docs/AWESOME_NOVEL_SKILL_REFERENCE_OVERVIEW.md`（先读其中的“v4.28.0 现状增量与修正”）。本轮只做静态阅读，没有运行上游脚本或测试。
>
> 约束：本文不会自动修改 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`。只有用户明确确认的条目，才能以 `[awesome-novel-skill]` 来源标记合并到 OAN 的正式参考笔记、task 或 plan。
>
> 许可证：上游为 AGPL-3.0，`check-prose.py` 另带第三方 MIT 移植声明。OAN 只吸收公开机制和设计思想，不复制源码、prompt、Agent 定义、知识库文本、词表或 UI 文案。

## 与既有候选清单的关系

此前没有 awesome-novel-skill 的独立清单。相关候选合并在 `docs/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md` 的“当前仍值得评估的增量”（基准 v4.8.x，跨 awesome-novel-skill / novel-writer-skills / oh-story-claudecode 等项目），以及 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` 的 `[AwesomeNovelSkill-reference]` 条目（基准仍写 v4.12.3）。本文只补 v4.13–v4.28 的增量，并与它们对齐：

- 既有第 2 项“写作规则冲突 provenance 与优先级测试”（来源含 prompt conflict table）≈ 本文 A3，合并处理。
- 既有第 3 项“prose lint 分 blocking 与 advisory”：句长、禁词密度、章尾形式、“AI 味”默认只能是 advisory，可机械证明的格式问题才 blocking；必须作者显式启用、不自动改正文、不以通过外部 AI 检测器为目标。**本文 A1 / A2 须服从这条**：check-prose 类规则默认 advisory。
- 既有第 7 项“Roleplay 作者干预保持 typed event”无新增。
- 既有“不建议吸收”清单（固定 Agent 图、SOLO、Skill 扩权等）仍然成立，本文只补充新增项。

## 总体判断

awesome-novel-skill 是 prompt 驱动的串行 SOP，不是 OAN 的架构模板。它对 OAN 最有价值的地方，不在“多 Agent 分工”，而在 v4.13 以后补上的几类**写作质量工程**：

- 确定性正文检查脚本（只报警，不改文）。
- “生成与清创分离”的去 AI 味方法。
- 契约先行、可机器验收的短篇结构门槛。
- 小说项目内累积的“翻车句库 / 锁定句白名单”。
- 文风蒸馏的版本留痕。

这些都可以放进 OAN 的 ToolSet、validator 和 CandidateChangeSet 流程里，而不需要固定 Agent 拓扑。

转换规则：

1. 吸收**规则与检查项**，不吸收 prompt 文本和词表原文。
2. 吸收**确定性工具**的形态（脚本 / validator 只产出 finding），不让检查直接改正式文件。
3. 吸收**项目内累积资产**的思路，但落到 OAN 的对象文件树，由 PendingAction + Git diff 确认。
4. 不吸收固定多 Agent、口头委托确认权和 prompt 声明式权限。

## 建议优先级

### P0：优先对照现有实现复核

| 编号 | 候选 | 来源 | OAN 映射 |
|---|---|---|---|
| A1 | **确定性正文检查作为 validator 工具** | `tools/check-prose.py`、`check-chapter.py`、anti-ai Phase 2 / 4 | 为 `review_chapter` / `anti_ai_review` 提供只读 checker，输出 typed findings（位置、规则 id、严重度、是否需人工判断）；Agent 只能据此提出 CandidateChangeSet，不能让检查器自己改文。失败项必须能在 UI 看见，工具缺失时明确降级而不是静默通过 |
| A2 | **“报警不改文”的严格分层** | 同上；退出码区分“无失败 / 有失败 / 读取失败” | OAN 的 validator 返回值应区分 pass / fail / needs-human / unreadable，四态不可混用 |
| A3 | **规则优先级的显式裁决顺序** | v4.22 提示词注入声明：作者设定与章纲 > 题材知识 > 结构默认值 > 检测优化 | 在 agent guide / style pack 合成 ContextPackage 时记录来源层级与冲突裁决结果，冲突落入 trace，而不是靠模型猜 |
| A4 | **机器可验收的写作硬底线** | 短篇每节 ≥ 800 字、整篇 ≥ 8000 字、反转位置 > 60%、伏笔回查等“全部实测，禁止模型估算” | 字数、段落形态、位置比例等一律由代码计算后交给模型，不让模型估算；放进 `novel.review_chapter` 的确定性前置检查 |

### P1：核心闭环稳定后再增强

| 编号 | 候选 | 来源 | OAN 映射 |
|---|---|---|---|
| A5 | **生成与清创分离**：写作 prompt 只注入正向要点和最小禁令清单，清创阶段先改结构再清句子 | v4.18 `living-voice`、Phase 3 顺序 | 写作 capability 与去 AI 味 capability 拆开；去 AI 味只在已有草稿上产生局部 patch，且先结构后措辞。不要把全部禁令塞进生成 prompt |
| A6 | **篇级写作契约 + 兑现度核对** | 短篇 `stories/{slug}/prompt.md`、`short-verify` | 写作前把“不可违反规则 + 本章要点 + 冲突裁定”固化为 session artifact（契约），定稿后逐项核对兑现度，未兑现项附原文证据回退。契约是文件，不是对话上下文 |
| A7 | **职责互斥的审计角色** | 审计者不组装、核对者不写作不清创、组装者不自审 | 不引入固定 Agent；吸收为 capability 约束：同一次 run 里生成与审计不能共享同一份未验证上下文，审计只读 |
| A8 | **项目内“翻车句库”和“锁定句白名单”** | `sandbox/prose-regressions.txt`、`locked-lines.txt`、`detect-battles.md` | 在项目对象文件树中增加两类只增不改的资产：作者确认过的坏句式 / 已确认保留的原句；检查器读取它们。写入走 PendingAction，不由 AI 自动追加 |
| A9 | **检测 / 修复的最小干预纪律** | `detect-loop`：每轮只修最高分片段、首末句锁定、等长微调、两轮无改善止损、达标锁版（SHA-256） | 只吸收通用纪律：局部 patch、保留作者锁定句、无改善即停、锁版靠 Git commit / blob id。**不接入任何外部检测平台打分** |
| A10 | **项目级文风蒸馏的版本留痕** | v4.14 style-distiller：LLM 蒸馏卡 + 案例提示词验收，`settings/style-profiles/` 与 `.style-versions/` | OAN 可用对象文件保存“风格档案”，每次蒸馏生成新版本并由人确认激活（与 StoryForge 参考分析的 active / ready 隔离同向）；不依赖 jieba 之类统计引擎 |
| A11 | **全局断点与幂等锚点沿用既有结论** | v4.10 以后的 partial、`.done` 标记（见 overview 历史快照） | 沿用旧 P0：typed partial artifact、source fingerprint、幂等 settlement receipt |

### P2：只作产品形态参考

| 编号 | 候选 | 备注 |
|---|---|---|
| A12 | **作者沟通用大白话**（`author-communication`）：面向作者的输出不泄漏内部词 | 可作为 OAN agent guide 的一条输出规范；用户可见文案仍需自行撰写 |
| A13 | **长短篇分轨**：短篇用独立项目骨架与独立去 AI 口径 | OAN 目前以长篇为主，若未来做短篇，应使用独立 capability 与风格包，不与长篇规则混用 |
| A14 | **短篇扫榜与拆文的“逐级降级并标注可信度”** | 数据来源三级降级，降级必须标注“未实时校验，只作候选假设”；可作为 reference 流程的诚实标注方式，但 OAN 不抓取榜单 |
| A15 | **单一 canonical 源 + adapter + drift test** | 沿用旧结论：仅在 OAN 真有多宿主格式时才采用 |
| A16 | **依赖缺失 fail-fast** | 沿用旧结论 |

## 不建议吸收的部分

- 固定的“1 + 7（长篇）+ 5（短篇）+ style-distiller”多 Agent 拓扑进入 `packages/runtime`。
- 用 prompt 声明实现工具白名单和状态所有权（包括 Codex TOML 里的 `developer_instructions` 文本约束）。
- “你全权写 / 别等确认”式的口头授权绕过 diff 审批，即便其现在是“单次有效”。
- updater 直接归档正文、更新设定并补偿回滚。
- `.agent/status.md`、order 文件作为小说事实源。
- 接入外部 AI 检测平台的分数作为质量目标，或围绕单一检测平台调校文风；检测平台适配器更不该进入 OAN 核心。
- 整块复制上游的词表、风格包、题材注册表、知识库、agent / skill 文本、README 文案。
- 把上游自述的“全绿”当作验证证据。

## 与 OAN 现有能力的关系

- OAN 已有 `ObservationLog / SettlementBundle`、PendingAction、ChangeMaterializer、Git diff approval，所以 A1–A4 实际上是在这些边界之内增加 **checker 工具与 finding schema**，工作量远小于重做写作流水线。
- 参考 `docs/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md`、`docs/WEBNOVEL_WRITER_REFERENCE_LESSONS.md` 与 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` 中已有的写作方法论条目，避免重复收录；新增条目应先对照这些文档去重。
- Play Mode 方面，本轮没有新增需要吸收的内容；既有“只呈现可观察言行”的结论不变。

## 建议合并到 OAN 写作参考笔记的最小条目

如果用户后续明确确认，建议只把以下写作相关条目追加到 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，每条标注来源 `[awesome-novel-skill]`：

- `[awesome-novel-skill]` 字数、段落形态、位置比例等可计算指标必须由代码实测，不让模型估算；检查器只报警，不自行改文。
- `[awesome-novel-skill]` 写作阶段只注入正向要点和最小禁令；去 AI 味放在草稿之后，先处理结构，再处理句子。
- `[awesome-novel-skill]` 写作规则冲突时按“作者设定与章纲 > 题材知识 > 结构默认值 > 检测优化”的顺序裁决，并把裁决结果留在上下文 trace 中。
- `[awesome-novel-skill]` 动笔前以章节契约固化“不可违反规则”，定稿后逐项核对兑现度，未兑现项附原文证据。
- `[awesome-novel-skill]` 项目级累积“已确认的坏句式”与“作者锁定句”，局部修复时保留首末句和锁定句，两轮无改善即停。

这些仍是候选内容。本文更新不会自动合并它们，也不会创建对应 task 或 plan。

## 主要证据路径

均位于 `reference-only/awesome-novel-skill/`：

- `VERSION`
- `docs/releasenotes/releasenote-4.17.0.md` … `releasenote-4.28.0.md`
- `tools/check-prose.py`
- `tools/check-chapter.py`
- `tools/style_common.py`、`tools/style_render.py`、`tools/style_verify.py`
- `tools/platforms.py`、`tools/test_platforms.py`
- `agents/style-distiller.md`
- `agents/short-agent.md`、`short-planner.md`、`short-writer.md`、`short-editor.md`、`short-verifier.md`
- `skills/anti-ai.md`、`skills/detect-loop.md`、`skills/style-distill.md`
- `skills/short-dispatch.md`、`short-plan.md`、`short-craft-prompt.md`、`short-audit.md`、`short-write.md`、`short-polish.md`、`short-verify.md`、`short-scan.md`、`short-analyze.md`
- `knowledge/anti-ai/structural-heat.md`、`living-voice.md`、`common-rules.md`
- `knowledge/format-specs/author-communication.md`、`distilled-style-spec.md`
- `LICENSE`、`LICENSE-DECLARATION.md`

本文只吸收设计与现状判断。OAN 的正式实现仍应以自身 task、plan、Object File Tree、AI SDK ToolSet、CandidateChangeSet、PendingAction 和 Git diff approval 为准。
