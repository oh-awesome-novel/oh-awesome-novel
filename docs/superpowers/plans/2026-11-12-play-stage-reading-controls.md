# 1590 舞台沉浸阅读控制实施计划

对应 task：[1590](../../tasks/1590.md)。只改 Desktop UI；不改 Play 协议、会话存储与名册格式，模型零调用。

1. `usePlayStageReadingPrefs`：字速（字/秒）、自动间隔、对话框不透明度、打字效果开关，记在 `localStorage` 的 `oan:play:stage-reading`（应用界面偏好，所有工作区共用），读入时夹到合法范围。
2. `VisualNovelTextBox`：字速与不透明度由外部传入；按“句子标识”重置打字进度，流式草稿在同一句内继续保留已显示的前缀；第一击补全、第二击下一句；打字完成时通知舞台。`prefers-reduced-motion` 或关闭打字效果时直接显示整句。
3. `VisualNovelStage`：
   - 句子序列 = 作者行动（如有）+ 该回合的 `StageSnapshot.beats`。作者行动取紧邻该回合之前的 `user` 消息，草稿阶段取进行中回合的行动；名字牌用名册里 `isPlayer: true` 的角色名，否则“你”，不加立绘。
   - 快捷菜单：自动（句子显示完后按“自动间隔 + 句长”等待再前进，到回合末或选项处停住）、快进（跳到当前已有的最后一句）、回看、隐藏界面（`H` 或右键，任意点击 / 按键恢复）、全屏（Fullscreen API，`Esc` 退出）、设置。键盘 `A / S / L / H / F`，`Esc` 依次关闭设置、回看、恢复界面、退出只读回看。
   - 滚轮下翻前进一句、上翻打开回看；面板和输入框内的滚轮不拦截。
   - 草稿提交成正式回合时保留阅读位置，不从头重播。
   - 说话者立绘高亮并前移，其余变暗；名字牌颜色优先用名册 `looks.nameColor`（`#RRGGBB`），没有时沿用文本哈希色。
   - 背景、场景名与立绘进出场淡入淡出；reduced motion 下关闭全部过渡。
4. `VisualNovelLog`：按回合分组列出名字牌 + 句子，点击某句只读跳回该回合该句；“加载更早回合”沿用 `loadEarlier`。
5. `VisualNovelSettings`：四项设置的表单。
6. 舞台外壳只在回合仍在进行时把草稿与行动交给舞台；停止或失败后草稿从舞台撤下，选项恢复可用。
7. 测试：`visual-novel.test.ts` 补自动、快进、隐藏界面、按句回看、字速、连点、作者行动、`nameColor`、reduced motion；`play-stage-mode.test.ts` 按新行为调整。

## 会失效的数据

无。
