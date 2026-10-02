# 参考资料：从导入到采纳

References 用来分析参考作品、提炼写作技巧，或整理世界、角色、关系、情节和时间线素材。导入参考作品后，它不会立即成为写作上下文，也不会自动变成你小说里的设定。

整个过程有两次独立的审阅：先批准发布分析结果，再决定是否把其中的故事素材采纳到自己的小说。只想参考技巧时，不必采纳故事素材。

## 导入一份文本

在工作台顶部打开 **References**（右侧页签名为 **Refs**），填写导入表单。

| 字段 | 填写方式 |
| --- | --- |
| Title | 一个方便查找的名称，例如「悬疑开场样本」 |
| Source type | 选择 Novel、Chapter sample、Style sample、Setting bible 或 Notes |
| Rights | 记录资料属于 Owned、Public domain、Licensed、Excerpt，或暂时 Unknown |
| Source path | 本机文本文件的路径；使用绝对路径更容易核对 |
| Paste source text | 也可以直接粘贴文本，适合短样本 |
| Original file name | 可选，用于标记粘贴文本的来源名称 |

文件按 UTF-8 文本读取，适合 TXT 和 Markdown。当前表单没有 PDF、Word 或 EPUB 转换功能。路径和粘贴文本选一种即可；两者都有内容时，使用粘贴文本。

在 **Allowed usage** 中记录允许用途：分析、风格启发、结构参考，以及不直接引用原文的约束。检查后点击 **Import reference**。这一步会在当前工作区保存参考资料副本和来源信息。

导入成功后，查看章节识别结果与边界置信度。**Enable reference preference after it becomes context eligible** 只表示将来允许使用的偏好，不表示新导入的原文已经进入 Copilot 上下文。

[![References 面板中的标题、来源类型、来源路径、粘贴文本与用途设置](/screenshots/references.jpg)](/screenshots/references.jpg)

图中是尚未导入资料的表单。导入结果、分析进度和素材采纳的截图将随对应实测补充。

## 先做小范围预览

1. 在资料列表中选择已导入的作品。
2. 在 **Deep Deconstruction** 中确认当前 Writing Profile 和即将生成的 outputs。需要调整分析目标时，先修改[写作配置](./settings.md)。
3. 点击 **Analyze preview** 创建预览，再点击 **Run bounded preview** 执行。
4. 阅读技巧预览、故事素材覆盖情况和证据。

如果章节边界置信度为 low，界面会要求再次确认检测到的范围。默认预览至多取前三个已识别章节。先确认这些章节确实是你要分析的内容，避免直接对错误分段做全量分析。

预览满足需要时可以停在这里。需要继续时，依次点击 **Continue full deconstruction** 和 **Confirm full deconstruction**。确认只建立完整分析计划，仍需继续执行下面的分析单元。

## 执行完整分析

在 **Full Deconstruction** 中点击 **Run next unit**。每次操作最多执行一个有范围限制的分析单元；根据进度继续点击，直到状态变为 **Analysis ready for review**。

| 控件 | 用途 |
| --- | --- |
| Run next unit | 执行下一个分析单元 |
| Pause between units | 在单元之间暂停 |
| Resume full analysis | 恢复已暂停或中断的分析 |
| Retry failed unit | 将失败单元重新排入执行队列 |
| Reconcile run | 上一次请求结果不明时，重新读取并核实服务端状态 |
| Cancel deconstruction | 取消当前拆解流程 |

分析使用创建任务时的 Profile 快照。中途修改当前 Profile，不等于改写已有任务的目标；要按新配置重新分析，创建新的预览。

## 看懂质量提醒，再发布

发布前会显示质量结论、覆盖率与诊断项。

| 结论 | 应如何处理 |
| --- | --- |
| Passed | 未发现该轮检查中的质量提醒；仍需阅读内容和差异 |
| Warned | 有非阻断提醒，例如类别缺失、不确定结论、措辞重合风险；检查对应条目和证据后决定是否发布 |
| Failed | 存在结构完整性问题；先处理阻断诊断，不能只忽略提醒继续发布 |
| Not evaluated | 尚未形成质量结论，继续完成分析步骤 |

出现非阻断提醒时，先展开 **Review … non-blocking warning(s)**。界面要求至少展开一次，之后才允许创建发布提案。

1. 点击 **Create publish PendingAction**。
2. 进入全局审批面板 **Approval**，使用 **Diff** 检查这次发布会新增、修改或删除哪些参考资料文件。下文将这一审阅流程简称为 Review。
3. 确认后 **Accept**，或者 **Reject** 保留现状。操作细节见[审阅与批准](./review.md)。

到 **Accept** 才发布这轮分析结果。分析完成、展开提醒和创建提案，都不等于已经发布。

> 截图待补：分析进度、质量提醒展开状态与发布审阅入口。

## 让技巧进入写作上下文

返回 References，点击 **Refresh**，检查所选资料的 **Writing context** 状态和 enabled 偏好。

写作技巧能否被使用，还取决于发布结果是否仍然有效、对应资料是否启用、当前写作任务与上下文预算。**Eligible** 表示具备被选择的条件，并不保证每次请求都会加载全部条目。

如果只发布了 **Story Materials**，界面可能显示技巧上下文 **Not generated**。这是因为没有生成 Technique 轨道，不代表故事素材发布失败。故事素材仍可在下方单独采纳。

原始参考作品与已采纳的小说设定用途不同。提问时可写明「只参考这份资料的悬念节奏」，并检查实际使用的上下文，避免把整份外部作品当作当前小说事实。

## 把故事素材采纳进自己的小说

在已发布资料的 **Adopt Story Materials** 中进行操作。

1. 在 **Published Story Materials** 勾选需要的条目，查看内容、置信度、不确定性与来源证据。
2. 核对每条 **Workspace target**。当前支持世界、角色、角色关系、大纲和时间线；时间线还会显示 YAML path。
3. 点击 **Preview adoption diff**，阅读目标文件、处理决定和具体差异。
4. 点击 **Confirm and create PendingAction**，再点击 **Review PendingAction**。
5. 在全局 Review 中再次检查后 **Accept**，才写入小说的正式文件。

目标建议只是起点，例如 `world/adopted/...` 或 `outline/main.md`。采纳前确认角色身份、所属世界和情节位置符合自己的作品，不要只看条目标题。

如果全部条目被跳过或已与当前文件一致，界面会说明没有生成 PendingAction。预览后原资料或目标文件发生变化时，应重新生成预览。

> 截图待补：素材选择、目标映射和采纳差异。

参考资料导入不等于把旧小说正文导入章节。旧稿整理与当前导入边界见[常见问题](./faq.md)。
