# 1420 Play 素材转章节实施计划

1. 从当前结果报告选择素材；建立显式 Writing Reference 附件，收集保留事件、可改表达、POV、章节目标和篇幅方向。复用 1330 的下一章推导，抽出共享 Core helper。
2. 宿主冻结选中附件/报告、视角、转写意图、章节清单和有界正式上下文。模型只收到选中素材与这份固定上下文；输出完整章节的结构化段落和所引用的素材 id，宿主校验引用范围与章节格式。
3. 复用 CandidateChangeSet builder、prepared preview、PendingAction 与 materializer。增加 playChapterWriting 严格 origin，绑定全部输入；promotion 与 Accept（含 Backend 重启）内建重验来源、附件、章节清单/目标不存在和上下文 fingerprint。
4. Desktop 结果报告提供连贯转写面板，显示证据、目标、要求、生成进度与 diff；显式提交审批。Accept 后提供章节入口及整理本章建议，不自动再调用模型。
5. 覆盖空作品/续章、未选/hidden/兄弟分支、取消/Reject 零写入、来源或槽位漂移、detach、重启、auto-commit 开关和默认 SDK → HTTP/SSE → Desktop diff → Accept 旅程。更新任务文档并单独提交。
