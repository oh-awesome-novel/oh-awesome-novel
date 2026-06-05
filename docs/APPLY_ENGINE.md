# Apply Engine

## Purpose

Apply Engine 是 `oh-awesome-novel` 的核心技术层。

它解决的问题：

> 如何让 AI 像人一样局部编辑小说工程，而不是像 LLM 一样重写整个文件。

## Why It Exists

传统 AI 文件修改方案有问题。

### Full File Rewrite

```text
LLM reads file
    ↓
LLM outputs entire new file
    ↓
overwrite
```

风险：

- 大文件慢。
- token 消耗高。
- 容易删掉无关内容。
- 格式容易乱。
- diff 很难审阅。

### Search / Replace

```text
<<<<<<< SEARCH
...
=======
...
>>>>>>> REPLACE
```

风险：

- 空白字符导致失败。
- 重复文本导致误替换。
- 上下文漂移导致找不到。
- 不适合长篇小说场景。

## Core Idea

AI 不输出全文，也不输出行号。

AI 输出意图：

```text
SemanticPatch[]
```

Apply Engine 负责：

```text
Intent
    ↓
Load File
    ↓
Find Semantic Node
    ↓
Apply
    ↓
Generate Diff
    ↓
Validate
    ↓
PendingAction
```

## SemanticPatch Types

### ObjectPatch

用于：

- Character
- World
- Constitution

```ts
interface ObjectPatch {
  kind: "object";
  domain: "character" | "world" | "constitution";
  entityId: string;
  file: string;
  operation:
    | "replaceFile"
    | "appendBlock"
    | "replaceBlock"
    | "appendSection"
    | "replaceSection"
    | "frontmatterSet"
    | "frontmatterDelete";
  selector?: {
    section?: string;
    block?: string;
    path?: string;
  };
  value?: string | number | boolean | object;
  instruction?: string;
}
```

### CollectionPatch

用于：

- State
- Timeline
- Foreshadow

```ts
interface CollectionPatch {
  kind: "collection";
  domain: "state" | "timeline" | "foreshadow";
  file: string;
  operation:
    | "yamlSet"
    | "yamlDelete"
    | "yamlAppend"
    | "yamlMove";
  path: string;
  value?: unknown;
}
```

### NarrativePatch

用于：

- Chapter
- Summary

```ts
interface NarrativePatch {
  kind: "narrative";
  domain: "chapter" | "summary";
  file: string;
  operation:
    | "replaceScene"
    | "insertScene"
    | "appendScene"
    | "replaceChunk"
    | "appendSection";
  selector?: {
    scene?: string;
    chunkId?: string;
    section?: string;
  };
  instruction?: string;
  value?: string;
}
```

## Example: Character Change

用户：

```text
女主经历这一战后，变得外冷内热。
```

AI 输出：

```json
[
  {
    "kind": "object",
    "domain": "character",
    "entityId": "heroine",
    "file": "personality.md",
    "operation": "replaceBlock",
    "selector": {
      "block": "外在人格"
    },
    "instruction": "增加冷淡、克制、不轻易表达情绪的外在表现。"
  },
  {
    "kind": "collection",
    "domain": "state",
    "file": "state/characters.yaml",
    "operation": "yamlSet",
    "path": "characters.heroine.emotion",
    "value": "guarded"
  }
]
```

Apply Engine 生成 diff：

```diff
characters/heroine/personality.md

- 她在人前温柔坦率。
+ 她在人前冷淡克制，不再轻易表露真实情绪。
```

```diff
state/characters.yaml

- emotion: calm
+ emotion: guarded
```

## Example: Chapter Rewrite

章节是 Narrative Domain。

优先按 scene 修改。

```json
{
  "kind": "narrative",
  "domain": "chapter",
  "file": "chapters/volume-01/003.md",
  "operation": "replaceScene",
  "selector": {
    "scene": "Scene 2"
  },
  "instruction": "加强女主受伤后的心理描写，保留原剧情走向。"
}
```

如果没有 scene：

1. Markdown Engine 按 chunk 切分。
2. AI 选择 chunk。
3. Apply Engine 只替换该 chunk。

## Engine Components

### Markdown Engine

职责：

- parse frontmatter
- parse headings
- parse blocks
- split scenes
- split chunks
- serialize markdown

### YAML Engine

职责：

- parse YAML
- get path
- set path
- append node
- move node
- delete node
- validate schema

### Diff Engine

职责：

- generate unified diff
- collect touched files
- show preview

### Validator

职责：

- patch 是否只触碰允许文件。
- patch 是否符合 schema。
- patch 是否包含全文重写风险。
- patch 是否越过 Constitution 修改权限。
- patch 是否能 clean apply。

## Safety Rules

1. Never rewrite entire project.
2. Avoid rewriting entire large files.
3. Prefer one tool modifying one physical file.
4. Constitution updates must be proposal only.
5. Every write must produce diff before write.
6. Write only after explicit approval.
7. Validate YAML after changes.
8. Preserve Markdown frontmatter unless explicitly patched.

## Apply Engine API

建议第一版：

```ts
interface ApplyEngine {
  preview(patches: SemanticPatch[]): Promise<PendingAction>;
  apply(actionId: string): Promise<ApplyResult>;
  reject(actionId: string): Promise<void>;
}
```

底层能力：

```ts
replaceSection(file, section, content)
appendSection(file, section, content)
replaceBlock(file, block, content)
replaceChunk(file, chunkId, content)
yamlSet(file, path, value)
yamlDelete(file, path)
yamlAppend(file, path, value)
frontmatterSet(file, path, value)
```

## MVP Scope

第一版只需要实现：

- YAML `get/set/append/delete`
- Markdown frontmatter parse
- Markdown heading section parse
- `replaceSection`
- `appendSection`
- unified diff preview
- PendingAction memory store

章节级 chunk / scene 可以放到第二阶段。

## Future: Morph-like Apply Model

未来可以增加：

```text
LocalApplyEngine
    ↓
MorphApplyEngine
```

但 MVP 不依赖外部 Morph API。

先实现面向小说领域的 deterministic apply。

