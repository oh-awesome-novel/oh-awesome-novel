# 1600 角色立绘描述与预设立绘集实施计划

对应 task：[1600](../../tasks/1600.md)。不生图、不改任何图片文件；不改 Play 冻结前缀与回合请求。

## 决定

- **字段**：`roster-profile.yaml` 增加可选 `portraits: { default, items[] }` 与 `looks.nameColor`。校验放在 Core `normalizeRosterCharacter`，final validator 与会话读取共用同一份规则。立绘项只接受已知字段，拼错的键会被拒绝。上限：每角色 24 项，`label` ≤ 16 字，`description` ≤ 500 字，`usage` ≤ 200 字，提示词各 ≤ 2000 字。
- **会话记录**：创建会话时写 `metadataExtensions.characterPortraitSets`：每个角色的默认项、最多 8 张立绘的 `id / label / description / usage / image`，有图的再记内容 SHA-256；读不到的图片只是没有哈希。超出 8 张的项记入 `skipped`。默认项总在前 8 张之内。图片字节不进会话。原有 `characterPortraits`（`refImagePath` 的 256 KiB 快照）照旧生成。
- **舞台**：角色有立绘集时显示其默认项——有图走 1630 的读取接口显示原图，哈希与开局时不同则标注“开局后已更换”，缺失或损坏显示名字剪影与原因；无图项显示名字剪影，悬停可看描述。没有立绘集的角色仍用原来的快照。
- **表单**：放在 Play 顶栏的“图片资源”面板里（目前没有独立的角色页），选中角色后编辑立绘集与名字牌颜色。保存走确定性候选：只改 `characters/<id>/roster-profile.yaml` 一个文件，用 YAML 文档接口改写 `portraits` 与 `looks.nameColor`，保留其余内容与注释；通过 `proposeCandidate` 生成 PendingAction，不新增 origin 类型。角色还没有 `roster-profile.yaml` 时不能保存，提示先用工坊生成或自己建立名册。
- **提醒不拦截**：`image` 指向的文件不存在时照常生成候选，表单提示。
- **Forge**：计划里的角色可带可选 `portraits`（`id / label / description / usage`，最多 4 项，不含图片），写入名册；旧计划没有该字段时输出不变。

## 步骤

1. Core：名册字段与校验；会话记录立绘集。
2. Tools：`createRosterPortraitsChangeProposal`。
3. Backend：`GET /api/workspace/characters/:id/portraits`、`POST …/portraits/propose`；Forge 计划解析与写入。
4. Client：两个方法与返回值校验。
5. Desktop：`CharacterPortraitForm.vue`；舞台按立绘集显示；`ImageAssetView` 增加哈希比对。
6. 文档：FILESYSTEM_SPEC、PLAY_LOCAL_SCENERY；关闭 1630 留下的复核项。
7. 测试：各层单测与“编辑立绘 → Accept → 新开会话 → 舞台显示”旅程。

## 会失效的数据

无。已有会话没有 `characterPortraitSets`，舞台沿用原来的显示。
