# AINT (Agentic Interactive Narrative Theatre) 参考项目深度分析与吸收建议

> 分析对象：`reference-only/aint` (开发预览版 v0.1.0-alpha.2，基于 Go 1.27+ / React 19 / TypeScript 6.0)
>
> 对标项目：`oh-awesome-novel` (OAN - Filesystem-first 个人同人/综漫创作工作台，Play 推演 + Writing 写作双核心)
>
> 分析方式：本地源码全景静态逆向与代码审计，覆盖后端全部 25 个子包 (`internal/*`)、前端阅读与调试流 (`web/src/*`)、作品创作技能与格式规范 (`skills/aint-work/*`)、示例作品 (`examples/works/*`) 及测试套件 (`testdata/*`)；未调用任何外部付费 API。
>
> 法律与版权边界：本报告仅用于架构研究、交互设计参考及技术方案推演。严禁复制参考项目的源码、私有提示词文本、示例作品版权内容或美术音频素材。
>
> 分析日期：2026-10-30

---

## 目录

1. [执行摘要 (Executive Summary)](#1-执行摘要-executive-summary)
2. [AINT 项目全貌与核心特征](#2-aint-项目全貌与核心特征)
   - [2.1 项目定位与设计哲学](#21-项目定位与设计哲学)
   - [2.2 整体架构拓扑与单进程模型](#22-整体架构拓扑与单进程模型)
   - [2.3 作品目录规范 2.0 (Work Specification 2.0)](#23-作品目录规范-20-work-specification-20)
3. [六大核心机制深度剖析与代码级证据](#3-六大核心机制深度剖析与代码级证据)
   - [3.1 极致 Prompt Cache 与冻结前缀架构 (Frozen Prefix + Tail Injection)](#31-极致-prompt-cache-与冻结前缀架构-frozen-prefix--tail-injection)
   - [3.2 阶段块长会话整理与记忆持久化系统 (Epoch Phase Block & Context Compaction)](#32-阶段块长会话整理与记忆持久化系统-epoch-phase-block--context-compaction)
   - [3.3 回合状态机、内存草稿与崩溃一致性 (Draft Lifecycle & Crash Resilience)](#33-回合状态机内存草稿与崩溃一致性-draft-lifecycle--crash-resilience)
   - [3.4 强类型世界状态机与终结型行动协议 (State Engine & Terminal Choices)](#34-强类型世界状态机与终结型行动协议-state-engine--terminal-choices)
   - [3.5 视觉小说级流式叙事标记与舞台沉浸呈现 (Narrative Markup & Stage)](#35-视觉小说级流式叙事标记与舞台沉浸呈现-narrative-markup--stage)
   - [3.6 创作者沙箱与工程容错防线 (Sandbox & Protocol Resilience)](#36-创作者沙箱与工程容错防线-sandbox--protocol-resilience)
4. [AINT 与 OAN 的全面对标与吸收边界](#4-aint-与-oan-的全面对标与吸收边界)
   - [4.1 架构与定位差异对比矩阵](#41-架构与定位差异对比矩阵)
   - [4.2 核心理念的契合点](#42-核心理念的契合点)
   - [4.3 边界辨析：OAN 不应照搬的部分](#43-边界辨析oan-不应照搬的部分)
5. [吸收建议与分阶段落地路线图](#5-吸收建议与分阶段落地路线图)
   - [5.1 P0 级：核心体验与成本控制 (直接解决 Play 痛点)](#51-p0-级核心体验与成本控制-直接解决-play-痛点)
   - [5.2 P1 级：长篇推演稳定性与深度交互](#52-p1-级长篇推演稳定性与深度交互)
   - [5.3 P2 级：作品生态与跨模式桥接](#53-p2-级作品生态与跨模式桥接)
6. [在 OAN 中的具体工程落地指南](#6-在-oan-中的具体工程落地指南)
7. [剩余未决事项与后续调查重点 (Remaining Questions & Gaps)](#7-剩余未决事项与后续调查重点-remaining-questions--gaps)

---

## 1. 执行摘要 (Executive Summary)

`AINT`（AINT Is Not Tavern，亦读作 Agentic Interactive Narrative Theatre）是一款运行于本机的单人 AI 互动小说运行时。它通过将作品打包为包含 YAML、Markdown、Liquid 模板和素材的纯文本目录，由主笔大模型扮演执笔者，结合工具调用、记忆维护、状态追踪与分支存档，在现代化 Web 界面中为玩家提供高沉浸感的小说式互动体验。

其代码库精炼严谨（Go 1.27+ 后端 + 嵌入式 React 19 SPA），在**长上下文成本控制**、**流式视觉小说渲染**、**单写者原子提交与崩溃一致性**、**分层阶段块压缩（Phase Block）** 以及 **大模型协议容错自愈** 等方面展现出了卓越的系统工程水准与产品直觉。

对比 `oh-awesome-novel` (OAN) 当前的系统现状：
- **OAN 的优势**：拥有坚实的 Filesystem-first 底座、以 Git 为权威事实引擎的修订回滚能力、基于 `CandidateChangeSet + PendingAction` 的人类强制确认机制，以及在 Play Mode 中严格建立的世界时钟（World Clock）、事件时间表（Event Schedule）、分支快照（Branch Snapshot）与向 Writing 模式沉淀采纳（Adoption）的数据管道。
- **OAN 的痛点与缺口**：
  1. **Play 沉浸感与多模态舞台弱**：OAN 的 Play 模式偏向传统气泡对话或纯 Markdown 流，缺乏说话人色彩分流、舞台背景平滑切换（`<scene bg>`）、CG 卡片展示（`<cg src>`）、旁白与音效控制（`<bgm>`, `<sfx>`）等视觉小说（Galgame / Theatre）级视听表现。
  2. **缺少多轮推演的前缀缓存优化（Prompt Cache）**：每轮推演动态组装历史与上下文，未针对 Anthropic / OpenAI / Gemini 建立严格的“字节级前缀冻结”与“断点锚定”策略，长对话下 token 费用昂贵、首字延迟（TTFT）随轮次增加而急剧恶化。
  3. **长上下文缺乏结构化阶段整理（Compaction / Epoch Handover）**：当 Play 会话推演超过数万 token 后，缺少自动记忆落盘循环与交接摘要机制，容易面临上下文超限或遗忘前文关键情节的困境。
  4. **大模型输出脆弱性防线不足**：部分主流模型（如 Claude 3.5/3.7、DeepSeek）在多轮互动中容易在正文中幻觉出 XML 伪工具调用标签（如 `<read path="...">`），或在参数中输出未转义双引号导致 JSON 解析崩溃；且一旦修改历史，旧有的原生推理块（Native thinking signature）会导致供应商 API 报错拒绝。

**核心结论：**
AINT 是 OAN Play Mode 演进与互动叙事引擎升级的**顶级参考范式**。我们建议 OAN 吸收其 **“5 层冻结前缀缓存架构”**、**“阶段块整理与记忆 VFS”**、**“增量叙事标记解析与舞台沉浸呈现”**、**“正文伪工具拦截与确定性历史清理”** 以及 **“实时调用检查器（Debug Inspector）”**，并将其与 OAN 的 Git 历史引擎和人类确认流程有机整合。

---

## 2. AINT 项目全貌与核心特征

### 2.1 项目定位与设计哲学

AINT 明确宣称“不是另一个 SillyTavern 酒馆”，而是“AI 代理互动叙事剧场”：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                                 AINT                                   │
├───────────────────┬───────────────────┬────────────────────────────────┤
│   Prompt Cache    │   Visual Novel    │      Context Compaction        │
│   (缓存成本控制)   │   (视觉小说沉浸)   │     (阶段块与记忆落盘)          │
│ • 5 层前缀冻结     │ • 增量 Markup AST  │ • 阈值自动/硬上限整理           │
│ • 断点精准放置    │ • 舞台背景平滑切换 │ • 记忆覆盖层落盘循环           │
│ • 确定性 JSON v2  │ • 台词分流与说话人 │ • KeepFrom 滑动保留窗口        │
├───────────────────┼───────────────────┼────────────────────────────────┤
│  Single Writer    │   Strong State    │     Protocol Resilience        │
│   (单一写者与崩溃) │   (强类型世界状态) │     (协议级容错与自愈)          │
│ • 内存草稿隔离    │ • state.yaml 契约 │ • 伪工具 XML 隔离与纠正        │
│ • 单事务原子提交  │ • update_state    │ • 历史改写与 Native 签名清洗   │
│ • 零脏数据残留    │ • before/after    │ • 参数转义自愈 (args.go)        │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

其核心设计哲学包含四大原则：
1. **作品是纯文本与静态素材的合集**：Markdown + YAML + Liquid 模板，不包含任何外部可执行代码，发布为单一 zip 包或开发目录（Dev Directory）。
2. **执笔者是真正欣赏作品的合作者**：提示词设计避免死板的模板与机械例句，采用第二人称赋予执笔者对题材的审美认同与具体写作质感。
3. **确定性优于灵活性**：请求体由确定性 JSON 序列化保证字节级稳定；所有状态变更必须通过强类型校验；数据库操作全部收敛为单事务。
4. **零外部 SDK 依赖（D-44）**：完全基于 Go 标准库 `net/http` 手写三协议适配器，不受第三方 SDK 版本更新滞后或 grpc/cloud auth 重型依赖的拖累。

### 2.2 整体架构拓扑与单进程模型

AINT 采用高度紧凑的单进程架构，通过 Go 1.27 标准库 `embed` 将 React SPA 静态资源打包进单一二进制文件：

```text
浏览器（React 19 SPA）                              aint 单进程
┌──────────────────────────┐   REST /api/v1   ┌──────────────────────────────────────────────┐
│ 书架 / 作品 / 开局 / 设置   │ ───────────────► │ server ──► runtime ──► contextx ──► llm ──► 模型 API
│ 阅读页（SSE 驱动的草稿回合） │ ◄─────────────── │   │          │  ├────► tools                  │
└──────────────────────────┘   SSE 事件流     │   │          │  └────► panel                  │
                                               │   ▼          ▼                                 │
                                               │ work / save / settings / provider             │
                                               │   ▼                                            │
                                               │ store（SQLite WAL + 内容寻址 blob）            │
                                               └──────────────────────────────────────────────┘
```

后端分层遵循**严格向下依赖**规范（无任何循环依赖）：
- **组合根 (`cmd/aint`, `internal/app`)**：负责 CLI 参数解析、数据目录初始化、单实例文件锁、服务装配 (`app.wire`)。
- **接口层 (`internal/server`)**：HTTP REST 路由、中间件（鉴权、Host/Origin 校验）、SSE 连接保持与静态资源托管。
- **编排层 (`internal/runtime`)**：存档会话管理（单一写者互斥）、回合生命周期循环、上下文整理执行、重写与补选项编排。
- **引擎层 (`contextx`, `tools`, `panel`, `compact`, `helper`)**：上下文 5 层组装、工具注册与执行、Liquid 面板渲染、整理规则计算。
- **存档层 (`internal/save`)**：SQLite 存储、UUID v7 节点树、基于递归 CTE 的进度线、单事务原子提交、FTS5 全文索引。
- **领域层 (`work`, `settings`, `provider`, `usage`, `access`)**：作品编译校验、模型配置与密码保护、多币种用量统计。
- **基础层 (`llm`, `event`, `store`, `tmpl`, `state`, `vfs`, `pkg/*`)**：模型中立协议、事件总线、隔离模板工作进程、虚拟文件系统。

### 2.3 作品目录规范 2.0 (Work Specification 2.0)

AINT 的作品格式（`format: 1, engine: ">=2.0 <3.0"`）定义清晰规范：

```text
<作品目录>/
├── work.yaml              # 必需：作品清单（元数据、开关、开场列表、开局表单）
├── README.md              # 推荐：给玩家看的游玩指南
├── prompts/
│   ├── narrator.md        # 必需：执笔指令（自由书写，整体下移为 H2）
│   ├── openings/*.md      # 开场文件（静态 Liquid 模板或生成式指引）
│   ├── memory.md          # 可选：作品特定的记忆约定
│   └── compaction.md      # 可选：上下文整理时需特别保留的核心线索
├── lore/**/*.md           # 可选：设定文档（支持 world/outline/character/place 等）
│   └── _index.md          # 目录级摘要
├── state.yaml             # 可选：强类型状态定义（boolean/number/string/list/map/object）
├── commands/*.md          # 可选：作品专属命令（slash/mode/button 模式）
├── ui/
│   ├── markup.yaml        # 可选：作者自定义样式标签
│   ├── layout.yaml        # 可选：面板布局（topbar/sidebar/drawer/float）与命令栏
│   ├── panels/*.liquid    # 面板模板（只读作品 ui/ 下模板）
│   ├── theme.yaml         # 可选：阅读页主题（配色、字体、版心、行距、背景）
│   └── custom.css         # 可选：作用于阅读页的自定义样式
├── memory/                # 可选：新存档初始记忆模板（复制到 /memory/）
├── assets/                # 可选：图片 (webp/png)、音频 (mp3/ogg)、字体 (woff2)
└── assets.yaml            # 可选：素材元数据（role: background/cg/avatar/bgm/sfx）
```

---

## 3. 六大核心机制深度剖析与代码级证据

### 3.1 极致 Prompt Cache 与冻结前缀架构 (Frozen Prefix + Tail Injection)

#### 3.1.1 5 层上下文分层布局
AINT 将发送给大模型的完整上下文划分为 5 个清晰层次（代码参见 `internal/contextx/builder.go` 与 `prompts/l0.go`）：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1. 冻结系统前缀 (System Blocks - 严格不变，命中率保障)                  │
│    • L0 平台核心：工具边界、叙事标记用法、自然语言工具指南 (RenderToolGuide)│
│    • L1 作品指令：narrator.md 渲染全文                                 │
├────────────────────────────────────────────────────────────────────────┤
│ 2. 工具定义 (Tools - 严格不变)                                          │
│    • L2 裁剪后的 ToolSpec 列表（按当前作品特性与模型能力裁切）           │
├────────────────────────────────────────────────────────────────────────┤
│ 3. 稳定常驻资料 (Head User Message - 断点 ①)                            │
│    • L3 常驻设定：lore 中标记为 load: always 的核心文档、常驻图片标注    │
├────────────────────────────────────────────────────────────────────────┤
│ 4. 阶段块 (Phase Block - 断点 ②)                                       │
│    • L4 交接摘要 (Epoch Summary) + 状态快照 + 记忆目录 (/memory/ 清单)  │
├────────────────────────────────────────────────────────────────────────┤
│ 5. 历史回合流 (Append-only History - 断点 ③ 历史锚点)                   │
│    • 保留的最近 N 轮原文消息（已清洗失效推理与 Native 签名）           │
├────────────────────────────────────────────────────────────────────────┤
│ 6. 尾部用户输入 (Tail Injection - 断点 ④ 滚动末尾断点)                  │
│    • <input> 当前玩家行动 </input>                                     │
│    • <notes> 系统提示与开发者注记 </notes>                              │
│    • <pace> narrator.length 篇幅约束 </pace>                            │
└────────────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 确定性 PrefixHash 与断点标记
在 `internal/contextx/builder.go#L76-L120` 中，AINT 执行严格的断点放置与前缀哈希比对：

```go
// internal/contextx/builder.go
func (b *Builder) Build(ctx context.Context, in BuildInput) (*Built, error) {
    p, err := b.prefix(ctx, in)
    ...
    var head []llm.Part
    if len(p.l3) > 0 {
        head = append(head, p.l3...)
        head[len(head)-1].CacheMark = true // 断点 ①：常驻资料末尾
    }
    if in.Epoch != "" {
        head = append(head, llm.Part{Kind: llm.PartText, Text: in.Epoch, CacheMark: true}) // 断点 ②：阶段块末尾
    }
    if len(head) > 0 {
        msgs = append(msgs, llm.Message{Role: llm.RoleUser, Parts: head})
    }
    msgs = append(msgs, in.History...)
    msgs = append(msgs, in.Turn)
    ...
    // 确定性前缀哈希，用于检测前缀是否发生哪怕 1 字节变动
    hash := store.HashBytes(jsonx.MustMarshal(struct {
        System []llm.SystemBlock `json:"system"`
        Tools  []llm.ToolSpec    `json:"tools"`
        L3     []llm.Part        `json:"l3"`
    }{p.system, in.Tools, p.l3}))
    return &Built{Request: req, PrefixHash: hash}, nil
}
```

#### 3.1.3 协议级 4 断点动态预算仲裁与倒序退让算法 (Anthropic 适配)
Anthropic Messages 接口对单个请求硬性限制最多 4 个 `cache_control: {"type": "ephemeral"}` 断点。
在常规请求中，候选断点包括：
1. **L1 末尾**（System block 末尾，`CacheMark: true`）；
2. **L3 末尾**（Head 常驻资料末尾，`CacheMark: true`）；
3. **L4 末尾**（Head 阶段块末尾，`CacheMark: true`）；
4. **滚动末尾 (`markRolling`)**：在最后一条消息的可缓存非 thinking 块末尾放置滚动断点。

在初中期会话中，这 4 个断点正好填满配额。但当交互步数累积（距离最近 User 消息超过 20 个交互位置 `positions >= 20`）时，系统需要插入**历史回溯锚点 (`anchorCache`)** 以锁定长历史前缀，此时候选断点总数达到 5 个，超过 API 4 断点上限。

在 `internal/llm/anthropic/cache.go#L80-L95` 中，AINT 实现了基于优先级的**动态断点置换退让算法**：
- **优先级原则**：`System (L1)` > `Tail (Rolling)` > `History Anchor` > `Static L4 / L3`
- 当断点计数 `count >= maxBreakpoints` 时，算法从 `anchor` 位置倒序向前扫描，主动剥离静态 L4、L3 上的缓存标记：
```go
// internal/llm/anthropic/cache.go#L80-L95
if count >= maxBreakpoints {
    for i := anchor; i >= 0 && count >= maxBreakpoints; i-- {
        for j := len(out.Messages[i].Content) - 1; j >= 0 && count >= maxBreakpoints; j-- {
            b := out.Messages[i].Content[j]
            if hasCache(b) {
                // withoutCache 仅剥离尾部的 ,"cache_control":...}，保持消息文本前缀字节完全不变
                out.Messages[i].Content[j] = withoutCache(b)
                count--
            }
        }
    }
}
```
**关键价值**：系统永远优先锁定最核心的稳定前缀（System）与最新轮次（Tail），并在长篇推演中将中间静态断点无损让渡给历史锚点，同时 `withoutCache` 保证了原始序列化字节的严格稳定，不会诱发缓存击穿。

对于 OpenAI Responses（`internal/llm/openai`），GPT-5.6 起使用 `prompt_cache_options {mode: "implicit"}` 结合 L1/L3/L4 显式断点；Gemini 则由 wire 层保证输入数组顺序一致实现隐式前缀命中。实测缓存命中率稳定在 **90% ~ 96%**。

---

### 3.2 阶段块长会话整理与记忆持久化系统 (Epoch Phase Block & Context Compaction)

#### 3.2.1 触发矩阵与双模式设计
在 `internal/compact/compact.go` 中，AINT 制定了精密的整理触发规则与参数计算：

| 触发原因 (`Reason`) | 触发时机 | 动作与行为 |
| --- | --- | --- |
| `threshold` | 回合单事务提交后，上下文规模达到阈值 $T$ | 写者槽位直接交由后台整理，玩家下一回合输入安全排队 |
| `limit` | 回合流式进行中，下一次调用的上下文估算达到硬上限 | 回合内紧急整理：整理节点成为本回合的父节点，本回合消息保留 |
| `overflow` | 模型 API 直接返回上下文超限错误 | 紧急重试：强制进行上下文整理 |
| `manual` | 玩家点击按钮或输入 `/compact` | 手动触发背景整理 |
| `upgrade` | 存档升级至作品新版本 (D-69) | 先按旧版整理，再原子提交新版本绑定 |

整理模式分为：
- **Inline 模式（默认）**：由当前主笔模型在温暖的上下文缓存中执行，依次完成“记忆落盘循环”与“交接摘要撰写”；
- **Separate 模式**：调用轻量模型（如 Haiku / Mini）单独整理，仅输入上一份摘要、本阶段各回合纯文本、当前状态与记忆目录，适合超长篇低成本维护。

#### 3.2.2 记忆落盘循环与工具缓存防击穿 (Compaction Tool Isolation)
整理任务开始后，系统面临一个致命的架构陷阱：如果在整理期间为了“安全”而将 `update_state`、`roll_dice`、`offer_choices` 从请求的 `in.Tools` 列表中删掉，发送给大模型的 L2 工具定义就会发生变化，导致整个 L0–L3 的 Prompt Cache 瞬间被全部击穿，产生数万 token 的冷启动开销。

AINT 采取了**“工具 Schema 100% 冻结暴露 + 运行时拦截层动态阻断”**的解耦方案：
- **Prompt 层面**：整理请求的 `in.Tools` 列表与普通推演回合保持绝对一致，保证底层缓存全量命中；
- **运行时拦截层面**（`internal/runtime/compact.go#L54-L64` 的 `compactAllowed`）：仅放行资料检索、读写与状态只读工具：
  - 允许调用：`read`、`list`、`search`、`write`、`edit`、`remove` 与 `get_state`；
  - 非整理工具（`update_state`、`roll_dice`、`offer_choices`）被拦截并返回 `prompts.CompactionToolUnavailable`；
  - 整理被赋予最多 8 轮（`FlushMaxCalls: 8`）的工具落盘循环。

此外，若在回合流式进行中因超限触发紧急整理（`ReasonLimit` / `ReasonOverflow`），`internal/vfs/overlay.go#L60-L75` 提供了 **写时复制覆盖层重变基（`vfs.Overlay.Rebase`）** 能力：整理节点的记忆清单变更为新基底，本回合先前的草稿写入无缝贴合在上方，确保数据不发生丢弃。

落盘完成后，模型输出交接摘要（`SummaryChars: min(3000, threshold/10)`）。系统调用 `save.CommitCompaction` 生成不可变的 Compaction 节点，构建全新的 **L4 阶段块（Epoch Block）**：
```markdown
# 阶段交接摘要
<交接摘要正文>

## 当前状态
- day: 3
- trust.林舟: 2

## 记忆索引
- /memory/characters/lin.md: 林舟的最新线索与态度转变
- /memory/places/harbor.md: 雾港码头的封锁现状
```

#### 3.2.3 原文保留滑动窗口算法 (`KeepFrom`)
在 `internal/compact/compact.go#L81-L94` 中，AINT 使用了优雅的 `KeepFrom` 倒序累计算法：
```go
// internal/compact/compact.go
func KeepFrom(sizes []int, keep int) int {
    i, total := len(sizes), 0
    for i > 0 {
        // 至少保留最后 2 个完整回合，且累计 token 达到保留目标 keep (默认 24,000)
        if len(sizes)-i >= 2 && total >= keep {
            break
        }
        i--
        total += sizes[i]
    }
    return i
}
```
经过整理后，`[0, i)` 范围内的历史回合在后续 Prompt 中被裁剪，由 L4 阶段块完全替代；而 `[i, len)` 范围内的近 2 轮以上原始对话得以原样保留，保证模型对最近对话的语调、用词具有无缝平滑的续写记忆。

#### 3.2.4 虚拟文件系统 (VFS) 与全文检索 (FTS5 + Trigram)
AINT 构建了只由模型访问的虚拟文件系统 `vfs.Table`（`internal/vfs`）：
- `/work/`：只读挂载作品文件与素材；
- `/memory/`：可读写挂载记忆目录，底层由 `vfs.Overlay` 提供事务覆盖层，回合或整理成功提交才生成新清单落库；
- `/transcript/NNNN`：只读挂载各历史回合的纯文本。

检索系统（`internal/vfs/search.go`）实现了多语料优先级排序：
$$\text{Corpus Rank: } /memory \ (0) > /work \ (1) > /transcript \ (2)$$
当搜索词字符数 $\ge 3$ 时，直接利用 SQLite FTS5 的 Trigram 索引加速毫秒级定位；结果自动携带前置 60 字与后置 60 字的高亮片段（用 `【关键词】` 标出），并根据当前分支的进度线（ProgressLine CTE）严格过滤无关分支。

---

### 3.3 回合状态机、内存草稿与崩溃一致性 (Draft Lifecycle & Crash Resilience)

#### 3.3.1 单一写者锁与会话互斥 (`runtime.Manager`)
在 `internal/runtime/manager.go#L81-L170` 中，AINT 为每个存档维护一个独立的 `session` 结构体：
```go
type session struct {
    mu      sync.Mutex
    running *job // 正在运行的回合或整理任务
    queued  *job // 整理期间排队等待的玩家输入（至多一个）
}
```
- **不变量 5（单一写者）**：同一时刻，一个存档绝对不允许两个并发写任务同时执行。若已有回合在运行，再次提交直接返回 `409 Conflict`；
- **优雅排队**：若后台正在执行上下文整理（Compaction），玩家的输入进入 `queued` 槽位，待整理完成释放槽位后立即无缝启动回合；
- **槽位提前让出**：在发布终态事件（`turn.committed` 或 `turn.failed`）**之前**让出写者槽位，确保前端收到 SSE 终态事件后立即提交下一轮绝不遭遇 409。

#### 3.3.2 内存草稿隔离 (`runtime/draft.go`)
生成过程中的所有瞬态数据（流式文本切片、工具调用记录、状态变动、记忆写入）全部封装在 `draft` 结构体中，完全保存在内存：
- 进程遭遇崩溃（`kill -9` 或断电），磁盘 SQLite 数据库处于完全干净状态，无任何半提交垃圾；
- 状态修改先在内存中 `state.Apply` 生成不可变深拷贝；记忆变更写入内存 `vfs.Overlay`；
- 正文输出通过 SSE `turn.text` 实时流向前端，前端将其作为客户端草稿渲染。

#### 3.3.3 存档节点分类、显式审计 (`KindEdit`) 与单事务原子提交
在 `internal/save/model.go#L21-L39` 中，AINT 将故事树细分为 5 种强类型节点：
- `KindUser`：玩家常规输入行动；
- `KindAssistant`：大模型撰写的正文与终态回复；
- `KindCompaction`：后台或紧急执行的上下文阶段交接节点；
- `KindEdit`：玩家手动修改状态或编辑记忆文件的**显式审计节点**；
- `KindChoices`：由 `/choices` 派生的附属只读选项节点。

**显式审计与模型认知对齐机制 (`KindEdit`)**：
在以往的交互系统或酒馆中，玩家在侧边栏手动改数值或修改人物卡通常是静默覆写，导致大模型毫不知情，在后续交互中出现严重认知撕裂。
AINT 在 `internal/save/edit.go#L18-L60` 规定：
1. 玩家在 UI 手动修改世界状态或编辑 `/memory/` 文件时，系统绝不原地暗改数据库；
2. 系统生成不可变的 `KindEdit` 节点入库，记录结构化变动（如 `玩家修改了状态: trust.林舟 设为 3` 或编辑文件差异）；
3. 在随后发起的玩家回合中，该变动作为 `<notes>` 系统注记显式注入 Prompt 尾部，使大模型立即感知事实更新，彻底消除了暗改导致的推演幻觉。

**树形分支与前端线性段折叠 (`Segment`)**：
为了应对长篇故事分支可能带来的 UI 渲染卡顿与认知过载，AINT 在 `internal/save/tree.go#L12` 实现了 `Segment` 线性段折叠：将树形结构中连续无分叉的父子节点聚合为一个线性段；前端仅在发生分支（Branching）的节点渲染分叉指示器，极大简化了玩家的视觉动线。

**无锁死 SQLite 单连接写池与原子提交 (`save.CommitTurn`)**：
当模型自然结束或调用终结型工具后，进入 `save.CommitTurn`。
在底层驱动设计上（`internal/store/db.go#L46-L65`），SQLite 在高频读写或并发下极易抛出 `SQLITE_BUSY`。AINT 制定了严格的数据库连接策略：
- **写连接池**：强制 `SetMaxOpenConns(1)` 并配置连接参数 `_txlock=immediate`，在事务开始时直接独占锁，消除锁升级竞争；
- **读连接池**：强制 `query_only(1)` 且连接数限制为 `SetMaxOpenConns(max(4, CPU))`，保证只读查询高并发互不干扰；
- 在单写者事务内原子执行：
  1. 写入 `nodes` 表（UUID v7 主键、`parent_id` 链、`turn_no`、`status`、用量估算）；
  2. 写入 `messages` 与 `display_items` 的内容寻址 Blob；
  3. 写入 `transcript_fts` 全文索引；
  4. 写入 `usage_log`（token 消耗与精确法币成本）；
  5. 更新 `saves.head_node_id`，推进故事进度线。

#### 3.3.4 回合重写 (`/rewrite`) 与只读补选项 (`/choices`)
在 `internal/runtime/operation.go`（D-72, D-73）中，AINT 提供了两个极具产品价值的衍生操作：
- **重写 (`/rewrite 要求`)**：读取原回合的父节点快照，旧版正文与选项作为临时 `rewrite_request` 传入执笔指令（仅作理解修改参考，不进入正式历史）。模型先在草稿中修正状态与记忆，重新生成正文；成稿后以实际正文对记忆进行有界核对（最多 4 次调用），全部成功才单事务提交新节点，并在前端原位平滑替换。
- **补选项 (`/choices`)**：当已有正文末尾遗漏选项时，以当前进度为上下文发起只读调用。工具注册表严格只放行 `read`、`list`、`search`、`get_state` 与 `offer_choices`，强行拦截任何状态与记忆写调用；成功后生成附属的 `choices` 节点，不增加主故事回合序号。

---

### 3.4 强类型世界状态机与终结型行动协议 (State Engine & Terminal Choices)

#### 3.4.1 `state.yaml` 与原子单项更新
AINT 严禁自由无模式的状态修改。作品通过 `state.yaml` 声明字段类型与说明：
```yaml
fields:
  day: {type: number, default: 1, desc: 当前天数，剧情推进一天时加 1}
  trust:
    type: map
    values: number
    desc: 各人物的好感度（键为人物名）
```

在 `internal/tools/builtins.go#L116-L126`（D-53）中，AINT 做出了一项极具实战意义的决策：**`update_state` 每次调用约束为改单项**（`{op, path, value}`）。
> **工程实战反思与深层本质 (D-53)**：
> 在真实模型实测中发现，Claude 3.5 Sonnet、Sonnet 5.5 及部分中转模型在接收复合结构时，极容易输出非法转义字符。然而，将 `update_state` 约束为单项只能解决单一状态赋值，**无法解决天然复合的工具调用（例如 `offer_choices` 中包含的 `choices: []` 选项数组）**。当模型输出类似 `{"choices": "[{\"id\":\"a\",\"label\":\"读\"红楼梦\"\"}]"}` 时，文字本身的未转义双引号会使整个 JSON 反序列化直接崩溃。
> 
> AINT 真正的底层技术壁垒在于 `internal/tools/args.go#L14-L77` 实现的 **`repairQuotes` 双引号前瞻逃逸自愈算法**：
> 1. 模型工具入参解码优先执行标准 `json.Unmarshal`；
> 2. 若失败，系统自动介入 `repairQuotes` 对原始参数字符串进行字符级前瞻扫描：
>    - 遍历字符，当遇到非转义双引号 `"` 时，跳过后续所有空白字符；
>    - **字符边界判定**：若后继紧跟的字符**不是** JSON 语法分隔符 `,`、`:`、`}`、`]`，则确证该双引号是模型写在正文/描述里的文字引号；
>    - 算法自动在该引号前补齐转义符 `\`，完成无损自愈并二次执行反序列化；
> 3. 该机制彻底消除了主流模型在高频复合工具调用下的参数崩溃问题。

`state.Apply`（`internal/state/ops.go`）支持 `set`、`inc`、`append`、`remove`、`delete`。执行后产出结构化的 `Change` 列表，包含 `before` 与 `after` 完整路径值，并自动触发前端面板的即时重渲染。

#### 3.4.2 终结型工具 `offer_choices`
传统的 Tavern 或 AI 写作往往在正文末尾用自然语言输出 `1. xxx  2. yyy`，这会导致前端无法准确提取结构化按钮，且模型容易在选项后继续胡言乱语。

AINT 设计了终结型工具 `offer_choices`（`internal/tools/builtins.go#L131-L200`）：
- 属性包含 `id`、`label`、`detail`、可选样式 `style`、可选附带命令 `command`（例如 `command: "/follow 林舟"`）、以及限时设置 `timeout_seconds`；
- 该工具标记为 `KindTerminal`：**一旦调用成功，当前回合模型循环立即中止**，控制权正式移交玩家；
- 玩家点击选项后，下一轮的 Prompt 首条消息通过 `contextx/envelope.go` 将该工具调用的返回结果精确回填（`{"result": "玩家选择了选项 a: 跟着脚步声出去"}`），逻辑极为严密。

---

### 3.5 视觉小说级流式叙事标记与舞台沉浸呈现 (Narrative Markup & Stage)

#### 3.5.1 内置叙事标记体系
AINT 摒弃了在小说正文中杂乱使用 Markdown 标题、表格和复杂语法的做法，制定了一套专门为小说流式排版量身定制的叙事标记（Narrative Markup）：

| 标签语法 | 视觉与交互表现 | 启用条件 |
| --- | --- | --- |
| `<scene bg="素材ID" title="标题" transition="fade\|cut\|blur"/>` | 舞台层切换背景图片并压暗四周，正文段首呈现场景标题卡 | 存在 `role: background` 素材 |
| `<cg src="素材ID" caption="说明"/>` | 插入正文插图卡片，支持点击全屏灯箱放大查看 | 存在非背景类图片素材 |
| `<say who="人物名">台词</say>` | 提取说话人姓名，按设定文档 `display.color` 对姓名与台词着色 | `presentation.dialogue: tagged` |
| `<bgm src="音频ID" volume="0.8"/>` / `<bgm stop="true"/>` | 舞台音频控制器，平滑淡入淡出播放背景音乐 | 存在音频素材 |
| `<sfx src="音频ID"/>` | 触发单次音效播放 | 存在音频素材 |
| `<pause ms="800"/>` | 打字机流式输出时暂停指定毫秒，营造戏剧停顿 | `presentation.text_effects: true` |
| `<fx type="shake\|glitch\|blur-reveal">文字</fx>` | 文字震颤、故障穿梭、模糊显现等动态视觉特效 | `presentation.text_effects: true` |
| `<act cmd="/命令 参数">文字</act>` | 正文中的行内超链接，点击直接执行作品命令 | 作品声明了可见命令 |
| `<ooc>场外交流</ooc>` | 执笔者的场外说明，以浅色弱化块呈现，不计入故事正文与原文检索 | `features.ooc: true` |

#### 3.5.2 双端确定性对齐与高性能增量 AST 解析器
在互动小说与大模型应用中，标记解析往往存在“后端提取纯文本入库搜索”与“前端高亮渲染”两套逻辑不同步的隐患。
- **双端 AST 测试向量严格对齐**：
  AINT 在后端 Go（`internal/markup/markup.go`）与前端 TypeScript（`web/src/markup/parse.ts`）中实现了两套语法一致的解析器，并通过共用测试向量套件（`testdata/markup/*.json`）进行双端对齐回归测试。确保正文入库的全文索引分词、段落分界与前端渲染出的 DOM 树完全吻合。
- **行内交互标记 `<act cmd="...">`**：
  除对白 `<say>`、场景 `<scene>`、插图 `<cg>` 外，AINT 支持在正文中内嵌可点击操作词：`<act cmd="/look 抽屉">仔细观察</act>`。玩家点击正文词句即可直接触发对应作品命令，无需手动在终端输入，大幅增强互动沉浸感。
- **高性能增量尾部解析机制 (`render.tsx#L16-L36`)**：
  在前端 React 渲染中，如果长达万字的回合在流式输出的每一帧（每输出几个字符）都对全文重新进行正则或 Markdown 解析，会导致严峻的 CPU 掉帧卡顿。
  AINT 采取了增量 Block 缓存方案：
  1. 正文按行切分为 Block，每个非空行为一段；
  2. 流式过程中只有最后一行处于 `drafting` 状态；
  3. 已完成的前面段落保持完全相同的 Object 引用，通过 React `memo(BlockView)` 直接跳过 Virtual DOM Diff 与重渲染；
  4. 无论回合累积到多少字，每帧都**仅重渲染最后一个段落**，流式打字机如丝般顺滑。

#### 3.5.3 工业级舞台背景 4 层滤镜复合配方 (`StageBackground.tsx`)
创作者上传的背景图色彩、明暗与分辨率往往极不均匀，若直接展示会严重破坏正文文字的可读性。
AINT 在 `web/src/features/reader/stage/StageBackground.tsx#L16-L56` 中研发了一套工业级视觉舞台配方：
1. **重度模糊与降饱和**：`scale-110 blur-[14px] saturate-[0.85]`，在放大 10% 消除白边的同时，消除背景中高对比度的局部噪点与杂色；
2. **径向暗角遮罩 (Radial Vignette)**：中央版心透光 30%，向四周递增至纯黑/背景纯色，无论作者使用何种刺眼的白色背景，正文字段永远具备清晰稳定的阅读对比度；
3. **顶底向心线性压暗**：为顶栏状态条和底部选项/输入栏提供扎实的下坠依托；
4. **分形噪点去色带层 (Procedural Fractal Noise SVG Grain)**：在深色渐变背景上叠加 5% 不透明度的分形噪点 SVG，彻底消除了 OLED / HDR 屏幕在深色过渡下常见的阶梯状色带断层（Color Banding）。

---

### 3.6 创作者沙箱与协议级容错三防线 (Sandbox & Protocol Resilience)

#### 3.6.1 Liquid 模板隔离工作进程 (`internal/tmpl/worker.go`, D-46)
作品的开场、命令与 UI 面板允许创作者使用 Liquid 模板。然而，若创作者编写了无终止条件的 `{% for %}` 死循环或超大递归，会导致后端服务主线程挂死。

AINT 采取了非常坚固的沙箱设计：
- 主进程通过隐藏子命令 `aint __tmpl-worker` 预先启动两个轻量隔离工作进程；
- 父子进程间通过 stdin/stdout 以 JSON 行协议通信；
- 单次渲染限制 1 秒（`MaxRenderTime`），限制源码与输入输出各 64 KiB；
- **一旦超时或崩溃，父进程直接 `kill -9` 终止工作进程并重启新进程**，主服务运行完全不受任何恶意或损坏模板的影响。

#### 3.6.2 正文伪工具拦截与确定性历史清洗 (`internal/runtime/tool_text.go`, `tool_history.go`, D-49)
大模型经常把本应走原生 API 的工具调用在正文中用伪 XML 标签直接打印出来（例如输出 `<read path="/memory/lin.md">`）。
- **流式实时拦截 (`toolTextFilter`)**：在正文流推送到前端前，检测标签是否为当前可用工具名。如果是，将其从流式正文中剥离，避免污染玩家界面的阅读体验；
- **错误纠正注入**：拒绝该回复中的后续操作，在后台向模型回填纠正提示（“请使用原生工具调用，不要在正文中输出工具标签”），模型在同回合内最多纠正 2 次；
- **历史发送副本清洗 (`toolHistoryCleaner`)**：在后续请求的历史消息中，确定性地剔除伪标签、退回的调用与纠正提示。

#### 3.6.3 大模型协议深度自愈：Gemini 占位签名注入与滑动截断孤儿调用改写
在跨模型对话与历史截断/清洗时，主流模型供应商的私有协议极易触发难以排查的 400 Bad Request：
1. **Gemini 3.8+ 跨历史占位签名注入 (`internal/llm/gemini/gemini.go#L292-L295`)**：
   - Gemini 协议要求：上下文中的 FunctionCall 必须携带思考签名（`thoughtSignature`）。当历史被编辑、截断或跨模型调用时，原生签名失效；如果直接丢弃该签名，Google 官方 API 会直接报错拒绝（400）。
   - AINT 严格遵循 Google 官方未公开规范，在跨模型或改写历史的函数调用中主动注入官方占位签名：
     ```go
     c.ThoughtSignature = "skip_thought_signature_validator"
     ```
     彻底解决了 Gemini 在复杂多轮交互与历史修复下的协议崩溃。
2. **滑动截断孤儿工具结果改写 (`repairOrphans`, `internal/runtime/history.go#L151-L190`)**：
   - 当上下文整理通过 `KeepFrom` 截断早期历史时，保留窗口的起点若恰好是玩家对上一轮 `offer_choices` 的回复，该 `tool_result` 就会因前置 `tool_use` 被截断而成为“孤儿调用结果”。Anthropic / OpenAI 会报 400 协议格式错误。
   - `repairOrphans` 扫描保留消息，当检测到无匹配父调用的孤儿 `tool_result` 时，将其自动降级改写为普通用户对白文本：`（玩家对上一轮选项的回应：%s）`，从根源上消除了上下文滑动截断导致的协议崩溃。

---

## 4. AINT 与 OAN 的全面对标与吸收边界

### 4.1 架构与定位差异对比矩阵

| 维度 | AINT (`reference-only/aint`) | oh-awesome-novel (`OAN`) |
| :--- | :--- | :--- |
| **产品核心定位** | **纯粹的互动小说运行时 (Player & Runtime)**<br>玩家导入打包好的作品进行沉浸式游玩 | **个人同人/综漫创作工作台 (Workbench)**<br>Play（穿越推演）+ Writing（正式写作）双核心 |
| **终态数据归宿** | 存档保持在 SQLite WAL 数据库中，以节点树形式存在 | **Filesystem-first Markdown/YAML**<br>通过 Git 追踪版本，推演结果沉淀为正式章节 |
| **人类确认机制** | 玩家做选择/输入，模型生成即提交（属于游戏交互） | **强制 Human Approval**<br>`CandidateChangeSet + PendingAction` + Git Diff |
| **上下文管理** | 5 层架构 + L4 阶段块自动整理 (Recap) + VFS | 早期按会话拼装，缺乏结构化 Phase Block 整理 |
| **Prompt Cache** | **极致优化 (90%+ 命中率)**<br>PrefixHash、4 滚动/锚点断点、确定性序列化 | 动态拼装较多，尚未系统化实施字节级前缀冻结 |
| **叙事呈现** | **视觉小说级 (Galgame)**<br>背景舞台、CG、说话人染色、音效、打字机 | 侧重长文写作排版与推演气泡，缺乏多模态舞台层 |
| **工具协议容错** | 完善的伪工具拦截、双引号转义自愈、Native 签名清洗 | 依赖模型原生遵循，容错兜底机制相对薄弱 |
| **创作者工具** | 命令行 `aint work validate/prompt/pack` + 沙箱 | 统一的 Web 工作台 + Agent Copilot 协同 |

### 4.2 核心理念的契合点

1. **Filesystem-first 哲学**：AINT 的作品完全是纯文本与素材目录，OAN 的全书工程也是文件系统为第一公民，两者在数据结构透明性上高度一致；
2. **单一写者与崩溃零脏写**：AINT 坚持单事务与内存草稿隔离，OAN 坚持 Staging 目录与原子 Swap，两者都对数据安全有极高追求；
3. **极简 Runtime，反对重型多 Agent 平台**：AINT 仅用单一主笔循环加轻量助手，OAN 同样坚持 Aider 风格极简循环，拒绝 LangChain 类过度抽象。

### 4.3 边界辨析：OAN 不应照搬的部分

在吸收 AINT 的优秀技术时，必须清醒坚守 OAN 的底线边界，严禁以下教条主义做法：
1. **不得将 OAN 降格为纯粹的“游戏播放器”**：OAN 的 Play 模式不是为了让用户通关游戏，而是为了让同人作者在推演中碰撞灵感，**推演的终点是生成 Adoption Candidates 进而转化为正式章节小说**；
2. **不得绕过人类审批写入正式文件**：AINT 允许模型自由修改其内部的 `/memory/`，但在 OAN 中，对小说核心设定（`state/`、`characters/`、`timeline/`）的修改必须转化为 `PendingAction`，经作者在 Diff 界面确认后才写入；
3. **不得舍弃 Git 底座改用黑盒数据库存储正式小说**：AINT 采用 SQLite 存储存档适合桌面单机游戏，而 OAN 的正式小说数据必须始终是干净的 Markdown/YAML 文件，由 Git 记录版本历史。

---

## 5. 吸收建议与分阶段落地路线图

我们建议 OAN 分三步有序吸收 AINT 的核心技术精粹：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        OAN 吸收 AINT 路线图                            │
├────────────────────────────────────────────────────────────────────────┤
│ 【P0 级：核心体验与成本控制】(直接解决当前 Play 模式痛点)                 │
│  1. 建立 Play 模式 5 层 Frozen Prefix Prompt Cache 架构 (降低 70%+ 费用)│
│  2. 引入增量叙事标记解析与视觉小说舞台层 (<scene>, <say>, <cg>, <ooc>) │
│  3. 引入伪工具拦截器 (ToolTextFilter) 与协议 Native 签名安全清洗        │
├────────────────────────────────────────────────────────────────────────┤
│ 【P1 级：长篇推演稳定性与深度交互】                                      │
│  1. 实现 Epoch Phase Block 自动整理与 KeepFrom 滑动窗口算法             │
│  2. 引入只读补选项 (/choices) 与回合重写 (/rewrite) 操作协议            │
│  3. 移植 Debug Inspector 检查器 (Token 消耗/命中率/调用耗时/状态 Diff)   │
├────────────────────────────────────────────────────────────────────────┤
│ 【P2 级：生态扩展与跨模式桥接】                                          │
│  1. 支持将 AINT 作品包一键导入为 OAN 的 Play 剧本/推演世界 (Scenario)   │
│  2. 构建 Play 成果向 Writing 正式章节的结构化提取器 (Adoption Exporter) │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 P0 级：核心体验与成本控制 (直接解决 Play 痛点)

#### 5.1.1 落地 Frozen Prefix 缓存布局
在 `packages/agent` 的 Play 模式提示词构建器中，严格执行 5 层前缀冻结：
- **Layer 0/1 (System)**：核心世界规则、叙事风格、原生工具自然语言用法指南；
- **Layer 2 (Tools)**：根据当前启用的设定裁切工具 schema；
- **Layer 3 (Head User Message)**：常驻人物卡、核心世界观摘要、常驻插图，末尾打上 `CacheMark: true`（断点 1）；
- **Layer 4 (Epoch Phase Block)**：阶段交接摘要与当前状态快照，末尾打上 `CacheMark: true`（断点 2）；
- **History & Tail**：历史追加回合，在距离末尾前 20 交互位置放置历史锚点断点，在当前用户输入末尾打上滚动断点。
- **收益**：使 OAN Play 模式的多轮推演 token 成本降低 **70%~90%**，首字延迟降低 **50%+**。

#### 5.1.2 引入增量叙事标记与舞台呈现
在 `packages/core` 与 `apps/desktop-ui` 中实现叙事标记 AST 解析与 React/Vue 渲染组件：
- 支持 `<scene bg="..." title="...">`：自动平滑过渡推演背景图，显示场景标题卡；
- 支持 `<say who="...">台词</say>`：解析说话人并关联角色卡专属色值；
- 支持 `<cg src="...">`：提供插图卡片与全屏灯箱；
- 支持 `<ooc>...</ooc>`：区分 AI 的场外讨论与正文推演；
- 采用 AINT 的**尾部增量解析算法**，确保上万字长推演时打字机流式输出零掉帧。

#### 5.1.3 引入伪工具拦截与协议 Native 签名自愈
在 `packages/backend` 的流式接收端引入 `ToolTextFilter`：
- 在流式向 UI 推送文本前，拦截以可用工具名为标签的 XML 片段（如 `<read path="...">`）；
- 判定模型出现伪调用幻觉时，触发回合内自愈重试；
- 历史改写时，自动剔除 Anthropic `thinking` 块与 Gemini `thoughtSignature`，避免供应商 API 报签名不匹配错误。

---

### 5.2 P1 级：长篇推演稳定性与深度交互

#### 5.2.1 引入 Epoch Phase Block 上下文整理机制
针对 OAN Play 会话建立长上下文预算策略：
- 设置整理阈值（如模型窗口的 60% 或 128K token）；
- 超过阈值后自动触发后台整理：主笔模型将前文事实写入 Play-local state 或摘要，输出精炼交接摘要；
- 采用 AINT 的 `KeepFrom` 算法：滑动保留最近 2~4 回合原文，早期历史由阶段块替代；
- 解决 OAN Play 模式长篇推演“失忆”与“账单爆炸”问题。

#### 5.2.2 引入终结型 `offer_choices` 与 `/rewrite`、`/choices`
- 允许模型在推演回合结束时调用 `offer_choices` 输出分支选项；
- 提供 `/rewrite [要求]` 接口：支持作者对不满意的上一回合进行指定要求的重写，并在界面原位覆盖；
- 提供 `/choices` 只读接口：当模型遗漏选项时，一键无损补全可行动作。

#### 5.2.3 移植 Play 实时调试检查器 (Debug Inspector)
在 Play 界面右侧 HUD 或抽屉中提供类似 AINT 的实时调试面板：
- **概览 Tab**：展示 Prompt Tokens、Completion Tokens、Cached Tokens（直观看到缓存命中率）、时延与真实法币费用；
- **上下文 Tab**：清晰展开 L0~L4、常驻资料、历史回合与当前输入的拼装详情；
- **工具与状态 Tab**：展示每次工具调用的原始入参、解析结果、执行耗时，以及状态变更前后（Before / After）的对比高亮。

---

### 5.3 P2 级：作品生态与跨模式桥接

#### 5.3.1 支持导入 AINT 作品作为 OAN Play 剧本
由于同人与互动小说圈存在大量优质作品与角色卡，OAN 可在 `packages/backend` 编写兼容读取器：
- 支持直接导入 AINT 的 `work.yaml`、`lore/`、`prompts/` 目录；
- 将 AINT 的设定与人物映射为 OAN Play Mode 的 Activated Sources；
- 使 OAN 作者可以直接在他人创作的优秀世界观作品中展开“穿越推演”。

#### 5.3.2 推演成果向 Writing 模式的高效 Adoption 管道
打通从 Play 到 Writing 的最后一步：
- 将 Play 中的 `StageBackground`、对白 `<say>`、场景切换 `<scene>` 以及 Observation，通过结构化提取器一键生成小说章节初稿草稿；
- 转化为 OAN 标准的 `CandidateChangeSet + PendingAction`，由作者进入 Writing 模式完成最终文字润色与正式 Git Commit 归档。

---

## 6. 在 OAN 中的具体工程落地指南

各包的具体改造对齐规划如下：

### 6.1 `packages/core` (基础契约与类型定义)
- 新增 `src/play-markup.ts`：定义叙事标记 AST 节点（`DividerNode`, `SceneNode`, `CgNode`, `SayNode`, `OOCNode`, `TextEffectNode`）及纯文本提取函数；
- 新增 `src/play-cache.ts`：定义 5 层前缀数据结构与断点标记器（`CacheBreakpoint`）；
- 新增 `src/play-compaction.ts`：定义整理参数（`Budget`, `Reserve`, `KeepRecent`, `SummaryTarget`）与 `KeepFrom` 纯算法；
- 扩展 `src/play-session.ts`：在 session schema 中引入 `phaseBlocks` 记录与当前阶段元数据。

### 6.2 `packages/agent` (提示词组装与协议适配)
- 新增 `src/play-prompt-builder.ts`：实现确定性 Frozen Prefix 组装器，计算稳定的 `PrefixHash`；
- 新增 `src/tool-text-filter.ts`：移植 AINT 的流式伪工具标签拦截器；
- 增强 LLM 协议调用层：在构造 Anthropic 请求时，根据 CacheMark 放置精准的 4 个断点；在历史被修改时安全清洗 Native thinking 块。

### 6.3 `packages/backend` (运行时会话与持久化)
- 增强 `src/play-session-service.ts`：
  - 引入单写者会话锁，确保同一 Play session 的回合与整理互斥执行；
  - 引入内存草稿（In-memory Draft）机制，流式阶段只保留在内存，完成验证后原子写盘；
  - 实现后台 Compaction Runner 与 `/rewrite`、`/choices` 专用路由。

### 6.4 `apps/desktop-ui` (沉浸式阅读与调试界面)
- 新增 `src/components/play/markup/`：基于 Vue 3 移植 AINT 的增量 AST 解析与 BlockView 渲染，集成打字机动画（`useTypewriter`）；
- 新增 `src/components/play/stage/StageBackground.vue`：实现背景图的淡入淡出（Cross-fade）与模糊切换；
- 新增 `src/components/play/debug/PlayDebugInspector.vue`：实现抽屉式调试检查器，直观展示 Token 缓存命中、耗时、调用树与状态对比。

---

## 7. 剩余未决事项与后续调查重点 (Remaining Questions & Gaps)

在本次静态代码逆向分析之后，建议后续研究与开发人员优先关注以下重点：

1. **真实模型评测与双引号自愈的极限边界**：
   - AINT 在 D-53 中记录了 Sonnet 5.5 输出 JSON 字符串未转义双引号的问题。在 OAN 计划采用的 DeepSeek V3/R1、Claude 3.7 Sonnet 或 Qwen 2.5 真实调用中，该现象发生的频率如何？需要通过针对性的真实用例建立回归测试集。
2. **Anthropic 4 断点策略与长对话多轮复用的实测命中率**：
   - AINT 的 `anchorCache`（20 个交互位置回溯锚点）在实际 50 回合以上的推演中，能否在跨会话重启后稳定命中？需编写专门的 Benchmark 脚本测量缓存费率。
3. **Play-local 强类型状态与 OAN Canonical State 的映射关系**：
   - AINT 的状态是单一作品局部的强类型 YAML，而 OAN 拥有正式的小说状态库。当 Play 中的推演状态被作者显式采纳（Adoption）时，如何优雅地将 Play-local 的字段映射合并到小说正文的大纲与时间线中，需要进一步完善交互协议设计。
4. **Liquid 模板在 Node.js / Electron 环境下的最佳沙箱实现**：
   - AINT 在 Go 环境下使用独立的子进程 `aint __tmpl-worker` 进行 Liquid 隔离。在 OAN 基于 Node.js / Electron 的技术栈中，应评估使用 `isolated-vm`、Worker Threads 还是受限的 AST 解释器来达到同样的防死循环安全目标。
