# Live Visual Novel (live-visual-novel) 参考项目深度分析与吸收建议

> **分析对象**：`reference-only/live-visual-novel` (基于 TypeScript / Node.js 22 / pnpm 12 / Vite 6 / React 18 / Turborepo 的开源实时 AI 视觉小说引擎)  
> **对标项目**：`oh-awesome-novel` (OAN - Filesystem-first 个人同人/综漫创作工作台，Play 推演 + Writing 写作双核心)  
> **分析方式**：本地全景静态逆向与代码审计，覆盖全部 5 个核心子包 (`packages/*`)、协议与类型定义 (`packages/shared/*`)、演出与显示泵内核 (`packages/engine/*`)、总导演/编剧流式生成 (`packages/director/*`)、语音合成桥接 (`packages/tts-bridge/*`)、前端装配与界面 (`packages/app/*`)、内容同步/生图抠图/无头端到端测试工具 (`tools/*`) 及示例内容包 (`content/`、`docs/dawn/`)；全过程未调用任何外部付费 API。  
> **法律与版权边界**：本报告仅用于架构研究、推演系统设计参考及技术方案推演。严禁复制参考项目的私有提示词文本、示例作品版权内容或美术音频素材。  
> **分析日期**：2026-11-10  

---

## 目录

1. [执行摘要 (Executive Summary)](#1-执行摘要-executive-summary)
2. [项目全貌与核心特征](#2-项目全貌与核心特征)
   - [2.1 项目定位与设计哲学](#21-项目定位与设计哲学)
   - [2.2 六边形架构与严格的单向依赖矩阵](#22-六边形架构与严格的单向依赖矩阵)
   - [2.3 内容包 (ContentPack) 规范与素材信任边界](#23-内容包-contentpack-规范与素材信任边界)
3. [六大核心技术机制深度剖析与代码级证据](#3-六大核心技术机制深度剖析与代码级证据)
   - [3.1 幕制两级流式编排与“Choice 硬切”机制 (Act/Beat Two-Tier & Choice Hard Cut)](#31-幕制两级流式编排与choice-硬切机制-actbeat-two-tier--choice-hard-cut)
   - [3.2 演出与生成彻底解耦的“显示泵” (Decoupled Display Pump & Two-Stage Typewriter)](#32-演出与生成彻底解耦的显示泵-decoupled-display-pump--two-stage-typewriter)
   - [3.3 GPT-SoVITS 深度 2 预取流水线与零热切架构 (Zero-Wait Voice Pipeline & Single-Weight Multi-Ref)](#33-gpt-sovits-深度-2-预取流水线与零热切架构-zero-wait-voice-pipeline--single-weight-multi-ref)
   - [3.4 稳健流式 NDJSON 容错与 Tier-2 窥视解析器 (ScriptStreamParser & Tier-2 Peek)](#34-稳健流式-ndjson-容错与-tier-2-窥视解析器-scriptstreamparser--tier-2-peek)
   - [3.5 三段式推演状态机与全状态断点续写 (Three-Stage State Machine & Resumable Saves)](#35-三段式推演状态机与全状态断点续写-three-stage-state-machine--resumable-saves)
   - [3.6 异步字幕翻译预取泵与多语言隔离 (Asynchronous Subtitle Translation Pump)](#36-异步字幕翻译预取泵与多语言隔离-asynchronous-subtitle-translation-pump)
4. [与 OAN 的全面对标与吸收边界](#4-与-oan-的全面对标与吸收边界)
   - [4.1 核心机制与架构对比矩阵](#41-核心机制与架构对比矩阵)
   - [4.2 核心理念的契合点与互补性](#42-核心理念的契合点与互补性)
   - [4.3 边界辨析：OAN 不应照搬的部分](#43-边界辨析oan-不应照搬的部分)
5. [吸收建议与分阶段落地路线图](#5-吸收建议与分阶段落地路线图)
   - [5.1 P0 级：Play 模式视觉小说显示泵与选项硬切 (解决沉浸感与模型跑飞痛点)](#51-p0-级play-模式视觉小说显示泵与选项硬切-解决沉浸感与模型跑飞痛点)
   - [5.2 P1 级：本地多角色语音流水线与深度预取调度 (Play 模式多模态升级)](#52-p1-级本地多角色语音流水线与深度预取调度-play-模式多模态升级)
   - [5.3 P2 级：角色立绘绿幕生图与自动抠图工具链 (创作者素材赋能)](#53-p2-级角色立绘绿幕生图与自动抠图工具链-创作者素材赋能)
6. [在 OAN 中的具体工程落地指南](#6-在-oan-中的具体工程落地指南)
7. [结语](#7-结语)

---

## 1. 执行摘要 (Executive Summary)

`live-visual-novel` (简称 **LVN**) 是一款专注于 **“AI 实时生成剧情、台词与配音”** 的现代化视觉小说 (Galgame) 引擎。该项目通过精密的分层解耦工程，成功攻克了 AI 互动叙事领域中最棘手的两难困境：**“一次性生成整篇导致失去即时交互性”** 与 **“每句调用一次模型导致时延与 Token 成本雪崩”**。

其核心创新在于建立了 **“幕制/拍制两级编排 (Act/Beat Streaming)”**，并配合以 **“Choice 选项硬切”**、**“演出与生成解耦的显示泵 (Display Pump)”** 以及 **“深度为 2 的 GPT-SoVITS 语音预取流水线”**。

对比 `oh-awesome-novel` (OAN) 当前的系统现状：
- OAN 已经确立了健全的工程根基：`Filesystem-first` 架构、基于 Git diff 的人类审批工作流 (`Sandbox Change Engine`)、Play 与 Writing 双核心并列的顶级产品架构，以及已初步落地的视觉小说舞台视窗 (`VisualNovelStage.vue` / [PLAY_LOCAL_SCENERY.md](../PLAY_LOCAL_SCENERY.md)) 与回合候选项协议 ([1520](../tasks/1520.md))。
- 然而，OAN 当前的 Play 模式在呈现层与生成层之间仍偏向传统的大模型回合对话思维：大模型流式输出直接冲刷界面，缺乏**恒速打字机与节奏控制**；当大模型生成带有选项的剧情时，容易在选项后继续“自问自答”或产生幻觉输出；多模态体验中尚未建立成熟的**本地低时延语音合成与分角色调度管道**；在素材准备上，缺乏从概念生图到透明立绘的标准化工具链。

**核心结论：**  
`live-visual-novel` 为 OAN 的 Play 模式（尤其是 Visual Novel 视角、长局沉浸式推演与多模态角色卡体验）提供了**极高价值的工程参考实现**。其**显示泵状态机**、**选项行硬截断保护**、**多角色单一底模免热切语音流水线**以及**内容包校验与素材衍生工具链**，能够无缝融合进 OAN 的现有技术栈中，大幅提升同人/综漫推演的“沉浸感”与“可玩度”。

---

## 2. 项目全貌与核心特征

### 2.1 项目定位与设计哲学

LVN 的定位非常纯粹：**将大语言模型与语音合成引擎，转化为一台如同经典 Galgame 般细腻运转的互动叙事舞台**。它拒绝简单把 LLM 对话框换皮成 Galgame，而是围绕“玩家在读文本时的心理节奏”来重塑整套生成与呈现系统：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Live Visual Novel 核心管线                       │
├───────────────────┬───────────────────┬────────────────────────────────┤
│   导演 / 编剧两级   │     显示队列泵    │        语音预取流水线          │
│   (Act Streaming) │   (Display Pump)  │      (Voice Pipeline)          │
│ • 总导演规划宏观幕 │ • 提交与显示强解耦 │ • 深度 2 提前异步合成          │
│ • 编剧整幕 NDJSON │ • 恒速两段打字机   │ • 单套权重 + 每角色 ref 差分   │
│ • Choice 立即硬切 │ • 取消代际安全隔离 │ • Fast 瞬断 / 主角静音 / 闪避  │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

1. **按“幕”生成，按“句”呈现**：既不是一次生成全篇，也不是每句话请求一次 API。大模型以一次流式连接生成一整幕（10~30 行台词），在遇到分支选项瞬间截断；而前端演出层则以毫秒级时钟严格按玩家点击或自动播放节奏逐句、逐字展现。
2. **状态与演出彻底分离**：模型输出的事件提交 (`commitModel`) 只负责推进逻辑状态账本 (`Ledger`) 与推入显示队列，绝不直接操控 DOM 或阻塞等待渲染；演出层只作为单向订阅者，从队列中提取事件进行打字机渲染和立绘差分。
3. **低成本本地语音连续播放**：借助本机部署的 GPT-SoVITS，以单句 RTF 0.59 的性能余量，利用后台深度为 2 的预取队列，在玩家阅读上一句对白时即已在后台无缝合成下两句语音，做到“零等待连续演出”。

### 2.2 六边形架构与严格的单向依赖矩阵

LVN 采用了标准的六边形（端口与适配器）架构，并通过 CI 中的 `dependency-cruiser` 建立了机器可检验的单向依赖约束：

```text
[L3 组合根与壳]
packages/app (React UI, bootstrap.ts 装配单例)
   │
   ├───► [L1 核心业务: 演出内核] ───► [L0 协议与契约]
   │     packages/engine/src/core        packages/shared
   │     (EngineCore, BeatRunner)        (ScriptEvent, Ports, Zod Schemas)
   │                                             ▲
   ├───► [L1 核心业务: 剧情生成] ────────────────┤
   │     packages/director/src/director          │
   │     (DirectorService, WriterService)        │
   │                                             │
   └───► [L2 适配器实现] ────────────────────────┘
         engine/presentation (DomStagePort)
         director/llm (DeepseekClient SSE)
         packages/tts-bridge (GptSovitsProvider)
```

- **L0 协议层 (`packages/shared`)**：仅依赖 `zod`，禁止引用任何浏览器 DOM API、Node.js 内置库或第三方网络库。定义了跨层唯一的领域协议：`ScriptEvent`、`ModelScriptEvent`、`ActPlan`、`ContentPack` 及各项端口接口 (`EventBus`、`ContentPort`、`VoiceSynthPort`、`StagePort`)。
- **L1 核心业务层 (`packages/director` 与 `packages/engine/src/core`)**：纯 TypeScript 业务逻辑，不含任何特定框架依赖。换掉 React、PixiJS、DeepSeek 或 GPT-SoVITS 中的任何一项，L1 核心代码一行不需要修改。
- **L2 适配层**：具体平台与第三方服务的落地实现，如 `DomStagePort`（DOM 舞台）、`DeepseekClient`（手写 100 行轻量 SSE 客户端）、`GptSovitsProvider`（调用本地 9880 端口）、`LocalStorageAdapter`。
- **L3 组合根 (`packages/app`)**：唯一被允许引用所有下层包的组合层。`packages/app/src/bootstrap.ts` 是整套系统的装配单例所在地，负责解析内容包、解锁 Web AudioContext、连接各层端口并启动主推演循环。

### 2.3 内容包 (ContentPack) 规范与素材信任边界

LVN 的内容组织极为规整，天然遵循类似 OAN 的 Filesystem-first 思路：

```text
content-local/ (或内置占位 content/)
├── assets-map.json             # 语音音色 ref 映射、BGM 与素材声明
├── characters/<charId>/        # 角色文件夹 (ID 仅限 [a-z0-9_-])
│   ├── card.md                 # 角色卡: YAML frontmatter + 性格设定正文
│   ├── 平常.png                 # 表情立绘: 文件名即表情名 (emotion tag)
│   ├── 微笑.png
│   └── 害羞.png
├── scenes/                     # 16:9 场景背景图 (e.g. 店内.jpg)
├── bgm/                        # 背景音乐 (可选 mp3)
└── story/
    ├── outline.md              # 剧情大纲: 一行一拍 (- 序章: 命运的相遇)
    └── worldbook.md            # 世界书: ## 标题 + keys: / priority: + 正文
```

**工程红线与合规边界**：
- 仓库代码遵守 MIT 协议；原始商业或三方素材全部放入 `.gitignore` 排除的 `assets/` 与 `content-local/` 中，仓库仅保留纯文本占位包 `content/`。
- 角色卡内通过 `defaultExpr` 指定初始立绘，未配立绘的角色（如男主角）标记为 `(no sprite)`，系统自动将其判定为主角/旁白视角，表情不校验、不展示立绘、不触发语音，严格遵循合规边界。

---

## 3. 六大核心技术机制深度剖析与代码级证据

### 3.1 幕制两级流式编排与“Choice 硬切”机制 (Act/Beat Two-Tier & Choice Hard Cut)

#### 痛点与破局
在传统的大模型互动小说中，如果一次性生成整段故事，玩家无法在关键情节做选择；如果一句话调用一次大模型，不仅首字等待延迟极高，而且每轮重复发送历史上下文会导致 Token 费用暴增数百倍。

LVN 创造性地实施了 **“幕制 (Act Plan) 两级编排 + 流式 Choice 硬切”**：

```text
[阶段 1: 总导演 planAct]
每幕调用 1 次 (非流式 JSON, ~2.5k in / 400 out)
输出: ActPlan { scene: {bg, bgm, cast}, actGoal, beats: [{goal, endsWith, maxLines}, ...] }
                        │
                        ▼
[阶段 2: 编剧 generateBeat]
以整幕为单位发起单次 SSE 流式长写 (~5k in / 2k out)
逐行产出: say / narrate / stage / choice
                        │
       ┌────────────────┴────────────────┐
       ▼                                 ▼
普通 say / narrate 行             一旦解析出 choice 选项行
逐行提交至显示泵                   ① 提交 choice 至 Ledger
继续流式输出                      ② 触发 ctrl.abort() 立即掐断底层 Fetch 连接!
                                  ③ 丢弃模型在 choice 之后已生成的一切文字
                                  ④ 引擎停等玩家选择
                                         │
                                         ▼
                                  [阶段 3: 续写 Continuation]
                                  携带玩家的选择与本幕已提交的 ledgerTail
                                  再次调用编剧，续写本幕剩余 beats 直至 sceneEnd
```

#### 代码级证据

1. **Choice 硬切的确定性中断** (`packages/director/src/director/writer.ts` lines 140–155)：
   ```typescript
   for (const ev of parser.push(delta)) {
     if (ev.t === "say" || ev.t === "narrate") lineCount++;
     else if (ev.t === "choice") sawChoice = true;
     committedEvents.push(ev);
     yield { kind: "commit", event: ev };
     if (ev.t === "choice") {
       // choice 硬切: 其后内容依赖玩家选择，确定性终止底层生成并丢弃
       cutByChoice = true;
       stop = true;
       ctrl.abort(); // 掐断 fetch
       break;
     }
   }
   ```
2. **选择后的增量续写与防重入** (`packages/engine/src/core/BeatRunner.ts` lines 346–360)：
   ```typescript
   // choice 段收束: 等泵到达选项并等玩家选择 → 续写本幕剩余小节 (不结束幕)
   if (done?.result === "choice" && sawChoice) {
     if (choiceContinues >= 2) return "beatEnd";
     choiceContinues++;
     bus.emit("generation:status", { phase: "choicing", turnNo });
     await engine.whenIdle(abort.signal); // 等待玩家在 UI 上点选
     const label = this.#lastChoiceLabel() ?? "?";
     continuation = {
       reason: `The player chose "${label}". Continue after the choice and finish the remaining beats of this act up to the sceneEnd closing`,
       count: disruptions + choiceContinues,
     };
     bus.emit("generation:status", { phase: "writing", turnNo });
     continue; // 带着 continuation 再次进入本幕编剧循环
   }
   ```
3. **两级预算防御放大机制** (`writer.ts` lines 84–88)：
   外部 `BeatRunner` 每次由于中断或选项再入时，均显式递增 `count`。`WriterService` 内部判断：一旦 `internalContinuation = req.continuation?.count >= 1`，则内部自动纠错预算直接清零，不再允许内部二次续写，直接把收束责任交回顶层，彻底杜绝了大模型错误时重试放大带来的无限调用死循环。

---

### 3.2 演出与生成彻底解耦的“显示泵” (Decoupled Display Pump & Two-Stage Typewriter)

#### 架构解耦思想
在很多 Web 版视觉小说或聊天界面中，界面展示直接受制于大模型 SSE `delta` 到达的节奏。网络拥堵时文字卡顿，大模型吐字飞快时界面瞬间刷屏，玩家阅读体验极差。

LVN 设计了专门的 **`DisplayPump`（显示泵）**。`commitModel` 瞬间只做三件事：为事件分配单调递增的 `lineId` (`turnNo.seq`)、将事实入账到全局逻辑账本 `Ledger`、将条目推入内存队列 `#queue`。随后的呈现完全由独立的微任务循环接管：

```text
大模型 SSE 增量 ──► parser ──► commitModel()
                                    │
                                    ├──► 写入逻辑账本 Ledger (持久化与快照事实)
                                    └──► 推入显示队列 #queue
                                              │
                                              ▼
                             ┌─────────────────────────────────┐
                             │       显示泵循环 (#pump)         │
                             └─────────────────────────────────┘
                                              │
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
               kind === "line"         kind === "stage"        kind === "choice"
            ① 更新说话人与立绘表情     直接应用舞台效果        挂起显示泵
            ② 驱动 Typewriter 逐字     (换背景/切BGM/震屏)     弹出 ChoiceOverlay
            ③ 挂起等待玩家手势/时钟                            等待用户点击选项
```

#### 两段式打字推进 (Two-Stage Advance)
为了复刻经典 Galgame 的推进手感，`EngineCore` 在 `advance()` 中设计了精准的“两段式”操作逻辑 (`packages/engine/src/core/EngineCore.ts`)：
- **第一击（打字中点击）**：立即命令打字机瞬间补完全文，文本停止闪烁并完整上屏，但**依然停留在当前行**，给玩家留下阅读时间。
- **第二击（打字完毕后点击）**：放行当前行，驱动显示泵提取下一行。
- **快速双击（连点）**：打字机瞬间补全的同时，直接放行进入下一行，绝不吞掉玩家的连点输入。
- **取消代际 (`#epoch`)**：在玩家读档或重新开局时，引擎自增 `#epoch`，一切处于等待状态的旧泵会立即感知代际过期并平稳退出，彻底避免了异步回调悬挂与内存泄漏。

---

### 3.3 GPT-SoVITS 深度 2 预取流水线与零热切架构 (Zero-Wait Voice Pipeline & Single-Weight Multi-Ref)

#### 实测性能与 RTF 流水线不变量
根据项目实测数据 (`docs/p0-tts-findings.md`)，在中端笔记本显卡（NVIDIA 8GB 显存，锁频 2400MHz）环境下，GPT-SoVITS v2 base 预训练权重的实时率 (**RTF, Real-Time Factor**) 稳定在 **0.59** 左右（即合成 5.4 秒的音频仅需约 3.2 秒）。

由于 $RTF < 1$，LVN 得出了关键的工程不变量：**只要预取领先播放 1 句以上，玩家在游玩过程中就不会感知到任何语音加载停顿**。

```text
时间轴 (秒)
0s        3.2s           6.4s           9.6s          12.8s
├──────────┼──────────────┼──────────────┼──────────────┼─────────►
[LLM 生成整幕台词]
Line 1 ──► [TTS 合成 L1]
           [Play L1 播报 5.4s] ──────────────────────────┐
           [TTS 预取 L2 (3.2s)] ──► [TTS 预取 L3 (3.2s)] │
                                                         ▼
                                                Line 1 播完瞬间
                                                Line 2 早已就绪，立刻无缝起播！
```

#### 零热切 (Zero Hot-Swapping) 架构
LVN 在代码审计中发现，GPT-SoVITS 运行时如果通过 HTTP API 调用 `set_sovits_weights` 或 `set_gpt_weights` 切换模型权重，每次切换需耗费 4.4~5.0 秒，这在句间对白中是绝对不可接受的。

因此，LVN 确定了极具启发性的架构决策：
1. **单套底模 + 差异化 `ref_audio`**：所有女性角色在运行时共享同一份 v2 base 预训练权重。音色、音调与情感色彩完全由每个角色配置的 5 秒参考音频 (`ref_audio_path` + `prompt_text`) 决定。在切换角色时，仅仅在请求 JSON 中变更参数，**服务端运行时权重零切换，耗时为 0**。
2. **深度为 2 的预取队列 (`PREFETCH_AHEAD = 2`)**：在 `VoicePipeline.ts` 中，当第 $i$ 句触发展示时，流水线会从预知已提交但尚未显示的 `future` 队列中提取接下来 2 句角色台词，在后台发起异步合成并缓存到 `PrebuiltEntry`。
3. **独立取消令牌 (`AbortController`)**：每条预取任务拥有独立的取消控制器。当玩家快速翻页（新台词顶掉旧台词）时，只打断当前在播的旧音频，**绝不杀死预取队列中的未来音频**，防止缓存被错误标记为 rejected 而导致下一句出现哑音。
4. **快进即静音**：在按住 Ctrl 或处于 Fast 模式时，立即停止当前播放并清空预取请求，避免在高速快进时击穿 GPU 队列。

---

### 3.4 稳健流式 NDJSON 容错与 Tier-2 窥视解析器 (ScriptStreamParser & Tier-2 Peek)

由于大语言模型在长流式输出中容易出现 Markdown 代码围栏、首行多余开场白或 JSON 字符串内未转义的换行，`packages/director/src/stream/ScriptStreamParser.ts` 实现了极其严密的容错机制：

1. **结构括号平衡法 (`braceBalance`)**：
   当某一行 JSON 解析失败且大括号尚未闭合时，解析器进入 `repairing` 状态，暂存缓冲区并持续吞入后续换行，直至括号计数归零再进行整体反序列化，完美兼容模型在台词中偶发直接打回车的行为。
2. **Markdown 围栏与开场白自动跳过**：
   在收到第一个以 `{` 开头的行之前，解析器会自动静默忽略开场的 ```json 围栏或模型客套话。
3. **Tier-2 窥视解析 (`peekPartialText`)**：
   在某个长句子仍在流式传输、尚未收到结尾换行符与 `}` 时，解析器通过正则 `/"text"\s*:\s*"((?:[^"\\]|\\.)*)/` 进行字段预扫描。提取出的半截文本会作为 `preview` 事件抛出，仅用于提前喂给前端打字机进行毫秒级视觉预显示，**绝不提前落盘、绝不修改游戏状态、绝不喂给 TTS**。
4. **坏行计数与自动中止**：
   单个校验失败的坏行会被跳过；若连续出现 3 行损坏，解析器立即抛出 `ParserAbortedError`，触发上层通过带有 `[CONTINUATION]` 标记的方式将已确认行回传并请求模型从断点续写。

---

### 3.5 三段式推演状态机与全状态断点续写 (Three-Stage State Machine & Resumable Saves)

#### 推进阶段机
LVN 没有采用复杂的开放世界模拟，而是围绕 Galgame 的核心爽点实现了三段式阶段推进 (`BeatRunner.ts`)：
- **阶段一：共通线 (Common Route)**：所有可攻略角色初始好感度均低于门槛值（`LINE_ENTER_MIN = 15`），大纲按骨架正常推进。
- **阶段二：个人线 (Heroine Route)**：一旦某个角色好感度达标，系统自动锁定该角色线，记录进入时的幕数 `routeSince`。
- **阶段三：终幕 (Finale Act)**：当个人线内推进幕数达到设定值（`FINALE_ROUTE_ACTS = 4`），下一幕总导演强制标记 `[FINAL ACT]`，并在幕收束后将整个引擎置于 `ending` 终局相位。

#### 幕中存档与可续恢复 (Mid-Act Resumption)
LVN 的存档系统不仅保存了全局快照，还保存了当前正在执行中的幕设计（`currentAct: ActPlan`）。  
如果玩家在一幕中间（例如面对选项时、甚至在一段对白播放途中）执行保存，读档时系统直接将 `currentAct` 恢复至 `BeatRunner.#resumeAct`，**跳过总导演 planAct 阶段，直接进入同幕编剧续写**，确保了完全无缝的剧情接续，且绝对不重复消耗导演调用的 Token。

---

### 3.6 异步字幕翻译预取泵与多语言隔离 (Asynchronous Subtitle Translation Pump)

LVN 制定了别具一格的提示词语言策略：**“英文指令 + 日文创作输出 + 异步中文翻译”**。

1. **创作底护栏**：对于动漫/二次元/Galgame 题材，大语言模型（如 DeepSeek-V3）在理解英文指令时的遵循度最稳，而在生成日文台词时角色的语调（语气词、敬语、第一人称代词 *ore/boku/watashi*）最为地道传神。
2. **挂载在 `line:commit` 的翻译预取泵** (`packages/app/src/ai/translate.ts`)：
   为了让中文玩家能够阅读，应用层设计了独立的翻译器。翻译器不在段末触发，而是直接监听 `line:commit` 事件，以 20 行为一批，在后台异步调用轻量模型将日文台词翻译为符合二次元语调的简体中文，并回写至引擎 Ledger。
3. **翻译延迟平滑降级**：
   当玩家阅读到某一行时，若中文译文已就绪则直接展示中文；若翻译稍有延迟，引擎会平滑回退展示日文原文，绝不阻塞打字机或暂停游戏主循环。

---

## 4. 与 OAN 的全面对标与吸收边界

### 4.1 核心机制与架构对比矩阵

| 维度 / 特性 | Live Visual Novel (`LVN`) | oh-awesome-novel (`OAN`) 当前现状 |
|---|---|---|
| **产品主定位** | AI 驱动的独立视觉小说播放器与互动引擎 | 个人同人/综漫创作工作台（Play 推演 + Writing 写作双核心） |
| **架构与模式** | 六边形架构 (L0 协议 → L1 核心 → L2 适配 → L3 组合根) | Monorepo，基于 `Sandbox Change Engine`，文件即数据库 |
| **推演生成粒度** | **幕制/拍制两级流式** (导演出结构 JSON，编剧出 NDJSON) | 回合推演 (Turn-based Rehearsal, 提示词冻结前缀 + 尾部注入) |
| **交互选项处理** | **Choice 硬切** (遇到选项立即掐断底层网络流并丢弃多余文字) | 回合末尾生成建议动作/候选项 ([1520](../tasks/1520.md)) |
| **界面呈现引擎** | **显示泵 (Display Pump)** + 恒速两段式打字机 + 取消代际隔离 | 聊天流式气泡 / 初步的 VisualNovelStage 本地栅格舞台 |
| **多模态语音体系** | **GPT-SoVITS 深度 2 预取流水线** (RTF 0.59，单底模零热切) | 暂未集成实时语音合成，仅在调研文档中进行过推演 |
| **素材与管线工具** | `tools/asset-gen` (Seedream 绿幕) + `derive` (自动抠图) | 手工维护 `world/places/` 背景与 `roster-profile.yaml` 立绘 |
| **多语言策略** | 英文系统提示 + 日文正文生成 + 异步中文预取翻译 | 原生中文创作优先，支持多语言同人设定导入 |
| **与正文的交互** | 封闭推演，游玩产生存档，无法沉淀为长篇排版正文 | **核心资产回流**：推演 Observation 可采纳为正文/设定变更 |

### 4.2 核心理念的契合点与互补性

1. **Filesystem-first 哲学的深度共鸣**：
   LVN 的 `ContentPack` 与 OAN 的对象文件树（`characters/`、`world/`、`story/`）惊人地一致。两者都坚持将小说世界的数据用人类可读的 Markdown 与 YAML 存储，将图片与音频用标准文件系统存放。
2. **Play 与 Writing 的双向赋能**：
   OAN 拥有坚不可摧的底层安全底座、Git 历史追踪、严格的人类确认（`PendingAction`）以及强大的小说正文大纲规划能力；而 LVN 则提供了令人惊叹的**沉浸式推演交互体验**（视觉小说舞台、毫秒级节奏打字机、分角色真人配音）。将 LVN 的交互引擎作为 OAN Play 模式的“演出内核”，是完美的强强联合。
3. **成本意识与缓存友好**：
   LVN 的导演/编剧上下文严格保持稳定前缀在前、易变动态内容在后；OAN 也实施了冻结前缀缓存设计。两者在抑制长会话 Token 成本的思路上完全契合。

### 4.3 边界辨析：OAN 不应照搬的部分

在借鉴 LVN 的优秀设计时，必须清醒坚守 OAN 的产品定位与安全底线：

> [!WARNING]
> **以下为 OAN 明确不应采纳或必须严格改造的边界：**
> 1. **严禁引入私有非标准 LLM 客户端**：LVN 手写了针对 DeepSeek 的裸 fetch 客户端；OAN 的核心运行时已经统一收敛在 Vercel AI SDK 与标准 Provider 抽象之上，所有大模型调用必须走统一的 AI SDK Tool Calling / StreamText 管道。
> 2. **严禁脱离 OAN 的 Play 隔离边界**：LVN 的世界状态修改直接写内存或本地 localStorage；OAN 的所有 Play 推演必须严格限定在 `.workspace/play-sessions/<id>/` 目录内，推演结果必须保持 `canonical: false`，只有通过人类采纳审批才能流向正文。
> 3. **不可硬性强制“日文生成+中文机翻”流程**：LVN 为 Galgame 纯日语发音与特定文风牺牲了直出中文；OAN 作为中文同人/综漫创作工作台，必须保持原生中文推演与写作的主干地位，翻译泵仅可作为特殊语种或双语参考的可选插件。
> 4. **不可引入未受约束的直接写盘工具**：LVN 的 `tools/*` 为独立 Node 脚本直接读写本地磁盘；OAN 的代码生成与资产变更必须通过 `Sandbox Change Engine`，并在沙箱中生成 `CandidateChangeSet` 接受 Git Diff 审查。

---

## 5. 吸收建议与分阶段落地路线图

基于对 LVN 源码的彻底解构，为 OAN 规划以下三阶段吸收落地路线：

### 5.1 P0 级：Play 模式视觉小说显示泵与选项硬切 (解决沉浸感与模型跑飞痛点)

- **建议目标**：升级 OAN `apps/desktop-ui` 中的 `VisualNovelStage`，解决当前推演文字直接刷屏、选项生成后模型过度脑补自问自答的问题。
- **具体实施**：
  1. **移植 Choice 硬切流控 (Choice Hard Cut)**：在 Play 模式的模型输出流解析器中，一旦匹配到候选选项行（符合 [1520](../tasks/1520.md) 协议），立即执行客户端 `abort()` 断开本次流连接，抛弃后续输出，将控制权交还给用户。
  2. **实现呈现层 DisplayPump**：在前端建立轻量级的 `DisplayPump` 状态机，将流式接收到的文本按自然语句排队，通过恒速打字机（支持字速调节）逐句上屏。
  3. **落地两段式推进手感**：支持空格/回车/点击操作的“一击补全文本，二击推进下句，双击瞬间跳过”，极大提升作者在推演剧情时的阅读掌控感。

### 5.2 P1 级：本地多角色语音流水线与深度预取调度 (Play 模式多模态升级)

- **建议目标**：让 OAN 的角色卡具备“真正开口说话”的沉浸式配音能力，为同人推演注入极致生命力。
- **具体实施**：
  1. **扩展 Roster 音频规范**：在 `characters/<id>/roster-profile.yaml` 中新增可选的 `voice` 配置字段：
     ```yaml
     voice:
       provider: gpt-sovits
       refAudioPath: characters/shiori/voice-ref.wav
       promptText: "参考音频转写文本"
       promptLang: ja
     ```
  2. **引入单底模多角色无热切架构**：在 `packages/runtime` 或本地辅助进程中接入 GPT-SoVITS `api_v2` 接口，多个同人角色统一使用预训练底模，通过动态注入各角色的 `refAudioPath` 实现句间零时延切换。
  3. **实现深度为 2 的预取管线**：在推演进行中，利用后台空闲队列提前预合成后 2 句角色台词，在播放语音时自动实施轻微的 BGM 压低 (Ducking)，在按住快进键时瞬间切断静音。

### 5.3 P2 级：角色立绘绿幕生图与自动抠图工具链 (创作者素材赋能)

- **建议目标**：降低同人创作者准备立绘素材的门槛，实现从 AI 生图到透明半身立绘的一键化处理。
- **具体实施**：
  1. **借鉴绿幕提示词模板**：在 OAN 的设定工坊 (Forge) 中，生成角色外观预览图时，自动在生图提示词中追加纯绿背景约束 (`solid green background, chroma key green screen, simple background, full body standee`)。
  2. **集成无损色彩距离抠图算法**：借鉴 `tools/asset-derive/derive.mjs` 中的容差分析算法，自动探测四角背景色，将绿幕/纯色背景一键转为边缘羽化的透明通道 PNG，并自动保存到 `characters/<id>/` 目录下。

---

## 6. 在 OAN 中的具体工程落地指南

为便于后续立项执行，梳理出与 OAN 现有代码模块的精准对接路径：

```text
oh-awesome-novel
├── packages/core/
│   └── src/
│       ├── types/
│       │   └── roster.ts            <-- [修改] 扩充 RosterProfile.voice 契约
│       └── ports/
│           └── voice-port.ts        <-- [新增] 定义 VoiceSynthPort 与 ReadyClip 契约
│
├── packages/runtime/
│   └── src/
│       ├── play/
│       │   ├── PlayStreamParser.ts  <-- [修改] 增加 Choice 行识别与 Hard Cut 触发器
│       │   └── VoicePipeline.ts     <-- [新增] 移植深度 2 语音预取与并发调度
│       └── tts/
│           ├── GptSovitsProvider.ts <-- [新增] 本地 9880 端口 HTTP 适配器
│           └── SilentProvider.ts    <-- [新增] 无声降级实现
│
└── apps/desktop-ui/
    └── src/
        └── components/
            └── play/
                ├── VisualNovelStage.vue <-- [升级] 接入 DisplayPump，支持两段式推进
                ├── Typewriter.ts        <-- [新增] 纯 TS 恒速两段式打字机
                └── AudioBus.ts          <-- [新增] Web Audio BGM 与分角色配音总线
```

1. **协议层桥接**：
   LVN 的 `ModelScriptEvent` 与 OAN 当前的 `PlayTurnArtifactV2` 可以平滑映射：`say` 映射为带有 `speakerId` 的角色对白；`stage` 映射为 `StageSnapshot`（包括背景图片路径、环境光照与天气）；`choice` 直接对接 OAN 的 `suggestedActions` 与回合候选项。
2. **生命周期对齐**：
   显示泵的队列消费在前端 Vue/TS 组件生命周期内运转，当推演生成结束且队列清空后，触发 `whenIdle`，自动保存当前 session 的结构化 yaml。

---

## 7. 结语

`live-visual-novel` 是一份非常优秀的工程范本。它没有盲目追求宏大而虚幻的多 Agent 社交模拟，而是脚踏实地地把 **“让大模型生成的小说如经典 Galgame 般流畅上演”** 这一件事做到了极致。

它的**两级编排 (Act/Beat)**、**选项硬切 (Choice Hard Cut)**、**显示泵 (Display Pump)** 以及 **零热切预取配音 (Prefetched TTS)**，精准击中了 AI 故事推演在人机交互与感官体验上的最深痛点。

将这些精巧的工程设计吸收进 `oh-awesome-novel` 的 Play 模式中，不仅能让 OAN 的视觉小说推演视窗从“可看的文本框”跃升为“可沉浸游玩的互动大作”，更能让同人与综漫创作者在亲身体验自己笔下角色鲜活互动的过程中，源源不断地汲取写作灵感，进一步夯实 OAN 作为顶级个人创作工作台的核心竞争力。
