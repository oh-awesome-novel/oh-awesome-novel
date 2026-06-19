# Novel Bot 与 StoryWriter 轻量参考项目合并分析

> 范围：本文合并分析 `reference-only/novel-bot` 与 `reference-only/StoryWriter`。这两个项目都是 OAN 早期灵感来源，但体量较轻，因此不拆成两份独立参考文档。  
> 结论：当前 OAN 已经基本包含并升级了这两个项目的核心理念。后续不需要照搬它们的实现，只需要保留它们代表的早期设计直觉：文件即记忆、最小工具循环、章节前规划、章节后摘要、历史压缩、事件驱动写作。

## 基准与性质

### novel-bot

本地版本：

- HEAD：`7aa790e`
- 提交日期：2026-02-16
- 提交信息：`prompt: clarify context usage and chapter writing workflow`
- 许可证：MIT

`novel-bot` 是一个 Python CLI 小说写作 agent。它的核心定位是 **Filesystem as Memory**：把设定、角色、世界观、大纲、章节草稿、全局摘要和章节记忆都放在 `workspace/` 下的 Markdown 文件中。

它最接近 OAN 的早期直觉：一个持续运行的写作 agent，通过文件维护长期上下文。

### StoryWriter

本地版本：

- HEAD：`08c32d7`
- 提交日期：2025-06-18
- 提交信息：`Update README.md`
- 许可证：未发现 LICENSE / COPYING 文件

`StoryWriter` 是一个更实验性质的脚本项目。README 描述它是长故事生成的 multi-agent framework；实际代码主要集中在 `agent_try.py`，使用 AutoGen ConversableAgent 把故事生成拆为事件大纲、事件评审、子事件拆分、章节分配、逐段写作和批量输出。

它更像论文实验或数据生成脚本，不像可维护产品。仓库代码中存在硬编码 API key、硬编码 base URL、绝对路径和批量进程脚本，因此只能作为理念参考，不能作为实现参考。

## 合并结论

这两个项目对 OAN 的参考价值可以浓缩成一句话：

```text
novel-bot 提供“文件即记忆 + 最小 agent loop”；
StoryWriter 提供“事件大纲 -> 章节规划 -> 历史压缩 -> 分段写作”；
OAN 已经把两者升级为 filesystem-first Object File Tree + Aider-style runtime + PendingAction + agent writing guide。
```

因此它们不需要像 InkOS、StoryForge 那样再输出一批新的候选吸收点。当前 OAN 已经覆盖这些理念，只是部分实现仍在 roadmap / vNext 指引阶段。

## novel-bot 实际现状

### 架构

`novel-bot` 是一个小型 Python 包：

- CLI：`novel_bot/cli/main.py`
- agent loop：`novel_bot/agent/loop.py`
- 上下文拼装：`novel_bot/agent/context.py`
- 文件记忆：`novel_bot/agent/memory.py`
- 工具注册：`novel_bot/agent/tools.py`
- provider：`novel_bot/agent/provider.py`
- skill loader：`novel_bot/agent/skills.py`

依赖很少，主要是：

- `openai`
- `typer`
- `pydantic-settings`
- `rich`
- `loguru`
- `python-dotenv`
- `pyyaml`

CLI 提供三个命令：

- `init`：创建 `workspace/`、`drafts/`、`memory/chapters/`、`memory/sessions/`，以及 `SETTINGS.md`、`CHARACTERS.md`、`WORLD.md`、`OUTLINE.md`、`STORY_SUMMARY.md`。
- `start`：启动交互式 agent。
- `sync`：检查草稿、章节记忆、全局摘要和关键文件是否一致。

### 文件即记忆

`novel-bot` 的 workspace 结构很扁平：

```text
workspace/
  SETTINGS.md
  CHARACTERS.md
  WORLD.md
  OUTLINE.md
  STORY_SUMMARY.md
  drafts/
    chapter_XX.md
  memory/
    MEMORY.md
    chapters/
    sessions/
```

这已经体现了 OAN 的早期核心直觉：小说工程不是隐藏数据库，而是作者可以直接打开和编辑的文件。

但它仍然是几个大 Markdown 文件，不是 OAN 当前的 Object File Tree。OAN 已经把这个理念进一步拆成：

- `.oan/constitution/*`
- `characters/<id>/*`
- `world/*`
- `chapters/<volume>/<chapter>.md`
- `state/*.yaml`
- `timeline/*.yaml`
- `foreshadow/*.yaml`
- `summaries/*`

也就是说，OAN 不是偏离 novel-bot，而是把 novel-bot 的“文件即记忆”推进到了更细粒度、更适合 Git diff 和工具约束的形式。

### 上下文拼装

`ContextBuilder` 每轮把这些内容拼进 system prompt：

- `SETTINGS.md`
- `CHARACTERS.md`
- `WORLD.md`
- `memory/MEMORY.md`
- 最近 3 个章节记忆
- `STORY_SUMMARY.md`
- always-loaded skills
- 可用 skills 摘要
- `OUTLINE.md`
- 当前写作进度
- memory sync reminder

它还要求 agent 不要重复读取已经拼入 prompt 的大文件，不要直接读取章节全文，而是使用最近章节摘要。

这和 OAN 当前正在形成的 `context-package`、轻量 source discipline、protected/compressible 分层是同一理念，只是 novel-bot 的实现更粗：它直接拼 prompt，没有 source id、omitted 记录、预算层级或证据链。

### 工具与写入

`novel-bot` 的工具很少：

- `read_file`
- `write_file`
- `list_files`
- `append_file`
- `memorize_chapter_event`
- `memorize_important_fact`
- `get_writing_progress`

这种少量工具的做法很符合 OAN “不要重型 agent 框架”的方向。但 novel-bot 的写入是直接 `Path.write_text()`，不经过 PendingAction、diff preview 或 Human Approval。

OAN 对它的升级是：

```text
novel-bot: tool -> direct file write
OAN: tool -> PendingAction / SemanticPatch -> diff preview -> Human Approval -> materialize
```

### agent loop

`AgentLoop` 是一个直接的 tool-calling 循环：

1. 用户输入。
2. 构造上下文 messages。
3. 调用 LLM。
4. 如果有 tool calls，执行工具。
5. 把 tool results 追加回 messages。
6. 最多循环 10 次。
7. 保存 session JSON。

它还会压缩历史：`write_file` 和 `memorize_chapter_event` 这类大内容工具调用不会完整放进后续上下文，而是替换成保存摘要。

这和 OAN 的 Aider-style runtime 目标高度一致。OAN 当前已经明确禁止 LangChain / AutoGen / CrewAI 这类重型框架，保留简洁 tool loop。

### 章节后记忆与 sync

`novel-bot` 有两个记忆层：

- 全局记忆：`memory/MEMORY.md`
- 章节记忆：`memory/chapters/*.md`

它还维护 `STORY_SUMMARY.md`，并通过 `sync` 模式检查：

- 关键文件是否缺失。
- `drafts/` 中的章节是否有对应章节记忆。
- `STORY_SUMMARY.md` 是否过期。

这条线在 OAN 中已经被拆成更正式的领域：

- `summaries/`
- `state/`
- `timeline/`
- `foreshadow/`
- 派生 projection / index
- `/整理本章` settlement bundle

因此 novel-bot 的 sync 思路已经被 OAN 包含，只是 OAN 需要更强的 evidence-only settlement 和 PendingAction 边界。

### novel-bot 的限制

novel-bot 的主要限制：

- 直接写文件，绕过人类确认。
- 工作区文件太粗，容易出现大文件冲突和不精确 diff。
- prompt 中存在规则漂移：`ContextBuilder` 要求写章节时不要同轮调用 `memorize_chapter_event`，而 `chapter-writer` skill 又要求同响应同时调用 `write_file` 和 `memorize_chapter_event`。
- 自动创建设定、角色、世界观和摘要的倾向较强，作者控制边界不如 OAN 明确。
- provider 配置绑定 NVIDIA 命名，虽然 base URL 默认是 OpenAI-compatible。

这些限制都说明：novel-bot 适合作为早期理念来源，不适合作为 OAN 的架构基线。

## StoryWriter 实际现状

### 架构

StoryWriter 源码很少：

- `README.md`
- `agent_try.py`
- `load_premise.py`
- `run.py`
- `pro.py`
- `num.py`
- `auto_restart.sh`

核心逻辑在 `agent_try.py`。它使用 AutoGen 创建多个 ConversableAgent，围绕一个 premise 批量生成长故事。

实际 pipeline 是：

1. `event_generate(premise, id, output_prefix)`
   - `event_model` 生成事件 outline。
   - `event_rerank_model` 检查事件结构是否连贯，不好就要求重生成。
   - 输出到 `final_events/`。

2. `event_extract(text_data, id, output_prefix)`
   - 用正则提取 `Event N:` 块。
   - 输出结构化 `events_*.json`。

3. `story_generate(event_str, id, output_prefix)`
   - `sub_events` 把事件拆成多个子事件。
   - `disperse_events` 把子事件分配到章节。
   - `story_writer_model` 逐子事件生成故事。
   - `story_critic` 检查是否偏离 outline，偏离则要求重写。
   - 输出 `final_outlines/` 和 `final_story/`。

4. `run.py`
   - 一次启动 127 个 `load_premise.py` 子进程。

5. `pro.py` / `num.py`
   - 统计输出文本长度和生成数量。

### 核心理念

StoryWriter 的理念不是 filesystem-first，而是 **事件驱动的长故事生成 pipeline**：

- 先生成 event outline。
- 再把 event 分解为 sub-events。
- 再把 sub-events 分配到 chapters。
- 写作时动态压缩历史，避免上下文爆炸。
- 用 critic agent 检查写作是否偏离 outline。

这套思路在 OAN 中不应实现为 AutoGen 多 agent，但可以转译为：

```text
chapter-intent
  -> scene / beat list
  -> context-package
  -> chapter draft
  -> review
  -> settlement
```

换句话说，StoryWriter 的“event / sub-event / chapter distribution”已经被 OAN 的“本章契约 / 场景序列 / 写前校准 / 审稿 / 结算”覆盖。

### 历史压缩

StoryWriter 有一个 `MessageRedact` transform，会把较旧消息压缩到约 10%，保留关键剧情、角色冲突、转折和结局，省略长环境描写和次要对白。

这和 OAN 当前的 context package 思路一致：

- protected：不能压缩的硬约束和当前任务。
- compressible：旧摘要、远期背景、历史聊天。
- excluded：未确认草稿和无关材料。

OAN 不需要复制它的压缩实现，但应该保留“旧故事历史必须被压缩成剧情进展，而不是全文塞进上下文”的原则。

### StoryWriter 的限制

StoryWriter 的工程限制很明显：

- 使用 AutoGen，不符合 OAN “不引入重型 agent framework”的边界。
- 代码中存在硬编码 API key 和 base URL。
- 使用绝对路径读取数据集，无法作为通用应用运行。
- 没有明确依赖清单或安装说明。
- 未发现 LICENSE 文件，不能复制实现或 prompt。
- 批量脚本直接启动大量进程，缺少任务队列、恢复和审计。
- 输出 JSON 是数据生成结果，不是作者可维护的小说工作区。
- 没有人类确认、Git diff、PendingAction 或文件事实源边界。

因此 StoryWriter 最多提供“事件化规划”和“历史压缩”的理念，不适合作为 OAN 的实现参考。

## OAN 对两者理念的覆盖情况

| 参考理念 | 来源 | OAN 当前覆盖情况 |
| --- | --- | --- |
| 文件即记忆 | novel-bot | 已覆盖并升级为 Markdown / YAML / Object File Tree。 |
| 作者可直接编辑小说工程文件 | novel-bot | 已覆盖；OAN 明确以文件树和 Git 为解释层。 |
| 少量工具 + 持续 loop | novel-bot | 已覆盖；OAN 采用 Aider-style tool loop，避免重型 agent 框架。 |
| 设定 / 角色 / 世界 / 大纲 / 摘要作为核心上下文 | novel-bot | 已覆盖；OAN 拆为 constitution、characters、world、workflow、summaries 等领域。 |
| 最近章节摘要防止上下文过长 | novel-bot | 已覆盖方向；OAN 使用 summaries、state、timeline、foreshadow 和 context package。 |
| 写后更新记忆 / summary | novel-bot | 已覆盖方向；OAN 通过 settlement bundle + PendingAction 实现。 |
| workspace sync / consistency check | novel-bot | 已覆盖方向；OAN 的 projection/index/settlement/rebuild 任务承担更细职责。 |
| 事件 outline | StoryWriter | 已覆盖方向；OAN 的 chapter intent 和 scene/beat list 可表达。 |
| 事件评审 / 防偏离 outline | StoryWriter | 已覆盖方向；OAN 的 PRE_WRITE_CHECK 和 `/审稿` 承担。 |
| sub-event 到 chapter 分配 | StoryWriter | 已覆盖方向；OAN 的章节规划/场景序列承担。 |
| 动态压缩历史 | StoryWriter | 已覆盖方向；OAN 的 protected/compressible/excluded 与 L0-L3 预算层级承担。 |
| critic -> rewrite | StoryWriter | 已覆盖方向；OAN 采用更保守的“审稿报告 -> 用户确认 -> patch”。 |
| 批量自动生成数据集 | StoryWriter | 不采纳；OAN 是作者 Copilot，不是自动数据生成器。 |

## 与 OAN 当前设计的关系

OAN 当前文档已经能看到这两类理念的落地：

- `AGENT_OPERATING_MANUAL.md` 明确最终目标是 `Obsidian + Git + Aider + NovelBot`。
- `FILESYSTEM_SPEC.md` 将 novel-bot 的扁平 Markdown workspace 升级成细粒度 Object File Tree。
- `novel-copilot-skill.ts` 已定义 observe -> plan -> draft/propose -> verify -> settle。
- OAN 已有 `summary.get`、`state.get`、`timeline.list`、`foreshadow.list` 等读工具，以及 `chapter.createDraft`、`summary.generateChapter`、`state.set`、`timeline.add`、`foreshadow.create` 等写意图工具。
- `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` 已把 chapter-intent、context-package、PRE_WRITE_CHECK、observation log、settlement bundle、audit checklist 等写作指引升级为候选 vNext。

因此判断：

```text
novel-bot 与 StoryWriter 的核心理念已经进入 OAN。
当前 OAN 需要继续做的是实现和细化，不是再新增一套来自这两个项目的参考方向。
```

## 仍可保留的提醒

虽然理念已经覆盖，但这两个项目仍提供几个提醒：

1. **先保持小工具循环可理解**  
   novel-bot 的好处是容易理解。OAN 后续即使加强 context package、run log、SemanticPatch，也要避免让 agent runtime 变成黑箱。

2. **写作前必须有结构，而不是直接写正文**  
   StoryWriter 的 event -> sub-event -> chapter 说明长篇生成必须先有剧情骨架。OAN 的 chapter-intent 不应被省略。

3. **写作后必须维护摘要和状态**  
   novel-bot 的 memory sync 很粗，但方向正确。OAN 的 settlement bundle 应成为章节推进后的标准动作。

4. **压缩历史时保留剧情推进，不保留装饰文本**  
   StoryWriter 的压缩目标是保留关键剧情、角色冲突和转折。OAN 的 compressible context 也应优先保留事实与变化，而不是保留长段氛围描写。

5. **prompt 规则不能互相打架**  
   novel-bot 中 system prompt 与 chapter-writer skill 对记忆更新时间存在冲突。OAN 后续需要用工具契约和测试防止类似漂移。

## 不应吸收的部分

以下内容不应进入 OAN：

- novel-bot 的直接文件写入。
- novel-bot 的自动更新正式记忆且无需用户确认。
- novel-bot 的少数大 Markdown 文件作为长期架构。
- StoryWriter 的 AutoGen 多 agent 实现。
- StoryWriter 的硬编码 API key、base URL 和绝对路径。
- StoryWriter 的批量自动生成数据集式 workflow。
- StoryWriter 的未授权代码或 prompt 复制。
- 两者中任何绕过 PendingAction / Git diff / Human Approval 的写入行为。

## 证据路径

- `reference-only/novel-bot/README.md`
- `reference-only/novel-bot/README_zh-CN.md`
- `reference-only/novel-bot/pyproject.toml`
- `reference-only/novel-bot/LICENSE`
- `reference-only/novel-bot/novel_bot/cli/main.py`
- `reference-only/novel-bot/novel_bot/agent/loop.py`
- `reference-only/novel-bot/novel_bot/agent/context.py`
- `reference-only/novel-bot/novel_bot/agent/memory.py`
- `reference-only/novel-bot/novel_bot/agent/tools.py`
- `reference-only/novel-bot/novel_bot/agent/sync_runner.py`
- `reference-only/novel-bot/novel_bot/skills/story-design/SKILL.md`
- `reference-only/novel-bot/novel_bot/skills/chapter-writer/SKILL.md`
- `reference-only/StoryWriter/README.md`
- `reference-only/StoryWriter/agent_try.py`
- `reference-only/StoryWriter/load_premise.py`
- `reference-only/StoryWriter/run.py`
- `reference-only/StoryWriter/pro.py`
- `reference-only/StoryWriter/num.py`
- `reference-only/StoryWriter/auto_restart.sh`
- `docs/AGENT_OPERATING_MANUAL.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`
- `packages/core/src/novel-copilot-skill.ts`
