# Product Overview

`oh-awesome-novel`（OAN）是一个个人使用的同人与综漫故事创作工作台。定位与边界见 [PROJECT_VISION.md](PROJECT_VISION.md)。它把作品组织成 Markdown / YAML 文件树，以 **Play 推演** 和 **Writing 写作** 两个同级模式工作，并让作者通过审批和 Git 历史掌控所有正式内容。

```text
个人同人/综漫创作工作台
  = Play：在原作世界里穿越/导演、改写剧情走向
  + Writing：从零开写或把推演整理成章节
  + 参考素材：角色卡、拆书材料、作者笔记
  + filesystem-first 作品文件 + Git 历史
  + PendingAction 人类审批（按风险分级）
  + fixed in-memory Sandbox Change Engine
```

## 两条主要旅程

### 旅程 A：在原作上改写（Play 优先）

1. 准备素材：导入 Tavern 角色卡、拆解参考作品得到世界观/角色/关系/大纲材料，或手写角色与世界笔记。
2. 在 Play 中用 Guided Start 选择来源和入场点；Immersive Journey 以作者本人（穿越者）身份进入，Scene Rehearsal 以导演身份安排一场戏。
3. 推演中世界事件、分支、checkpoint 和角色认知边界保持一致；作者可以回退、改走另一条世界线。
4. 结束后生成 Outcome Report 或 Writing Reference，并显式采纳为章节草稿、状态、时间线或伏笔的待审批修改。
5. 回到 Writing，基于采纳的结果写成正式章节，并整理本章。

### 旅程 B：从零开写一个脑洞（Writing 闭环）

1. 新建作品，在引导中填写作品名、灵感与角色方向（默认同人二创 Profile）。
2. `/规划大纲`、`/规划下一章`：保存时系统自动选择 `outline/main.md` 或本卷大纲文件。
3. `/写下一章`：系统自动确定下一个章节文件（空作品为 `chapters/0001/0001.md`），生成新建章节的待审批项。
4. `/审稿` → 局部修改 → Accept 定稿。
5. 定稿后系统提示 `/整理本章`，把有正文证据的摘要、状态、时间线、伏笔和角色成长整理为一项审批；这类派生记录可以整批接受。
6. 首页显示尚未整理的章节数，提醒在继续写作前补齐记忆。

## 界面结构

进入作品后，在同层级的 `Writing | Play` 顶级模式间切换：

- Play 是互动世界工作台：transcript / narrative、action composer、scene / cast、world HUD、事件、上下文和 adoption。
- Writing 是写作工作台：左侧文件树和章节导航，中间 Copilot，右侧文件查看、diff 与上下文。

Play 不是 Writing 右侧面板中的一个 tab。两种模式共享同一个作品 workspace、canonical sources、provider 与审批基础设施，但各自拥有完整的主区域、导航状态和内部布局。

Copilot 会把 `.oan/workflow.yaml`、constitution、大纲、summary、state、timeline、foreshadow、角色卡和章节正文等 allowlisted 文件一次性投影到内存 workspace。模型通过受限 `bash-tool` / `just-bash` 和领域 read tools 编辑这份固定快照；finalize 生成 create / update / delete `CandidateChangeSet`，作者接受后才事务化写入真实文件。

## 当前功能

- 作品管理：新建、导入已有 OAN workspace、打开最近项目、重命名、移除。
- 新建引导：作品名、灵感、角色方向、开始写作目标，可跳过。
- Provider 配置与 workspace 进入时的 provider gate；Light / Dark 主题。
- 作品文件结构：`chapters/`、`characters/`、`world/`、`outline/`、`state/`、`timeline/`、`foreshadow/`、`summaries/`、`.oan/`。
- 文件浏览与章节导航：按卷和章节扫描 `chapters/<volume>/<chapter>.md`。
- 正文搜索与导出：中文正文/标题/路径搜索，按章节顺序下载 Markdown/TXT。
- 作者旧稿导入：UTF-8 `.md` 拆章与卷章映射、冲突/diff 预览，经 PendingAction 接受后创建章节。
- Play：Quick Start、Guided Start、Immersive Journey、Scene Rehearsal、世界事件与时间、分支与 checkpoint、branch-local knowledge、Director 控制、Outcome Report、Writing Reference 与显式 adoption。
- 参考素材：Tavern 兼容角色卡导入（Play only / 新建角色 / 合并）、参考作品深度拆解（技巧轨与故事材料轨）与材料采纳。
- Writing Profile：同人二创（默认）、商业写作提示风格与自定义组合。
- Copilot 快捷指令：`/规划大纲`、`/规划下一卷`、`/规划下一章`、`/写下一章`、`/生成角色卡`、`/审稿`、`/去AI味`、`/整理本章`、`/整理本卷`、`/整理全书`、`/更新状态`、`/补伏笔`。
- PendingAction 审批：结构化 `create | update | delete` 变更、diff、接受、拒绝；派生记录可整批接受。
- Sandbox editing：每 turn 一个 fixed `InMemoryFs`、host-selected capability、受限 shell/text commands、bounded preview 与显式 proposal。
- Transactional materialization：baseline/origin/repository 重验、rollback、durable commit point 与 crash recovery。
- 长篇记忆：章级/卷级/全书摘要与状态按来源 hash 区分 current/stale/missing/unverified。
- Git：status/log/diff/显式 commit/sync，Accept 后按配置自动提交。
- 上下文与用量：每轮实际发送的来源、预算、protected overflow 与 provider usage。

写作闭环相关的自动目标路径、章节进度引导、未整理章节提示与派生记录整批接受由 [1330](tasks/1330.md) 与 [1340](tasks/1340.md) 交付；以任务状态为准。

## 产品边界

AI 是 Copilot，不是作品数据所有者。项目的事实来源始终是文件树和 Git 历史。

OAN 不追求商业写作、连载运营或团队协作，也不追求重型多 Agent 平台、自动后台写作、私有数据库、隐藏记忆系统或 host-shell coding environment。体验的核心是：作者在 Play 中探索或在 Writing 中提出意图，Host 授予精确 capability，Copilot 在固定内存投影中形成 PendingAction，作者确认后再写入。
