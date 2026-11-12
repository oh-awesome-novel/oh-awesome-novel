# 截图与更新说明

本文档的界面截图采集于 **2026 年 10 月 1 日至 11 月 12 日**，来自仓库中的真实桌面前端和本地后端。10 月 1–2 日使用 `examples/simple-novel` 的独立临时副本，10 月 5 日使用全新空白临时小说，11 月的采集也使用隔离演示数据；截图不包含私人小说、真实 API Key 或个人全局配置。

10 月 2 日基于 `c7701d8` 重新构建后端，补齐搜索、正文导出、上下文与用量、正常 Git 历史和章节结算审批截图。新增截图来自独立浏览器窗口，保留实际中英文界面；较大的截图可点击指南下方的原图链接查看。

11 月 12 日按 `1b9ad8e` 构建实际应用，补拍近期 Play、Writing 与参考素材功能。图片裁剪到对应操作面板，保留真实文字与状态；没有用合成界面替代应用截图。

## 已收录的界面

| 图片 | 界面与状态 |
| --- | --- |
| [项目入口](/screenshots/launcher.jpg) | 项目列表中的 Simple Novel 演示工作区 |
| [模型设置](/screenshots/model-settings.jpg) | 首次配置模型的表单，API Key 为空 |
| [写作工作区](/screenshots/workspace.jpg) | 文件树、Copilot、快捷写作命令 |
| [章节阅读](/screenshots/chapter-reader.jpg) | 章节列表及只读正文预览 |
| [审批入口](/screenshots/approval.jpg) | Approval 面板，当前没有待审批修改 |
| [参考资料](/screenshots/references.jpg) | References 导入表单 |
| [写作配置](/screenshots/writing-profiles.jpg) | 内置 Writing Profiles |
| [推演工作区](/screenshots/play.jpg) | 尚无会话的推演入口；2026-11-10 |
| [新建推演会话](/screenshots/play-new-session.jpg) | 选择沉浸推演或场景试演；2026-11-10 |
| [场景试演设置](/screenshots/play-scene-setup.jpg) | 快速开局的场景表单示例，未启动试演；2026-11-10 |
| [引导开局确认](/screenshots/play-guided-review.jpg) | 开局包只读预览与来源依据，尚未创建会话；2026-11-10 |
| [场景试演步骤](/screenshots/play-rehearsal-steps.jpg) | 角色行动顺序与一个尚未提交的角色步骤（受控演示模型）；2026-11-10 |
| [带要求重演](/screenshots/play-retry-guidance.jpg) | 导演视角下世界线显示重演要求（受控演示模型）；2026-11-10 |
| [带回写作表单](/screenshots/play-adoption-form.jpg) | 时间线采纳表单与实际 diff，尚未创建待确认改动；2026-11-10 |
| [复用开局](/screenshots/play-launch-reuse.jpg) | 来源重新核对后的只读确认页，尚未创建新会话；2026-11-12 |
| [原作走向与关系](/screenshots/play-canon-relationships.jpg) | 当前分支的节点状态、依据和关系事件（受控演示回合）；2026-11-12 |
| [世界线比较](/screenshots/play-worldline-compare.jpg) | 两条演示分支的行动、地点状态和独有事件差异；2026-11-12 |
| [综漫融合契约](/screenshots/play-crossover-contract.jpg) | 两部演示作品的融合方式、初始认知与规则裁定表单，未创建会话；2026-11-12 |
| [角色贴合度](/screenshots/play-character-check.jpg) | 受控意见经过逐字引文核验，尚未重演或保存观察笔记；2026-11-12 |
| [阶段历史查回](/screenshots/play-phase-recall.jpg) | 确定性关键词检索当前分支原文，未调用模型筛选证据；2026-11-12 |
| [Play 用量检查器](/screenshots/play-usage-inspector.jpg) | 真实记录链路展示受控模型的固定 token 字段，不代表真实消耗；2026-11-12 |
| [Play 转章节 Diff](/screenshots/play-chapter-diff.jpg) | 新建下一章的真实待审批候选，未 Accept；2026-11-12 |
| [审稿依据与裁决](/screenshots/chapter-review-evidence.jpg) | 原句、世界规则依据、允许修订行及作者“保留原文”的裁决；2026-11-12 |
| [修改影响分组](/screenshots/revision-impact.jpg) | 旧 Git 版本与当前角色卡比较，区分来源依赖、引用和历史读取；2026-11-12 |
| [参考素材预检](/screenshots/reference-adoption-preflight.jpg) | 类型筛选、目标映射和非法目标提示；2026-11-12 |
| [Git 面板](/screenshots/git.jpg) | 临时副本尚未初始化 Git 的提示 |
| [正文搜索](/screenshots/search-results.jpg) | 搜索“米拉”的真实结果；2026-10-02 |
| [正文导出](/screenshots/manuscript-export.jpg) | Markdown / TXT 下载入口和导出范围说明；2026-10-02 |
| [旧稿导入已接受](/screenshots/manuscript-import-accepted.jpg) | 无模型配置的临时小说完成两章Markdown导入，已Accept且autoCommit关闭；2026-10-05 |
| [上下文与用量](/screenshots/usage.jpg) | 无模型请求的空记录状态及 Estimated / Actual 说明；2026-10-02 |
| [Git 历史](/screenshots/git-history.jpg) | 独立演示仓库的真实初始提交，状态 clean；2026-10-02 |
| [章节结算审批](/screenshots/chapter-settlement.jpg) | 正式确定性构建器生成的两文件 PendingAction，尚未接受；2026-10-02 |
| [结算 Diff](/screenshots/review-diff.jpg) | 同一候选的结构化文件清单与真实 Diff；2026-10-02 |

::: info 截图的范围
截图展示当前界面及操作入口。10 月 1 日的 `approval.jpg`、`git.jpg` 保留审批空列表和 Git 未初始化状态。10 月 2 日新增的结算截图通过产品公开的确定性构建器和 PendingAction store 生成真实候选：新增 `state/chapters/0001/0001.yaml`，更新 `summaries/chapter/0001/0001.md`。观察输入为文档演示所提供，经过章节 hash、逐行 quote 和候选校验，不是模型生成结果。

两次采集均未请求真实模型、未点击 Accept、未修改演示小说的已提交正文。没有伪造模型回复、Actual 用量、拆书结果或 Play 回合。新的 Git 截图来自临时副本自己的初始提交，与本项目的开发历史无关。

2026-10-05另行验收作者旧稿导入：从空临时小说开始，使用显式输入的两章演示文字，真实执行预览、重复章号冲突、重映射、创建PendingAction和Accept。Accept前章节目录为空，之后两章原文保留；关闭autoCommit时Git仍仅有基线提交。没有配置或调用模型，也没有修改仓库示例小说。

2026-11-10 的推演截图在示例小说的临时副本上采集，界面为中文作者语言。引导开局、新建会话与场景表单不涉及模型。场景试演步骤、带要求重演和带回写作三张图中的叙述、角色步骤与候选行动来自受控演示模型（后端测试用的固定回复），不是真实模型的输出，只用于展示界面和流程；回合、存档点、结果报告与采纳预览均由真实后端按正常流程生成。采集中创建的待确认改动没有被接受，示例小说的正式文件没有改变。

2026-11-12 使用独立临时 Git 仓库「雾港来信 · 文档演示」，通过正常 Client / HTTP / SDK 链路创建回合、恢复起点形成分支、生成报告、角色检查和章节候选；模型边界使用 `MockLanguageModelV4` 固定回复。用量字段同样来自该受控模型，不能作为真实 provider 或缓存账单证据。章节转写和局部修订只创建 PendingAction，没有 Accept，演示正文保持原样。

参考素材截图使用同一临时工作区中的原创短文本，通过既有 Backend 测试的受控生成回调完成拆解；仅接受了演示参考资料的发布。素材采纳演示先被非法目标拦下，改为合法目标后通过预检并生成真实 Diff，未接受写入小说的候选。所有候选与内部记录均由产品公开接口产生，没有手写内部 JSON 来伪造成功状态。
:::

![写作工作区截图](/screenshots/workspace.jpg)

## 更新截图

### 1. 准备独立演示数据

在仓库根目录执行以下命令，从已提交的示例中创建临时副本。使用独立全局配置目录，不要使用 `examples/global` 或日常创作的配置目录。

```bash
OAN_SCREENSHOT_DIR="$(mktemp -d /tmp/oan-docs-capture.XXXXXX)"
mkdir -p "$OAN_SCREENSHOT_DIR/global"
git archive HEAD examples/simple-novel | tar -x -C "$OAN_SCREENSHOT_DIR"
```

保持该终端打开，后续后端命令使用同一个 `OAN_SCREENSHOT_DIR`。

如需展示正常 Git 历史，仅在这个临时副本中初始化 Git、忽略 `.workspace/` 与 `.oan/sessions/`，并使用演示身份提交示例基线。不要把开发仓库或日常小说的 Git 历史带入截图。

### 2. 启动应用

如果已有可用构建，可直接启动 HTTP 后端。没有构建时，先按开发环境的要求安装依赖，并执行：

```bash
npm run build --workspace @oh-awesome-novel/http-backend
```

启动隔离后端：

```bash
node apps/http-backend/dist/index.mjs \
  --workspace "$OAN_SCREENSHOT_DIR/examples/simple-novel" \
  --global-config-dir "$OAN_SCREENSHOT_DIR/global" \
  --host 127.0.0.1 \
  --port 3317
```

在另一个终端、仓库根目录启动前端：

```bash
VITE_OAN_BACKEND_PROXY_TARGET=http://127.0.0.1:3317 \
  npm run dev --workspace @oh-awesome-novel/desktop-ui -- \
  --host 127.0.0.1 --port 5317 --strictPort
```

浏览器打开 `http://127.0.0.1:5317/`。若这些端口已占用，选择其他空闲端口，并同时调整代理地址。

如果正有其他开发工作导致项目暂时不能运行，可先更新文字，等应用恢复后再补截图；不要为了截图修改产品代码。

### 3. 采集真实页面

1. 先截取项目列表和空白模型配置页。
2. 若进入时出现模型配置窗口，可点击「稍后配置」只读浏览。本次截图使用了临时 Ollama Provider：模型名为 `demo-model`，Base URL 为 `http://127.0.0.1:1/v1`，用于展示已填写配置后的界面。这只是离线演示值，不能用于实际创作；不要点击模型检测、获取模型或发送请求。
3. 依次打开章节、Search、Export manuscript、上下文与用量、Approval、References、Writing Profiles、Git 和 Play 页面。说明截图展示的是空态、填写中的表单还是已完成操作。
4. 图片保存到 `wiki/public/screenshots/`，在 Markdown 中用 `/screenshots/文件名.jpg` 引用。保持图片为真实界面，不加入伪造的生成内容或审批结果。
5. 检查文字清晰、页面加载完整，确认没有真实凭据或个人路径。更新采集日期，并执行文档构建检查图片链接。
6. 完成后停止本次启动的前后端服务。

### 4. 确定性章节结算演示

本次结算截图使用公开包入口的 `createChapterSettlementSource`、`createWorkspaceProjection`、`readRepositoryBaseline`、`createChapterSettlementChangeProposal` 和 `createPendingActionStore().proposeCandidate()`。输入绑定 `chapters/0001/0001.md` 的实际 SHA-256、原文件行号和逐字 quote，候选由产品构建器生成，未直接写内部 JSON 或 draft 文件来伪造状态。

复现时可参考仓库 `__test__/tools/src/chapter-settlement.test.ts` 的公开 API 组合，把 Accept 测试步骤省略；候选标题和说明应明确标记“确定性演示”。通过 UI 的 Approval → Diff 查看结果，确认 Git 仍然 clean，且目标候选尚未落盘。不要把这种演示输入写成模型已成功完成结算。

若要补充模型生成的拆书、完整上下文与 Actual 用量或 Play 回合，应另用有授权的演示模型和示例数据，并按产品的审批流程操作。

### 5. 近期功能的受控演示

11 月 12 日的演示组合参照以下已有根目录测试，使用公开包入口搭建临时数据、真实后端和原有前端。只在模型或专用生成回调边界提供固定回复，不在浏览器中替换 API 响应、界面文字或审批状态。

| 操作 | 仓库内的复现参考 |
| --- | --- |
| 原作节点、关系、检查与比较 | `__test__/desktop-ui/src/play-canon-beats-sdk-journey.test.ts`、`play-relationship-panel-sdk-journey.test.ts`、`play-character-check-sdk-journey.test.ts`、`play-worldline-compare-journey.test.ts` |
| 融合契约、开局复用 | `__test__/desktop-ui/src/play-crossover-journey.test.ts`、`play-launch-reuse-journey.test.ts` |
| 用量与阶段回忆 | `__test__/desktop-ui/src/domain-usage-sdk-journey.test.ts` |
| 转章节、审稿 | `__test__/desktop-ui/src/play-chapter-writing-journey.test.ts`、`chapter-review-journey.test.ts` |
| 影响分析 | `__test__/backend/src/revision-impact.test.ts` |
| 参考素材预检、采纳预览 | `__test__/backend/src/reference-deconstruction-full.test.ts` 中的 Story Material adoption / preflight 用例 |

启动演示前后核对临时仓库的 tracked 文件状态；采纳预览和 PendingAction 不能改变正式目标。若为了展示已发布参考材料而 Accept，必须仅操作隔离演示仓库，并在图注写清接受了什么。不要把受控回复的流程验证描述为真实模型的文学质量验收。

## 待补：共创工坊与视觉小说/LINT 操作

Forge、剧情归档预览、视觉小说、本地图片与 LINT 仍缺完整应用演示截图。11 月 12 日已补阶段原文检索等近期入口，不代表这些旧待补项也已完成；测试或演示夹具的截图不作为真实模型成功或正式入库的证据。
