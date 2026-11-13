# 1630 图片资源目录与路径引用实施计划

对应 task：[1630](../../tasks/1630.md)。不改 Sandbox Change Engine 的任何合同、类型与文档。

## 决定

- **目录**：工作区根下的 `assets/`，立绘在 `assets/portraits/<角色 id>/`。路径形状固定为 `assets/<…>/<文件名>.(png|jpg|jpeg|webp)`，每段只含 ASCII 字母、数字、`_`、`-`，不以 `.` 开头。
- **Git 忽略**：新工作区的 `.gitignore` 增加 `/assets/`。已有工作区不改它的 `.gitignore`（那是需要审批的工作区文件）：作者第一次导入图片时，如果 Git 还没有忽略 `assets/`，宿主把 `/assets/` 追加到本机的 `.git/info/exclude`。这个文件不进提交、不属于小说内容，效果只在本机，与“图片不随 Git 走”一致。作者已经提交进 Git 的图片不受影响。
- **只新增不覆盖**：以独占方式创建文件；同名时在文件名后加 `-2`、`-3`…；同一目录里已有内容相同的文件时直接复用，不再写入。
- **校验**：只接受 PNG / JPEG / WebP，文件签名必须与扩展名一致；单文件上限 16 MiB；逐级检查目录不是符号链接，文件以 `O_NOFOLLOW` 打开且必须是单链接的普通文件。
- **传输**：导入用原始字节的 `POST`（不走 base64 JSON），读取返回原图字节。界面用带令牌的 `fetch` 取回后转成对象 URL 显示。
- **未引用图片**：列出 `assets/` 下没有被任何正式文本文件（章节、角色、世界观、状态、时间线、伏笔、摘要、大纲）提到路径的图片；删除只对未引用的图片开放，由作者在界面上逐张确认。
- **Agent 不可见**：变更引擎的投影只包含固定的正式目录，`assets/` 不在其中；全局搜索与写作上下文同理。用测试固定这一点，不改引擎代码。

## 步骤

1. Core `image-assets.ts`：路径校验、签名识别、列出 / 存入 / 读取 / 未引用 / 删除；`workspace.ts` 的初始 `.gitignore` 加 `/assets/`。
2. Tools `ensureGitLocalExclude`：按上面的规则写 `.git/info/exclude`。
3. Backend `image-assets.ts`：五个接口，错误码映射为 400 / 404 / 409 / 413 / 415。
4. Client：对应方法与返回值校验。
5. Desktop：`ImageAssetView.vue`（按路径显示原图，缺失或损坏时显示占位与原因）与 `ImageAssetPanel.vue`（按角色列出、导入、查看未引用并删除），从 Play 顶栏进入。
6. 文档：FILESYSTEM_SPEC 增加图片资源目录一节，PLAY_LOCAL_SCENERY 补充说明。
7. 测试：Core（忽略、改名、去重、各类拒绝、未引用）、Tools（exclude 与投影不含 `assets/`）、Backend（HTTP 旅程，导入前后正式文件与 PendingAction 不变）、Client、Desktop（占位与面板）。

## 留给 1600 的部分

舞台与角色立绘表单改为按路径读取原图是 1600 的范围；本任务提供它们要用的接口和 `ImageAssetView`。既有的 `looks.refImagePath` 与场景图读取方式不变。

## 会失效的数据

无。
