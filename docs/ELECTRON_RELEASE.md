# Electron 打包与 Release

`.github/workflows/desktop-release.yml` 使用现有 Nx 和 Electron Forge 构建链生成桌面分发包。推送版本标签后，全部平台构建和 packaged main smoke 通过才会公开 GitHub Release。

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

先确认当前提交是要发布的版本，再创建并推送一个新的 `v` 开头的 SemVer 标签。例如，首次正式版本可以使用 `v0.1.0`：

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

该示例不会由普通分支推送自动执行；版本号由维护者决定。预发布使用 `v0.1.0-beta.1` 等标签，流水线会标记为 prerelease。

安装完成依赖后，流水线把标签中的版本写入 CI checkout 的 `apps/desktop/package.json`，确保应用、ZIP 和安装器版本一致。该变化不提交回源码，也不修改已有标签。手动只构建时，使用源码中的桌面应用版本。

下载入口：[GitHub Releases](https://github.com/oh-awesome-novel/oh-awesome-novel/releases)。所有产物附带 `SHA256SUMS`，记录 Release 附件文件名对应的 SHA-256。

## 重试发布

如果构建失败，修复代码后创建新标签；不要覆盖已经发布的标签。仅临时网络问题可以重新运行失败的任务。

也可以手动构建并发布一个**已经存在**的版本标签：

```sh
gh workflow run desktop-release.yml --repo oh-awesome-novel/oh-awesome-novel --ref main -f tag=v0.1.0
```

流水线先建立 draft、上传全部产物和校验文件，再公开 Release。上传失败保留 draft，重试可以继续上传；已经公开的同名 Release 会拒绝覆盖，需要使用新版本标签。

## 本地构建

使用 Node.js 24，在仓库根目录安装依赖，然后执行：

```sh
npm run make --workspace @oh-awesome-novel/desktop
```

`make` 会构建依赖和 renderer，再依次执行 Forge package / make。产物位于 `apps/desktop/out/make/`。本地默认构建当前系统和架构；Linux 构建需安装 `rpm` 和 `fakeroot` 等工具。

CI 使用各平台原生 runner；安装时跳过生命周期脚本，再显式下载官方 Electron 二进制。Linux packaged smoke 使用 Xvfb 和仅测试进程的 `--no-sandbox`；正常桌面启动配置保持原样。Smoke 使用临时工作区验证 sandbox 候选产生、正式文件未被修改和 session dispose，不调用外部模型。

参考：[Electron Forge 构建生命周期](https://www.electronforge.io/core-concepts/build-lifecycle)、[GitHub CLI Release 命令](https://cli.github.com/manual/gh_release_create)。
