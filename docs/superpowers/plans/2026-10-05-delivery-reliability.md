# Delivery Reliability Implementation Plan

Related task: [1310](../../tasks/1310.md)

2026-10-05：承接0580、0005与1280已有实现，修复交付门禁和显式提交的正确性，不重建发布链路。

## 1. Type safety and quality gate

- [x] 对全部生产 TS workspace 建立可执行 typecheck；按 Node/Electron 实际运行时补齐 ES2023/Node 声明，修正真实联合类型与 SDK 合同错误。
- [x] 保留严格选项，不用 any、ts-ignore 或关闭 strict 隐藏诊断。
- [x] 先按依赖顺序构建，再检查类型和顺序执行七个测试 workspace，避免重复清理 dist 与资源竞争。
- [x] PR/main 接入共用质量 workflow；发行等待质量门禁，并使用其输出的精确 commit 构建。
- [x] 文档术语/任务状态一致性和 Wiki 构建进入质量命令。

## 2. Reviewed Git commit

- [x] 独立 index 预览形成有界、短期的不可变快照；身份包含 workspace/repository、HEAD/branch、真实 index、selected paths/bytes/modes 和批准的 tree。
- [x] Backend 只接受自己持有的预览凭证；客户端不能提供 tree 或 snapshot 内容作为提交权威。
- [x] 提交前重验绑定，保护真实 index 并使用已批准的 tree；用 HEAD CAS 避免覆盖并发历史，绝不重新 stage 工作树。
- [x] 失败显示明确错误；UI 禁止重复操作、失效预览提交和旧 workspace/选择的异步响应。
- [x] 覆盖文件/index/HEAD 漂移、晚到编辑、特殊路径、rename/delete/mode、过期凭证与正常提交。

## 3. Packaged writing journey

- [x] 打包测试只写入临时 workspace/config，使用隔离 Git identity 与本地确定性 provider。
- [x] 真实 packaged Backend/SDK/SSE 产生内存候选，检查 preview 前后 canonical 不变；真实 renderer/preload 审阅与 Accept。
- [x] 验证 Git 历史、Markdown/TXT 导出和重启后 receipt/内容持久化。
- [x] 跨平台 smoke runner 接入既有四平台发布任务；本机实际执行 package 和 smoke。

## 4. Verification and documentation

- [x] 集中构建与质量命令通过；修复暴露的回归后按受影响范围复跑。
- [x] 更新0580/1230/1280及开发/发行文档，分清已交付、仍待验收和暂缓范围。
- [x] 记录本机平台、可控 provider、CI 尚未远程执行等真实验证边界。

最终验证：完整质量命令通过182文件/1,430测试；macOS arm64最终package及两个独立进程写作/重启smoke通过。跨平台workflow尚未远程执行，完整边界见1310。

## 5. Release follow-up (2026-10-05)

用户随后授权提交并发布版本。首次四平台预检中，质量门禁、macOS arm64/x64与Linux通过，Windows在导入预览持久化时失败；定位为Windows不支持Node的POSIX目录fsync方式。

- 保留文件写入、文件fsync、原子rename及所有路径安全检查；Windows文件flush使用具备写权限的句柄。
- 仅Windows目录open/sync的已知不支持错误允许降级；POSIX目录错误、未知I/O错误与文件flush错误继续阻止操作。
- 修复PendingAction、materializer和同类Play snapshot/preview/receipt调用，增加平台故障注入回归。
- 重新执行质量门禁与原生四平台打包旅程；通过后发布新标签，并把运行和附件校验结果记录到1280/1310。
