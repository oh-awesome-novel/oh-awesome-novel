# Electron 打包与 Release

`.github/workflows/desktop-release.yml` 使用现有 Nx 和 Electron Forge 构建链生成桌面分发包。推送版本标签后，共用质量门禁、全部平台构建和 packaged main smoke 通过才会公开 GitHub Release。

2026-10-05：[v0.2.0](https://github.com/oh-awesome-novel/oh-awesome-novel/releases/tag/v0.2.0)已公开，发行源码为`7f7e087`。[正式流水线](https://github.com/oh-awesome-novel/oh-awesome-novel/actions/runs/37274648020)的质量门禁、四平台构建和两进程写作/重启旅程全部通过；七项分发附件与公开`SHA256SUMS`及GitHub记录的SHA-256一致。详细证据与剩余验收边界见[1280](tasks/1280.md)、[1310](tasks/1310.md)。

## 质量门禁

`.github/workflows/quality.yml` 在 PR 和 main 推送时执行，也由发行 workflow 调用。`npm run quality` 依次执行生产构建、严格 TypeScript / Vue 类型检查、七个测试 workspace、文档术语和 task/index 状态检查、Wiki 构建。测试按 workspace 顺序运行，避免重复构建清理依赖产物或过量并行导致超时。

发行传入目标标签/ref，质量 job 输出其实际 checkout 的完整 commit SHA。四个平台都 checkout 该 SHA；质量检查失败时不开始构建安装包，也不会发布 Release。源码 build 成功不能代替独立 typecheck。现有 `ui-vue` 仅有占位 package.json，没有生产源码；测试代码的验证范围见 [本地开发](../LOCAL_DEVELOPMENT.md)。

## 目标平台

| 平台 | 架构 | 产物 |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | 包含 `.app` 的 ZIP |
| macOS | Intel / x64 | 包含 `.app` 的 ZIP |
| Windows | x64 | Squirrel Setup EXE、NUPKG、RELEASES |
| Linux | x64 | DEB、RPM |

不配置开发者证书、Windows Authenticode 签名或 macOS 公证，不需要签名相关 Secrets。macOS arm64 所需的临时本地签名由打包工具处理，不代表开发者身份认证。安装时系统可能显示未验证发布者或 Gatekeeper 提示。

## 先验证构建

将流水线提交并推送到默认分支后，在本机使用已登录的 `gh`：

```sh
gh workflow run desktop-release.yml --repo oh-awesome-novel/oh-awesome-novel --ref main
gh run list --repo oh-awesome-novel/oh-awesome-novel --workflow desktop-release.yml --limit 5
```

不填写 `tag` 时，只构建并保存 14 天的 Actions artifacts，不创建标签或 Release。可在 Actions 页面下载，也可运行：

```sh
gh run watch <运行ID> --repo oh-awesome-novel/oh-awesome-novel --exit-status
gh run download <运行ID> --repo oh-awesome-novel/oh-awesome-novel --dir desktop-artifacts
```

失败时用 `gh run view <运行ID> --repo oh-awesome-novel/oh-awesome-novel --log-failed` 查看日志。

## 发布版本

先确认当前提交和新版本号，再创建并推送一个新的 `v` 开头的 SemVer 标签。`v0.2.0` 已公开；以下以维护者后续选择 `v0.2.1` 为例：

```sh
git tag -a v0.2.1 -m "Release v0.2.1"
git push origin v0.2.1
```

该示例不会由普通分支推送自动执行；版本号由维护者决定。预发布使用 `v0.2.1-beta.1` 等标签，流水线会标记为 prerelease。

安装完成依赖后，流水线把标签中的版本写入 CI checkout 的 `apps/desktop/package.json`，确保应用、ZIP 和安装器版本一致。该变化不提交回源码，也不修改已有标签。手动只构建时，使用源码中的桌面应用版本。

下载入口：[GitHub Releases](https://github.com/oh-awesome-novel/oh-awesome-novel/releases)。所有产物附带 `SHA256SUMS`，记录 Release 附件文件名对应的 SHA-256。上传前将文件名中的空格等字符统一替换为连字符，避免 GitHub 的自动文件名转换使校验清单失配。

## 重试发布

如果构建失败，修复代码后创建新标签；不要覆盖已经发布的标签。仅临时网络问题可以重新运行失败的任务。

也可以手动构建并发布一个**已经存在**的版本标签：

```sh
gh workflow run desktop-release.yml --repo oh-awesome-novel/oh-awesome-novel --ref main -f tag=v0.2.1
```

流水线先建立 draft、上传全部产物和校验文件，再公开 Release。上传失败保留 draft，重试可以继续上传；已经公开的同名 Release 会拒绝覆盖，需要使用新版本标签。

## 本地构建

应用图标的母版与各平台资源位于 `apps/desktop/assets/`，设计说明、完整生成提示词和更新方法见[图标资源说明](../apps/desktop/assets/README.md)。在macOS上运行 `npm run icons:build` 可从已保存母版重新生成PNG、ICO、ICNS及启动页/favicon资源；CI直接使用这些版本化产物。

Forge为macOS应用选择ICNS、Windows EXE/Squirrel Setup选择ICO、DEB/RPM选择512px PNG。窗口图标从打包后的 `resources/icons` 读取，macOS开发环境也使用同一图案作为Dock图标。当前使用传统ICNS覆盖已支持的macOS发行环境。

使用 Node.js 24，在仓库根目录安装依赖，然后执行：

```sh
npm run make --workspace @oh-awesome-novel/desktop
```

`make` 会构建依赖和 renderer，再依次执行 Forge package / make。产物位于 `apps/desktop/out/make/`。本地默认构建当前系统和架构；Linux 构建需安装 `rpm` 和 `fakeroot` 等工具。

只验证应用包及完整写作旅程时可以运行：

```sh
npm run package --workspace @oh-awesome-novel/desktop
node __test__/desktop-ui/packaged-main-smoke/run.cjs
```

runner 按当前平台和架构定位应用本体，不会误启动安装器或 Electron helper；也可显式传入包目录或 executable。Linux 在 Xvfb 内执行 `node __test__/desktop-ui/packaged-main-smoke/run.cjs --no-sandbox`。

CI 使用各平台原生 runner；安装时跳过生命周期脚本，再显式下载官方 Electron 二进制，并仅在 Windows 初始化 Squirrel 的架构对应压缩工具。Linux packaged smoke 的 `--no-sandbox` 只用于测试进程；正常桌面启动配置保持原样。

新 smoke 启动两个独立的打包进程，使用临时 workspace/global config/Git identity：真实 renderer/preload 新建工程、导入第一章并审批、默认 SDK 通过本地确定性 HTTP/SSE provider 在内存沙箱修改正文、审阅 diff 并 Accept、检查限定范围的真实 Git commit、下载 Markdown/TXT。第二个进程重开同一工作区，核对正文/receipt/Git，恢复另一条 pending 候选并通过 UI Reject，再次下载验证正文未变。只有本地模型响应和系统目录选择使用 fixture，核心 Backend/SDK/renderer/materializer/Git 均走生产代码。

每个进程有180秒总期限，内部 HTTP/UI 等待另有界限；报告必须包含全部验收检查、零 renderer 错误和零外部网络请求。它验证打包资源与作者流程，不代表收费 provider 质量、远端同步、设备断电或安装器签名已经验收。

参考：[Electron Forge 构建生命周期](https://www.electronforge.io/core-concepts/build-lifecycle)、[GitHub CLI Release 命令](https://cli.github.com/manual/gh_release_create)。
