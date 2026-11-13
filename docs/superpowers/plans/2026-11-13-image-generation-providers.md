# 1640 生图服务配置与适配器实施计划

对应 task：[1640](../../tasks/1640.md)。不写任何小说正式文件，不被 Play 调用；配置、API Key、工作流和请求记录都只在应用级全局配置目录。

## 决定

- **首批在线服务**（规划 §4 第 3 项）：`openai` 与 `openai-compatible` 两类，用仓库已安装的 `@ai-sdk/openai`、`@ai-sdk/openai-compatible` 的图片模型，经 AI SDK `generateImage` 调用。不新增依赖，notices 不变。其他服务（如需要专用 provider 包的）以后按固定版本另行引入。
- **配置** `image-providers.json`（全局配置目录，0600，原子写入）：`id`、`kind`（`comfyui` / `openai` / `openai-compatible`）、显示名、地址、模型（仅在线）、默认宽高、默认负面词、超时（5–600 秒）、`allowRemote`（仅 ComfyUI）、`apiKey`、工作流记录、最近一次错误。返回给前端的配置去掉 `apiKey`，只带 `hasApiKey`。已保存的 Key 只跟着原来的地址（origin）；改了地址又没重新填 Key 时拒绝保存。
- **ComfyUI 地址**：默认只接受 loopback（`localhost`、`*.localhost`、`127.0.0.0/8`、`::1`）。其他地址要勾选“允许远程”才能保存；出图和测试时再检查一次。地址只接受 http(s)，不得带账号、查询或片段。
- **工作流**：导入 ComfyUI 的 API 格式 JSON（≤ 1 MiB），原文存到全局配置目录 `image-workflows/<服务 id>.json`，配置里只记 SHA-256、占位映射和可填的项目。七个项目：正向 / 负向提示词、种子、宽、高、张数、LoRA 文件名。两种声明方式可以混用：映射到“节点 id + 输入名”，或在工作流里写 `{{positive}}` 这样的占位符；整个值就是一个占位符时按数字填入。导入时检查：映射指向的节点和输入必须存在，正向提示词必须有去处，编辑器保存格式（非 API 格式）直接拒绝。出图时只改声明过的地方，其他节点原样发送。工作流原文不返回给前端。
- **ComfyUI 流程**：`POST /prompt` → 按间隔轮询 `GET /history/{id}` → 逐张 `GET /view`；超时或取消时 `POST /interrupt`；连通测试用 `GET /system_stats`。填了 API Key 时以 `Authorization: Bearer` 发送（给套了鉴权反代的 ComfyUI 用）。不跟随重定向。
- **在线流程**：`generateImage({ model, prompt, n, size, seed, maxRetries: 0 })`。不重试，避免作者不知情地被多计一次费。负面词不发给在线服务（这类接口一般没有对应参数）。连通测试不发真实请求（按张计费），只确认配置完整，并在界面上说明。
- **统一约束**：每次最多 4 张；边长 64–4096；单张 ≤ 16 MiB；按文件头确认是 PNG / JPEG / WebP，否则算返回格式错误；提示词 ≤ 4000 字。
- **错误分类**：`unreachable`、`auth`、`timeout`、`content_rejected`、`invalid_response`、`workflow`（工作流缺失、被 ComfyUI 拒绝或执行出错）、`cancelled`、`config`。
- **请求记录**：全局配置目录 `image-generation-log.jsonl`，每次出图一条，成功、失败、取消都记：服务 id 与类型、模型、地址 origin、是否本机、请求张数与尺寸、耗时、结果、错误类别、返回张数。记录有固定字段白名单，写入前校验，多出任何字段（提示词、Key）都会被拒绝。超过 2 MiB 时只保留最近 1000 条。
  - 没有写进 1110 的 `usage-stats.jsonl`：那份记录按工作区和会话存放、以 token 为单位，而生图设置不属于任何工作区。沿用的是它“只记去向与结果、不记内容”的做法。
- **提示词组合**（纯函数 `composePortraitPrompt`）：顺序固定为 LoRA 触发词、角色 tags、服装 tags、立绘自己的 prompt；重复的 tag 只留第一次；`useCharacterTags: false` 时不带名册 tags 和触发词；负面词是立绘的在前、服务默认的在后。供 1650 使用。
- **接口**：`GET/POST /api/image-providers`、`DELETE /api/image-providers/:id`、`POST …/:id/check`、`POST …/:id/generate`（返回 base64 图片，请求断开即取消）、`GET /api/image-generation/log`。
- **设置页**：放在启动页“模型”页的下方，一个“生图服务”区：列表、增删改、导入工作流与映射、测试连通、最近一次错误。远程 ComfyUI 地址要勾选确认；导入工作流处写明它会在作者的 ComfyUI 上原样执行。

## 步骤

1. Core `image-provider.ts`：类型、配置规范化与脱敏、请求约束、提示词组合、工作流检查与填充、记录校验。
2. Agent：`createAiSdkImageModelResolver`。
3. Backend `image-generation.ts`：配置读写、两个适配器、记录、HTTP 处理器；`NovelBackendOptions` 增加 `resolveImageModel`、`comfyPollMs`（测试用）。
4. Client `image-providers.ts`：方法与响应校验（带 Key 的响应直接拒绝）。
5. Desktop `ImageProviderSettings.vue`。
6. 文档：用户手册设置页、任务状态。
7. 测试：Core 纯函数；Backend 用本机 mock ComfyUI 服务与 `MockImageModelV4`；Client；Desktop。

## 会失效的数据

无。全部是新文件。
