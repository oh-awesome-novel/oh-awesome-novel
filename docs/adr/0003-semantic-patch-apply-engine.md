# ADR 0003: SemanticPatch Apply Engine

## Status

Accepted

## Context

AI 编辑文件常见方案有两个问题：

1. 全文重写容易破坏无关内容。
2. Search / Replace 对空白、重复文本、上下文漂移很脆弱。

对话后期参考 Morph Fast Apply 的思想，决定将“修改意图”和“应用修改”拆开。

## Decision

AI 不直接输出完整文件或行号 patch。

AI 输出：

```text
SemanticPatch[]
```

Apply Engine 负责：

```text
SemanticPatch
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

用户确认后才写入。

## Patch Types

- ObjectPatch: Character、World、Constitution。
- CollectionPatch: State、Timeline、Foreshadow。
- NarrativePatch: Chapter、Summary。

## Consequences

优点：

- 修改粒度小。
- diff 清晰。
- 文件格式更稳定。
- 更符合小说领域结构。

代价：

- 需要实现 Markdown / YAML semantic parser。
- 需要为每个领域定义 patch 操作。
- 需要验证 patch 是否越权。

## Long-Term Direction

Apply Engine 可以先 deterministic 实现。

未来可选接入 Morph-like apply model。

