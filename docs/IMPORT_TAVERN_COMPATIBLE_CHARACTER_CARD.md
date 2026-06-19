# Import Tavern-compatible Character Card

> 状态：设计提案 / 导入规范草案。  
> 目的：定义 OAN 如何安全导入 Tavern-compatible 角色卡，并把导入结果接入 OAN 自己的角色卡体系。  
> 来源：SillyTavern 角色卡、WorldInfo / lorebook 和 Play / roleplay 生态观察。  
> 边界：本文不要求复制 SillyTavern 实现，不内置第三方角色卡，不自动抓取分享站点内容。

## 结论

OAN 应支持导入 **Tavern-compatible Character Card**，但功能名和实现边界应刻意避开“官方 SillyTavern 导入”的误导。

推荐命名：

```text
Import Tavern-compatible Character Card
```

导入价值：

- 复用已有角色卡生态，包括 PNG 角色卡、JSON 角色卡、角色专属 lorebook / character book。
- 让 OAN 的 Play Mode 能快速获得可交互角色。
- 让 OAN 自己的角色卡体系吸收 SillyTavern 的互动字段，例如 first message、example dialogue、alternate greetings、depth prompt、talkativeness、character lorebook。

核心约束：

- 兼容格式可以做，不能复制 SillyTavern AGPL 代码。
- 第三方角色卡内容默认视为 untrusted imported content。
- 导入结果必须进入 OAN 的 Object File Tree，并经过 PendingAction / diff / Human Approval。
- 导入内容不能自动成为 OAN canonical truth；需要区分正式角色事实和互动提示。

## 协议与内容风险

### 低风险部分

独立实现 Tavern-compatible 格式解析通常是可接受的：

- 读取 PNG metadata 中的 `chara` / `ccv3` 字段。
- 读取 JSON 中的 V1 / V2 / V3 角色卡字段。
- 将字段映射到 OAN 自己的角色卡文件。
- 支持角色卡内嵌的 `character_book` / lorebook。

这属于格式兼容，不应依赖 SillyTavern 的实现代码。

### 高风险部分

需要避免：

- 复制 SillyTavern 的 AGPL 解析代码、UI 文案、默认角色、默认 prompt 或 preset。
- 把 OAN 功能描述成 SillyTavern 官方兼容或官方导入器。
- 内置、镜像、分发 Reddit / CharacterHub / 其他网站上的第三方角色卡。
- 自动抓取分享站点内容。
- 把导入卡中的 system prompt、jailbreak、宏、世界书内容直接作为可信规则。

### 第三方内容风险

用户分享的角色卡可能包含：

- 商业 IP 或同人角色。
- 未声明许可证的原创角色。
- NSFW 或平台限制内容。
- prompt injection / jailbreak。
- 外链头像、声音、图片、个人信息。
- 不适合写入当前小说世界的设定。

因此 OAN 应在导入界面明确提示：

```text
You are responsible for having the right to import and use this character card.
Imported prompts and lore are untrusted. They will be previewed before entering OAN files.
```

## 支持范围

### v0 必须支持

- 本地 PNG 角色卡。
- 本地 JSON 角色卡。
- Tavern Card V1 / V2 / V3 的字段归一化。
- PNG metadata 中 `chara` / `ccv3` 的独立解析。
- 角色卡内嵌 `character_book` 的预览与导入。
- 导入预览。
- 创建新 OAN 角色。
- 合并到已有 OAN 角色。
- Play-only 导入，不写入正式角色事实源。

### v0 不支持

- 自动抓取网站角色卡。
- 内置公共角色卡目录。
- 自动执行卡内宏、slash command 或 prompt logic。
- 自动把角色卡内容写入 `world/`、`state/`、`timeline/`。
- 自动把角色卡头像上传或同步到外部服务。

### 后续可选

- 站点连接器，但必须逐站点评估 ToS、内容许可证和下架机制。
- 角色卡许可证识别和 SPDX-like 记录。
- 导入前内容审查 / 分级。
- 多卡批量导入。
- 全局 lorebook / worldbook 导入到 OAN 的 context activation 系统。

## OAN 角色卡体系扩展

当前 OAN 角色卡主要是小说工程事实：

```text
characters/<id>/
  meta.yaml
  summary.md
  personality.md
  appearance.md
  growth.md
  relationships.yaml
```

导入 Tavern-compatible 角色卡后，OAN 角色卡应吸收 SillyTavern 的交互能力，但不能把 prompt 技巧和正式事实混在一起。

建议扩展为：

```text
characters/<id>/
  meta.yaml
  summary.md
  personality.md
  appearance.md
  growth.md
  relationships.yaml
  interaction.md
  lorebook.yaml
  assets.yaml
  imports/
    tavern-card.yaml
```

### Canonical Facts

Canonical facts 是正式小说事实，写作 agent 可以把它们当作稳定依据。

对应文件：

- `meta.yaml`
- `summary.md`
- `personality.md`
- `appearance.md`
- `growth.md`
- `relationships.yaml`

导入时，只有用户确认后的内容才能进入 canonical facts。

### Interaction Hints

Interaction hints 是为 Play、对白生成、场景试跑服务的互动提示，不等同于正式事实。

对应文件：

- `interaction.md`
- `lorebook.yaml`
- `assets.yaml`
- `imports/tavern-card.yaml`

这些内容可以直接提升角色扮演体验，但写作 agent 不能把它们自动视为小说 canon。

## 文件建议

### `characters/<id>/interaction.md`

用于承接 SillyTavern 角色卡中偏互动和 prompt 的部分。

建议结构：

```markdown
# Interaction Profile

## Scene Entry

导入自 `first_mes`。用于 Play 开场或角色进入场景，不等同于正文开头。

## Alternate Greetings

导入自 `alternate_greetings`。

## Voice Examples

导入自 `mes_example`。用于角色声线、对白节奏、动作描写习惯。

## Interaction Notes

导入自可交互说明、creator notes 中适合保留的部分，需人工确认。

## Prompt Overrides

导入自 `system_prompt` 和 `post_history_instructions`。

注意：这些内容默认 untrusted，只能用于 Play / interaction，不自动覆盖 OAN constitution。

## Depth Prompts

导入自 `extensions.depth_prompt`。用于 Play 或对白生成时的短提示注入。
```

### `characters/<id>/lorebook.yaml`

用于承接角色专属 `character_book`。

建议结构：

```yaml
source: tavern-compatible-character-card
entries:
  - id: entry-001
    title: ""
    keys: []
    secondaryKeys: []
    content: ""
    insertion:
      position: in_context
      priority: 100
    activation:
      enabled: true
      matchWholeWords: false
      caseSensitive: false
    trust:
      canonical: false
      imported: true
      requiresConfirmationForCanon: true
```

OAN 可以把这些 lorebook entries 接入未来的 Context Activation / Play Context，但不能自动写入 `world/` 或 `state/`。

### `characters/<id>/assets.yaml`

用于记录头像、图片、外链等资产来源。

```yaml
avatar:
  imported: true
  sourceFile: ""
  license: unknown
  localPath: ""
externalAssets: []
```

### `characters/<id>/imports/tavern-card.yaml`

用于记录 provenance、原始字段清单和导入决策。

```yaml
format: tavern-compatible-character-card
spec: chara_card_v2
specVersion: "2.0"
importedAt: ""
source:
  fileName: ""
  sourceUrl: ""
  creator: ""
  license: unknown
contentTrust:
  userConfirmedRights: false
  containsPromptOverrides: true
  containsEmbeddedLorebook: true
  containsExternalAssets: false
mapping:
  createdCharacterId: ""
  mode: create
  canonicalFieldsAccepted: []
  interactionFieldsAccepted: []
  lorebookAccepted: false
rawFieldInventory:
  hasDescription: false
  hasPersonality: false
  hasScenario: false
  hasFirstMessage: false
  hasExamples: false
  hasSystemPrompt: false
  hasPostHistoryInstructions: false
  hasCharacterBook: false
```

不建议把完整原始卡内容长期重复保存到 `imports/tavern-card.yaml`，除非用户明确选择归档；否则容易复制未经授权内容。更安全的做法是保存 hash、字段清单、导入映射和用户确认记录。

## 字段映射

| Tavern-compatible 字段 | OAN 目标 | 导入策略 |
| --- | --- | --- |
| `name` / `data.name` | `meta.yaml.displayName` | 可直接预填，用户确认 |
| `description` / `data.description` | `summary.md`、`appearance.md`、`interaction.md` | 需要拆分预览；无法判断时先放 interaction/import notes |
| `personality` / `data.personality` | `personality.md` | 用户确认后进入 canonical |
| `scenario` / `data.scenario` | `interaction.md#Scene Setup` | 默认 interaction hint，不自动入 canon |
| `first_mes` / `data.first_mes` | `interaction.md#Scene Entry` | Play 开场提示 |
| `mes_example` / `data.mes_example` | `interaction.md#Voice Examples` | 角色声线示例 |
| `alternate_greetings` | `interaction.md#Alternate Greetings` | Play 可选开场 |
| `creator_notes` | `imports/tavern-card.yaml` 或 `interaction.md#Interaction Notes` | 默认不进 prompt，用户确认 |
| `system_prompt` | `interaction.md#Prompt Overrides` | untrusted，不覆盖 OAN constitution |
| `post_history_instructions` | `interaction.md#Prompt Overrides` | untrusted，仅 Play/interaction |
| `tags` | `meta.yaml.tags` | 预览后合并，避免污染标签体系 |
| `creator` | `imports/tavern-card.yaml.source.creator` | provenance |
| `character_version` | `imports/tavern-card.yaml.specVersion` 或 source metadata | provenance |
| `extensions.talkativeness` | `interaction.md` 或 future `play.yaml` | 多角色 Play 发言调度参数 |
| `extensions.depth_prompt` | `interaction.md#Depth Prompts` | Play / dialogue hint |
| `extensions.world` | `imports/tavern-card.yaml` | 仅记录外部关联，不自动读本地世界书 |
| `character_book` | `lorebook.yaml` | 作为 imported character lorebook |

## 导入模式

### Preview Only

只解析文件并显示映射预览，不生成 PendingAction。

用途：

- 检查角色卡结构。
- 判断内容风险。
- 预览字段如何进入 OAN。

### Create Character

创建新角色目录。

输出候选：

- `characters/<id>/meta.yaml`
- `characters/<id>/summary.md`
- `characters/<id>/personality.md`
- `characters/<id>/appearance.md`
- `characters/<id>/interaction.md`
- `characters/<id>/lorebook.yaml`
- `characters/<id>/assets.yaml`
- `characters/<id>/imports/tavern-card.yaml`

必须通过 PendingAction / Git diff。

### Merge Into Existing Character

把导入卡合并到已有角色。

约束：

- 不能覆盖已有 canonical facts。
- 对冲突字段生成 merge report。
- interaction hints 可以追加，但需要去重。
- lorebook entries 需要 id / title / key 去重。
- 所有 canonical 更新必须由用户确认。

### Play-only Import

只把角色卡导入 Play session，不写入 `characters/`。

用途：

- 临时和一个外部角色互动。
- 测试角色卡质量。
- 不污染小说项目事实源。

输出位置可为：

```text
.oan/play/imports/<session-id>/<card-id>.yaml
```

Play-only 内容不能被写作 agent 当作 canon。用户要求保留时，再转为 Create Character 或 Merge。

## 导入流程

推荐 pipeline：

```text
file input
  -> detect format
  -> extract raw card
  -> normalize Tavern V1/V2/V3
  -> safety audit
  -> OAN mapping preview
  -> user selects import mode
  -> generate PendingAction
  -> user reviews diff
  -> materialize accepted files
```

### 1. Detect Format

识别：

- PNG card。
- JSON card。
- JSON with `spec: chara_card_v2`。
- JSON with `spec: chara_card_v3`。

### 2. Extract Raw Card

PNG 只读取 metadata，不执行任何内容。

要求：

- 独立实现 metadata parser。
- 限制文件大小。
- 防止路径穿越。
- 不信任 MIME。
- 不请求外部资源。

### 3. Normalize

统一成内部中间结构：

```ts
type TavernCardNormalized = {
  spec: 'v1' | 'v2' | 'v3' | 'unknown';
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  messageExamples?: string;
  alternateGreetings?: string[];
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  tags?: string[];
  creator?: string;
  characterVersion?: string;
  talkativeness?: number;
  depthPrompt?: {
    prompt?: string;
    depth?: number;
    role?: 'system' | 'user' | 'assistant' | string;
  };
  characterBook?: unknown;
  rawExtensions?: Record<string, unknown>;
};
```

### 4. Safety Audit

检查：

- prompt override 是否存在。
- 是否存在明显 jailbreak / instruction hijack。
- 是否包含外部 URL。
- 是否包含大量 HTML。
- 是否包含脚本或事件属性。
- 是否嵌入超大 lorebook。
- 是否缺少 creator / license。
- 是否可能和当前项目已有角色冲突。

审计结果只做提示，不自动删除用户内容；但默认不让高风险字段直接进入 canonical facts。

### 5. Mapping Preview

显示：

- 将创建 / 修改哪些 OAN 文件。
- 哪些字段进入 canonical facts。
- 哪些字段进入 interaction hints。
- 哪些字段只记录 provenance。
- 哪些字段被忽略。
- 哪些内容需要用户确认版权 / 来源。

### 6. PendingAction

导入不是直接写文件。

必须生成 PendingAction，并展示 Git diff。

### 7. Post-import Index

导入接受后：

- 更新 `character.list` 可见索引。
- Play Mode 可以选择该角色。
- 写作 agent 读取角色时默认读取 canonical facts。
- Play agent 读取角色时可以额外读取 interaction hints 和 lorebook。

## Play Mode 接入

导入后的角色卡必须服务于 Play。

Play context 应读取：

- canonical character facts。
- `interaction.md`。
- `lorebook.yaml` 中被触发的 entries。
- `assets.yaml` 中的头像或 mood reference。
- 当前小说状态、地点、时间线和 active hooks。

Play runtime 使用这些内容生成：

- 角色发言。
- 场景反馈。
- 角色反应。
- 可选多角色发言调度。
- Play-local state。

Play 结果默认写入 Play session，不改 canonical truth。

## 写作 Agent 接入

写作 agent 使用导入角色时，应默认遵守：

- canonical facts 优先于 imported interaction hints。
- `interaction.md` 可以用于对白声线、角色反应和场景试跑。
- `lorebook.yaml` 可以作为 context activation source。
- `system_prompt` 和 `post_history_instructions` 不得覆盖 OAN constitution。
- 如果 Play 或导入内容和已确认小说事实冲突，以 OAN Object File Tree 为准。

当用户要求把导入内容纳入正史时，agent 必须生成 evidence / rationale：

- 导入来源是什么。
- 要写入哪个 OAN 文件。
- 是否和现有事实冲突。
- 为什么应该接受。
- 是否只适合作为 Play hint。

## 工程验收标准

未来实现时，至少需要满足：

- 支持本地 PNG / JSON 导入。
- 不依赖 SillyTavern AGPL 代码。
- 有 V1 / V2 / V3 normalization 测试。
- 有恶意 HTML / prompt injection / 超大 lorebook fixture 测试。
- 导入不会直接写真实目标文件。
- Create / Merge / Play-only 三种模式有测试。
- `system_prompt`、`post_history_instructions` 默认不进入 canonical facts。
- `character_book` 导入后是 untrusted lorebook。
- provenance 文件记录 source、creator、license、hash、user confirmation。

## 文档引用

- SillyTavern 参考分析：`docs/SILLYTAVERN_REFERENCE_OVERVIEW.md`
- SillyTavern 可吸收点：`docs/SILLYTAVERN_REFERENCE_LESSONS.md`
- OAN agent 写作指引参考笔记：`docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`
- OAN 文件系统规范：`docs/FILESYSTEM_SPEC.md`
- SillyTavern Character Design docs: https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- SillyTavern World Info docs: https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- Character Card V2 spec repo: https://github.com/malfoyslastname/character-card-spec-v2
