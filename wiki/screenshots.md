# 截图与更新说明

本文档的界面截图采集于 **2026 年 10 月 1 日至 2 日**，来自仓库中的真实桌面前端和本地后端。使用的是 `examples/simple-novel` 的独立临时副本；截图不包含私人小说、真实 API Key 或个人全局配置。

10 月 2 日基于 `c7701d8` 重新构建后端，补齐搜索、正文导出、上下文与用量、正常 Git 历史和章节结算审批截图。新增截图来自独立浏览器窗口，保留实际中英文界面；较大的截图可点击指南下方的原图链接查看。

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
| [Play 工作区](/screenshots/play.jpg) | 尚无会话的 Play 入口 |
| [新建 Play 会话](/screenshots/play-new-session.jpg) | 选择 Immersive Journey 或 Scene Rehearsal |
| [场景排演设置](/screenshots/play-scene-setup.jpg) | Scene Rehearsal 的 Scene 表单示例，未启动排演 |
| [Git 面板](/screenshots/git.jpg) | 临时副本尚未初始化 Git 的提示 |
| [正文搜索](/screenshots/search-results.jpg) | 搜索“米拉”的真实结果；2026-10-02 |
| [正文导出](/screenshots/manuscript-export.jpg) | Markdown / TXT 下载入口和导出范围说明；2026-10-02 |
| [上下文与用量](/screenshots/usage.jpg) | 无模型请求的空记录状态及 Estimated / Actual 说明；2026-10-02 |
| [Git 历史](/screenshots/git-history.jpg) | 独立演示仓库的真实初始提交，状态 clean；2026-10-02 |
| [章节结算审批](/screenshots/chapter-settlement.jpg) | 正式确定性构建器生成的两文件 PendingAction，尚未接受；2026-10-02 |
| [结算 Diff](/screenshots/review-diff.jpg) | 同一候选的结构化文件清单与真实 Diff；2026-10-02 |

::: info 截图的范围
截图展示当前界面及操作入口。10 月 1 日的 `approval.jpg`、`git.jpg` 保留审批空列表和 Git 未初始化状态。10 月 2 日新增的结算截图通过产品公开的确定性构建器和 PendingAction store 生成真实候选：新增 `state/chapters/0001/0001.yaml`，更新 `summaries/chapter/0001/0001.md`。观察输入为文档演示所提供，经过章节 hash、逐行 quote 和候选校验，不是模型生成结果。

两次采集均未请求真实模型、未点击 Accept、未修改演示小说的已提交正文。没有伪造模型回复、Actual 用量、拆书结果或 Play 回合。新的 Git 截图来自临时副本自己的初始提交，与本项目的开发历史无关。
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
