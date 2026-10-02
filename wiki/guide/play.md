# Play：先试演，再带回写作

Play 用来试走角色的行动、对话和事件后果。你可以先在独立会话里验证一场戏，再选择有用的结果带回 Writing。

Play 中的行动结果、角色认知和分支都属于该会话。它们不会自动改写正式章节、人物状态或时间线。

[![Play 工作区初始状态，左侧可点击 New session 新建会话](/screenshots/play.jpg)](/screenshots/play.jpg)

## 选择开局方式

从工作台顶部切换到 **Play**，在左侧创建一个新 session。先选择用途，再选择开局方式。

| 选择 | 适用场景 |
| --- | --- |
| Scene Rehearsal | 作为作者安排一场戏，逐个检查角色反应，必要时介入调整 |
| Immersive Journey | 以参与者身份进入世界，通过说话、观察、行动和等待推进 |
| Quick Start | 自己填写开场和角色信息，用较短流程开始 |
| Guided Start | 从真实工作区文件选择资料，确认来源与角色后再开始 |

尚未配置模型时，可以浏览已有会话；生成真实角色步骤或 Play 回合前需要完成[模型配置](./settings.md)。

[![创建 Play 会话时选择 Immersive Journey 或 Scene Rehearsal](/screenshots/play-new-session.jpg)](/screenshots/play-new-session.jpg)

## 用 Quick Start 准备一场戏

选择 **Scene Rehearsal → Quick Start**，依次填写三个步骤。

1. **Scene**：填写 Scene title、Location、Opening situation 和 Rehearsal objective。Risk 与 Atmosphere 用来补充风险和氛围，World activity 与 Event density 决定世界活动与事件密度。
2. **Cast**：添加参与角色，填写 Name、Position、Current goal 和 Initial knowledge。列表顺序就是初始角色行动队列，可上下调整。
3. **Review**：核对场景和角色后确认创建。

例如，开场可以写「暴雨封桥，两名旧识在渡口争夺最后一艘船」，试演目标写「验证双方是否会在不直接坦白秘密的情况下合作」。在 Initial knowledge 中分别写清每个人知道什么，能减少角色凭空知情的情况。

这些表单内容是你为本次试演提供的材料。创建场景不会把新角色写入正式角色档案。

[![Quick Start 的 Scene 表单，填写场景标题、地点、开场与试演目标](/screenshots/play-scene-setup.jpg)](/screenshots/play-scene-setup.jpg)

## 用 Guided Start 对齐现有小说

选择 **Guided Start**，按下面五步准备：

| 步骤 | 要检查的内容 |
| --- | --- |
| Sources | 勾选当前工作区已有的文件，确认它们与这次试演相关 |
| Entry | 填写开场、地点、时间、触发事件、目标与风险，选择支持开场的来源 |
| Identity | 沉浸模式填写 Player persona；试演模式填写 Director rehearsal purpose |
| Cast | 核对参与者、目标、位置、初始认知；可关联真实角色来源，也可使用作者提供的临时角色 |
| Review | 阅读 Launch Package 的来源证据和诊断，再确认开局 |

到 Review 仍只是预览。来源无效或诊断阻断时，返回对应步骤修正，再重新预览；不要把预览成功当作会话已创建。

> 截图待补：Guided Start 的 Sources 与 Launch Package 审阅。

## 逐步完成 Scene Rehearsal

在试演工作区，左侧是角色队列，中间是 **Actor Steps**，旁边可检查感知、事件和场景记忆。

1. 点击 **Begin rehearsal attempt** 开始一次尝试。
2. 点击 **Generate current actor step** 生成当前角色的反应。
3. 阅读对白、叙述和行动。满意时点击 **Accept**；需要另一个版本时点击 **Retry**。
4. 按需使用 **Modify**、**Insert actor** 或 **Grant knowledge**，调整当前试演。
5. 检查已选步骤后点击 **Finish**，在确认界面完成本次尝试；放弃本次尝试则选择 **Cancel**。

这里的 **Accept** 只接受一个试演步骤。**Finish** 才把所选步骤结算到 Play 会话；两者都不等于全局审批面板 **Approval** 中批准修改小说文件。下文的 Review 指向这一全局审阅流程。

重试产生的旧版本不会全部进入最终结果。Finish 使用当前选中的步骤序列。如果界面提示先前版本已被替代，检查留下的版本是否就是你需要的走向。

试演连续几步没有实质变化时，界面可能提示停滞。可以明确一个新的行动目标，也可以自然结束，不必为了继续运行而强加冲突。

> 截图待补：角色队列、生成步骤和导演控制按钮。

## 用 Immersive Journey 推进一回合

打开沉浸会话，在输入区选择行动类型：

| 操作 | 输入内容 |
| --- | --- |
| Say | 想对角色说的话 |
| Look | 想观察或调查的对象 |
| Move | 想前往的地点或移动方式 |
| Do | 想执行的行动 |
| Wait | 选择等待时长，可补充等待期间关注的事情 |

点击 **Act** 提交普通行动；Wait 使用 **Advance**。此输入区支持 `Cmd/Ctrl + Enter`。建议行动按钮会填入输入框，你仍可修改后再发送。

生成中的叙述是临时结果。只有回合完成并结算后，世界时钟、事件和状态才成为这个 Play 分支的已记录结果。需要停止时使用可用的 **Stop** 按钮，并等待界面确认最终状态。

在历史控制中可查看检查点、重命名、恢复或重试。恢复与重试改变所选 Play 路线，不是回滚小说的 Git 历史。

## 理解 Player 与 Director 视角

**Player** 按参与者可见的信息展示内容，**Director** 用于作者检查更完整的世界信息。传闻、未知事实和隐藏事件应按它们原有的不确定性理解。

切换到 Director 不会自动让场内角色知道秘密。需要在试演中赋予认知时，使用对应的导演控制，并核对授予对象与依据。

上下文检查区可查看来源与变动。正式文件后来发生变化时，旧会话可能提示来源漂移。先查看提示，再通过界面提供的选择处理；不要默认旧会话已自动读取最新的设定。

## 把试演结果带回 Writing

先结束或取消当前试演尝试，然后在 **Outcome Report** 点击 **Generate report**。报告只总结当前所选、已经完成的分支，不包含未选择的替代版本和生成中的草稿。

如果报告显示 **Report stale**，先刷新或重新生成。当前报告失效时，依赖报告的操作会被禁用。

### 方式一：作为下一次写作请求的参考

1. 在 Outcome Report 中选择需要的条目。
2. 在 **Use as Writing Reference** 中点击 **Create attachment**。
3. 切回 **Writing**，在 Copilot 的 **Play Writing References** 中勾选附件。
4. 写明要如何使用，例如「借用这次试演中和解失败的原因，重写当前章节的争执场景」，再发送请求。

附件只用于下一次请求；发送成功或切换对话后，选择会清空。创建附件不会修改正文，后续生成的小说修改仍要经过[审阅与批准](./review.md)。

### 方式二：准备正式文件的采纳提案

1. 从事件、观察或结果条目进入 **Bring to writing**。
2. 选择 **Canonical target**：Chapter draft、State、Timeline 或 Foreshadow。
3. 检查系统建议的目标与内容。当前表单使用 **Editable JSON payload** 表达待采纳数据，修改时保留合法的 JSON 对象格式。
4. 点击 **Preview canonical diff**，核对目标文件和完整差异。
5. 点击 **Confirm and create PendingAction**，再进入 **Review PendingAction**。
6. 在全局 Review 中 **Accept**，正式文件才会改变。

修改目标或 payload 后需要重新生成预览。章节、状态、时间线和伏笔各有自己的格式约束；若预览报错，根据具体提示修改，不要直接把 Play 对话粘进结构化文件。

> 截图待补：Outcome Report、Writing Reference 附件与正式采纳预览。

## 生成中断后

网络中断或窗口重新连接时，先按页面的恢复提示核实服务端状态。出现回合结果未知、需要刷新或 actor-step recovery 的提示时，完成恢复后再继续生成。重试前先确认上一次是否已经完成，避免把同一个行动提交两次。

保留具体错误信息和会话名称，便于区分模型配置问题、来源变化与生成中断。通用排查见[常见问题](./faq.md)。
