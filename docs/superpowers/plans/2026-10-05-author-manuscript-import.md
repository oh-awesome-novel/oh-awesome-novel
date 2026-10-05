# Author Manuscript Import Plan

Related task: [1300](../../tasks/1300.md).

## Design

旧稿导入是确定性作者操作：有界 Markdown 输入 → 无损拆分和目标映射 → 绑定输入与目标的预览 → immutable PendingAction → 作者 Accept。复用统一 ChangeSet/store/materializer，不增加 shell 执行或直接 canonical 写盘入口。

## Steps

- [x] Core：定义严格、有限的输入和映射合同；实现 Markdown/中文章节识别，处理 fenced code、前言、无标题及换行，保留原稿内容并校验 chapter schema。
- [x] Tools：实现 create-only deterministic producer，绑定输入、目标和 repository 基线，复用 final validators / store / materializer。
- [x] Backend：提供当前 workspace 下的 preview/propose，拒绝输入/映射/目标漂移与任意路径；保留 immutable preview 语义和错误信息。
- [x] Client：严格解析预览与提案返回，不接受未知字段、内部 artifact 路径或候选全文。
- [x] Vue：沿用现有工作台设计；分离输入/映射预览职责，以显式操作创建候选并进入既有审批；处理输入变化、加载/错误及 workspace 异步隔离。
- [x] Tests：拆章边界、内容保留、冲突/大小/路径、preview/propose/stale/Accept/Reject、autoCommit=false、Client DTO 与真实组件行为。
- [x] 验证跨模块回归、构建及文档检查，并记录实际测试范围；更新 task/index、稳定文档和 wiki。
