# 下一阶段功能规划

> 日期：2026-11-06
> 2026-11-09 进展：1390、1400 已交付。2026-11-10：1410 主要功能已交付（Needs Review），1420–1440 为 Planned。
> 代码基线：`1f5caec`。已有 60 个 Completed、4 个 Needs Review；本规划新增 1390–1440 六个 Planned task。
> 定位依据：[PROJECT_VISION](../PROJECT_VISION.md)。Play 与 Writing 同级，Play 优先；服务个人同人/综漫创作。
> 实施授权：用户已要求提交规划后按 1390 → 1440 顺序实现；以下分组作为交付检查点，不表示完成首组三项后停止。

## 1. 选择与顺序

下一阶段围绕三个作者问题交付：**长篇推演怎样继续保持记忆和可控消耗，拆出来的素材怎样方便地采用，已有推演与正文怎样转成可审阅的下一稿。** 冻结前缀、五维存档、VN、Forge、LINT、并行拆解和原文问答已有实现，不重新立项。

| 顺序 | Task | 作者获得的能力 | 真正新增的范围 | 优先级 / 相对规模 |
| --- | --- | --- | --- | --- |
| 1 | [1390 Play And Reference Usage Inspector](../tasks/1390.md) | 看懂这一轮为什么慢、用了哪些上下文、缓存是否有返回证据 | Play/Reference 专用入口、阶段关联、时间与预算/缓存解释；复用已有 usage 记录 | P0 / M |
| 2 | [1400 Play Phase Memory And Recall](../tasks/1400.md) | 长局接近窗口上限时主动整理，之后仍能查回早期关键事件 | 预算提醒、阶段目录、作者控制的整理与带证据历史回忆 | P0 / L |
| 3 | [1410 Reference Material Adoption Workbench](../tasks/1410.md) | 从大量拆书材料中挑出想要的角色/设定，并清楚处理目标冲突 | W3b 的搜索筛选、批次预检、目标重映射和采用记录 | P1 / M |
| 4 | [1420 Play To Chapter Writing Flow](../tasks/1420.md) | 选中一段推演，明确保留和改写要求，生成完整章节候选 | 连贯的转写向导与来源绑定；不重做既有 adoption/新章创建能力 | P1 / M–L |
| 5 | [1430 Evidence-backed Chapter Review Workbench](../tasks/1430.md) | 对照正文审阅问题，选择需要处理的项，再生成局部修订 | 结构化报告的生产接线、问题面板、作者裁决与范围保护 | P1 / M–L |
| 6 | [1440 Revision Impact Review](../tasks/1440.md) | 改过设定或旧章后，知道哪些记录确定失效、哪些章节可能需要复核 | 变更影响清单和显式修复入口；复用现有 freshness evaluator | P1 / M |

规模表示相对复杂度，不是工期承诺。1390、1410 可独立交付；1400 复用 1390 的预算解释，1420 与 1430 可独立于长篇记忆推进，1440 最后串联现有 freshness 与审稿入口。**第一轮控制在 1390、1400、1410**，用作者实际使用反馈决定第二轮顺序，不同时铺开六条实现线。

## 2. 先收口已有问题，不另建重复任务

- **1360 handoff 来源漂移**：进入 Play/Writing 前，不能用“仍包含角色名/标题”证明来源未变。对发生变化的正式文件，明确拒绝或让作者重新审阅当前来源并确认；已创建 Play session 的幂等重开应展示其冻结版本，需要更新时走既有 source-drift/rebase/fork 路径。该项仍由 1360 处理，是相关 handoff 改动的局部前置条件。
- **1360 真实模型质量/缓存验收**：在 1390 提供可解释数据后，由作者显式启动有调用上限的真实 provider 对照实验。固定前缀测试通过不等于测得缓存收益。
- **0580 / 1120 / 1230**：远端鉴权、设备断电、原生平台故障与安全离线 tombstone 清理继续单独追踪；不以这些外部条件阻塞无关产品功能，也不把它们改记为 Completed。
- **1110 G7 与 1220 W3b**：基础任务保持 Completed；明确未交付的产品增强分别交给 1390、1410，不回退历史交付状态。

## 3. 参考项目取舍与现状去重

下表把参考分析转为本轮选择。研究文档描述的是各自快照；其“当前 OAN 缺口”若与任务/代码冲突，以本仓库实现为准。

| 参考来源 | 已覆盖或需纠正的旧判断 | 本轮吸收 | 暂不采用 |
| --- | --- | --- | --- |
| [AINT](../research/AINT_REFERENCE_ANALYSIS.md) | 1360 已有冻结前缀、存档、VN；1120 已有互斥与恢复；1150/1170 已有回流写作 | 1390 调用/缓存解释，1400 阶段与历史证据，1420 转写体验 | 后台自动整理、原位覆盖历史、SQLite 事实源、执行外部模板；参考文中的费用/时延比例不作为 OAN 收益承诺 |
| [CicaTavern](../research/CICATAVERN_REFERENCE_ANALYSIS.md) | P0/P1 的 Forge、11 类 LINT、名册、VN、前缀与存档主要由 1360 覆盖 | 1400 把既有存档变成长局可理解的流程；1430 延续微创修订 | 重做同名模块、接入生图/TTS、复制词表或 prompt |
| [SillyTavern](../research/SILLYTAVERN_REFERENCE_LESSONS.md) / [概览](../research/SILLYTAVERN_REFERENCE_OVERVIEW.md) | 独立 Play、角色互动字段、Tavern 导入、steer、variant/checkpoint 已有对应实现 | 1390 可见来源，1400 分支内回忆，1420 作者选择后再采用 | 完整 WorldInfo/扩展生态、隐式 lore 注入、聊天直接成为正式事实 |
| [MuseAI](../research/MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md) | Guided Start、角色推演、Outcome/footprint 与分支路径已由 1130–1190 交付 | 1400 阶段连续性，1420 更顺畅的场景到章节旅程 | 七角色固定流水线、破坏式重试、跨设备平台 |
| [OpenTavern](../research/OPENTAVERN_PLAY_MODE_REFERENCE_ANALYSIS.md) | 主工作区、流式/Stop、上下文、HUD、adoption 不再缺失 | 1390 解释实际调用，1400 长历史使用体验 | 单文件应用、OPFS 事实源、公共角色卡抓取 |
| [StoryForge lessons](../research/STORYFORGE_REFERENCE_LESSONS.md) / [overview](../research/STORYFORGE_REFERENCE_OVERVIEW.md) | 候选/来源/章后整理/版本失效已有大量实现 | 1410 素材工作台，1430 报告到修订，1440 上游修改影响说明 | 五领域 Agent 团队、节点画布、第二套历史系统、产品线扩张 |
| [InkOS lessons](../research/INKOS_REFERENCE_LESSONS.md) / [overview](../research/INKOS_REFERENCE_OVERVIEW.md) | 受限结算、持久回执、来源新鲜度、旧稿导入已落地 | 1400 透明检索，1430 修订范围与起点，1440 下游复核 | 自动执行可恢复写入、默认多轮修稿、daemon、并行作品库 |
| [Eve](../research/EVE_REFERENCE_ANALYSIS.md) | manifest/diagnostics、entry selector、trust boundary、usage 基础已覆盖 | 1390 Inspector，六项任务均用真实产品入口的分层验收 | 引入框架、通用 compiler/scheduler/channels、subagent runtime |
| [awesome-novel-skill lessons](../research/AWESOME_NOVEL_SKILL_REFERENCE_LESSONS.md) / [overview](../research/AWESOME_NOVEL_SKILL_REFERENCE_OVERVIEW.md) | LINT、写前契约、去 AI 味保护已有基础 | 1430 确定性检查与文学意见分层、保留作者选择 | 外部 AI 检测器分数、固定字数/句长美学、自动清创、多 Agent 拓扑 |
| [其他写作 Skill 横向分析](../research/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md) | ChapterContract、ContextPackage、ReviewFinding 等不应重复创建 | 1430 规则来源/冲突与轻量审稿；普通单章不增加繁重关卡 | 将规划字段强制映射为正文句式、Skill 扩权或安装脚本 |
| [oh-story-claudecode](../research/OH_STORY_CLAUDECODE_REFERENCE_OVERVIEW.md) | source hash、projection、原作/角色认知边界已有实现 | 1390 上下文体积回归，1430 契约不规定 prose shape，1440 来源证据 | 单 JSON authority、固定七角色编排、多宿主平台层 |
| [Webnovel Writer lessons](../research/WEBNOVEL_WRITER_REFERENCE_LESSONS.md) / [overview](../research/WEBNOVEL_WRITER_REFERENCE_OVERVIEW.md) | 规划、整理、健康面板和 reference 隔离已有基础 | 1430 issue schema/维度覆盖，1420 轻量转写意图 | 商业/连载指标、每章强制三段 gate、评分驱动自动改稿 |
| [NovelBot / StoryWriter](../research/NOVEL_BOT_STORYWRITER_REFERENCE_OVERVIEW.md) | 文件记忆、小工具循环、规划与写后整理已覆盖 | 作为所有新任务保持简单的约束，不新增一套功能 | 自动长篇生产、多 Agent 数据集生成、无审批写入 |
| [OAN 写作指引来源汇编](../research/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md) | 多处 “not implemented” 是历史状态，已被 1000–1380 覆盖 | 只作来源追溯，按当前 task/代码选择净增量 | 把历史候选表直接转为待办清单 |

## 4. 六项功能的产品边界

### 1390 用量与上下文检查器

作者在当前 Play 回合或 Reference run 内打开检查器，即可看到本次调用的模型、输入/输出 token、provider 返回的缓存字段、可解释的阶段与来源。现有 `agent-usage`、G7 JSONL 与 context trace 是输入，不新建遥测平台。

补齐 run/turn/unit 对应关系、开始/结束及首包时间；区分模型首包和 UI 首段可见时间，避免把 settlement 隔离等待算成 provider 首字延迟。缺失 usage 显示 unavailable，估算与实际分开。费用换算不是首版范围；任何后续价格都须有作者明确配置的来源与版本。

先衡量，再决定是否调整缓存布局。不得照抄参考项目的固定断点数、SDK 参数、thinking signature 处理或宣称节省某个百分比；供应商适配需按实施时官方协议与当前 SDK 验证。

### 1400 长篇 Play 阶段整理与回忆

复用五维存档，增加“当前阶段用了多少窗口、哪些历史已收起、何时建议整理”的解释。阈值只产生提醒；生成存档与开启新阶段都由作者显式操作。阶段整理失败、取消或来源漂移不能推进当前分支。

首版针对 v4 Immersive Journey；v5 保留现有 Scene Memory/windowing，不误用 v4 archive。最近至少两轮完整原文、当前状态/资源/到期事件保持 protected；放不下时明确报告，不按字符硬截断。

增加只读历史回忆：宿主从作者选择阶段与确定性检索结果构造有界、固定的内存窗口；结果带 session、selected head、turn/message id、quote/hash 和可见性。模型不能动态打开内部主机路径，也不能搜索未选兄弟分支。历史状态明确标为“当时”，不能覆盖当前资源与已确认状态。更大检索范围需新的显式请求。

阶段目录是现有 session/compaction metadata 的派生读模型；原始图与归档仍保留，不增加一个可自由写入的隐藏记忆事实库。详细条件见 1400。

### 1410 参考材料采纳工作台

现有入口已能分组、多选并给默认目标。本轮补大量条目的搜索、置信度/警告筛选、折叠与批次预检；目标重复、既有对象、失效材料在调用生成前解释清楚，作者可重映射或移除条目。

每次生成仍只采用一份 reference，复用 `reference.adopt` 的完整文件候选、prepared preview 和 PendingAction。综漫材料可依次从多份来源采用，但本轮不做跨 reference 自动合并或同名角色自动认定。采用记录从 origin、receipt 与 Git 派生，不成为另一份 canonical 材料库。

### 1420 从推演到完整章节

1150 的 Writing Reference、1170 的章节 adoption（含创建章节）、1330 的自动下一章目标都已存在。新功能是把这些能力组成一个清楚的转写旅程：选择当前分支素材 → 指定保留事件/可改表达/POV/篇幅方向 → 查看唯一章节目标 → 生成正文候选 → diff/Accept → 提示整理本章。

它不是把 transcript 整段复制为正文，也不要求先把所有 Play 状态写进正式小说。默认只生成一章，不自动继续写、整理或 Accept。未选素材、隐藏 Player 信息和兄弟分支不得被顺手带入。

转写输入绑定 selected branch、附件/报告、来源 hash、目标 baseline；proposal 与 Accept 都重验，重启后仍有效。沿用唯一 ChangeSet/materializer 链路；若现有 origin 不足以表达新的输入闭包，先扩展该生产者的严格合同与测试，不另造写入引擎。

### 1430 审稿问题到局部修订

`ReviewFinding`、维度清单和 `/审稿` 已存在，Novel LINT 已有局部建议入口。本轮把一般章节审稿接成可恢复的结构化报告与专用面板：逐项定位正文/事实依据、显示已检查/有问题/未检查，作者选择处理、保留或待定，再生成限定范围的章节候选。

可计算的字数等由代码给出；文学意见保持 advisory，不用总分决定是否改稿。一般审稿不自动结算、不默认调用第二轮模型修稿。选中某条问题不代表批准最终文字，仍须审阅 PendingAction。

报告绑定固定正文与依据版本；修改正文后不能用旧位置继续修订。范围外字节必须保持，若解决问题需要扩大范围，先让作者重新选择。长期“锁定句库/文风档案”留待候选池，不在这里引入新事实域。

### 1440 修改影响分析

1290/0700 已能判断章/卷/全书摘要的新鲜度；本轮把它扩为作者可操作的影响清单。变更来源可来自刚接受的候选，或作者显式比较的 Git/工作区版本。

严格区分三类关系：有 source hash 的确定性派生依赖、生成时实际读取过的来源、仅由名称/词项命中的可能相关。后两类不能伪装成已经证明的剧情因果；缺少历史证据时显示覆盖不足，而不是“没有影响”。

清单提供打开文件、重新审稿、整理指定章节/摘要等显式入口；每项修复仍经过现有 workflow 和审批。不会因为正文删去一句话就自动撤回已接受的全局事实，也不会批量改写后续章节。

## 5. 交付分组与验证

| 交付组 | 进入条件 | 必须走通的作者旅程 | 离开条件 |
| --- | --- | --- | --- |
| A：1390 + 1400 | 已有 Play/usage/compaction 生产链 | 长局查看预算 → 主动归档 → 新阶段继续 → 查回早期证据 | 50/200/1000 回合合成 fixture 的预算、分支、重启回归；未知预算/缺证据有明确说明；文学质量另行实测 |
| B：1410 | 已发布 current Story Material | 大量条目筛选 → 处理目标冲突 → 预览 → Accept → 选中已采用角色开局 | 多目标与 source/target drift、取消、重启、重复操作回归；未选原文不进入采用模型 |
| C：1420 + 1430 + 1440 | 相关 handoff 来源边界已明确 | 选 Play 素材 → 写一章 → 选择审稿问题 → 局部修订 → 查看影响 → 显式整理 | canonical 写入统一审批，选中范围/输入 hash 可追溯，迟到响应与旧报告不能覆盖当前工作区 |

三个交付组可分开发布。每个 task 都要覆盖 Core/Agent（涉及模型时）/Backend/Client/Desktop 的实际入口，测试放在根目录 `__test__/<module>`；不能以 helper 完成或总测试数替代产品旅程。

真实 provider 评测由作者选择模型、样例和调用上限后启动，记录缺失字段与失败。mock 用于协议/存储回归，不能证明文学质量、真实缓存命中率或实际账单。性能优化保留相同 fixture 的前后对比，不预承诺参考项目报告中的收益数字。

## 6. 候选池与明确暂缓

| 候选 | 何时再立项 | 边界 |
| --- | --- | --- |
| 独立“补充行动建议”与带要求 Retry | 作者频繁需要更多行动或对重演提出具体要求 | 复用 `suggestedActions` 与 immutable variant；不新建终结工具协议，不原位覆盖旧回合 |
| 结构化 VN 叙事/场景协议 | 现有说话人推断和场景切换在实际故事中持续误判 | 有限 typed AST、纯文本回退、冻结舞台；保留 settlement 隔离，不把任意 HTML 当 UI，不承诺提前释放未经校验的正文 |
| 作者文风档案、保留句与规则豁免 | 1430 的实际使用证明跨报告偏好需要持久化 | 可读文件、来源与版本、作者审批；只用闭集配置，不开放任意脚本/无限正则 |
| AINT / 世界剧本的文本导入 | 有具体本地作品包与字段映射样本 | 只读解析白名单资料；不执行 Liquid、脚本或插件；正式对象仍 preview/Accept，不做通用兼容运行时 |
| PDF/EPUB/DOCX 等导入与更多导出 | 当前 Markdown/TXT 限制确实阻碍素材准备 | 独立 adapter 与 source fingerprint，不扩展成联网抓书或 OCR 平台 |
| 参考版本比较/回滚面板、跨 reference 技法比较 | 多版本或多作品对照使用足够频繁 | Git/accepted bundle 为权威；不另造作品版本数据库 |
| Provider 协议失败的定向修正 | 收集到可重现的 native-tool/history 错误样本 | 可见、有界、按 SDK/官方协议验证；不伪造 thinking signature，不隐藏无限重试 |

2026-11-12 更新：“PDF/EPUB/DOCX 等导入”（仅导入部分）与“参考版本比较/回滚面板、跨 reference 技法比较”已立项为 [1570](../tasks/1570.md)、[1550](../tasks/1550.md)、[1560](../tasks/1560.md)，连同 1410 留下的跨 reference 人物合并，见 [综漫多来源素材规划](CROSSOVER_SOURCE_MATERIAL_PLAN_2026-11-12.md)。“独立补充行动建议与带要求 Retry”已由 1450 交付。其余候选仍在池中。

同日另有两项与本节原有边界不同的作者决定：“结构化 VN 叙事/场景协议”以较轻的行内标注形式立项为 [1610](../tasks/1610.md)，并由 [1620](../tasks/1620.md) 在舞台模式有意放宽“不提前释放未经校验的正文”，见 [Play 角色对话 GalGame 化规划](PLAY_GALGAME_PRESENTATION_PLAN_2026-11-12.md)；生图作为独立的素材准备模块立项为 1630–1650，见 [角色立绘生图模块规划](PORTRAIT_IMAGE_GENERATION_PLAN_2026-11-12.md)，Play 运行中仍不调用生图，TTS 仍不做。

Extension/dynamic Tool 注册继续暂缓。生图、TTS、LAN/移动端/跨设备同步、社区和市场、商业/连载运营、通用 DAG/多 Agent、后台自动写作均不进入本轮六项范围。Play 可以独立用于游玩与探索，回流 Writing 始终可选。

## 7. 实施约束

- 任务入口是 1390–1440，实施前对照本计划与现有 task；需要改变稳定合同的字段/来源，先明确合同与验收，不把候选设计写成已实现事实。
- 模型只读/编辑宿主授予的固定投影；新只读检索不会获得主机 filesystem、网络或内部 artifact 任意路径访问。
- canonical 仍只有 CandidateChangeSet → PendingAction → Human Accept → ChangeMaterializer → Git 一条写入路径。关闭 auto commit 时不自动 commit/sync。
- 不新增数据库事实源、第二套 runtime、全局工作流框架或可执行模板系统；可以增加有界、可重建的 projection 和严格的领域 schema。
- 只吸收参考项目的产品模式与约束；代码、prompt、规则词表和素材独立编写，沿用仓库 reference no-copy 边界。
