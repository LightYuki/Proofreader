# 发布流程

当前发布目标为 Windows x64，格式为 NSIS 安装包和便携 ZIP。应用版本仍为 1.0.0；增加开源维护文件不会自动产生新版本。包未代码签名，暂不提供自动更新。

## 仓库首次设置

维护者在 GitHub 中确认：

- 仓库公开可读，`main` 为默认分支；补全 About、描述、主题和 Release 入口。
- Actions 启用，默认 Workflow permissions 为只读；仅 Release 的最后一个 job 声明 `contents: write`。
- 首次 CI 成功后，对 `main` 设置 ruleset：通过 PR 合并、要求 `Windows checks`、阻止强推和删除；单维护者阶段可不要求额外审批人数。
- 对 `v*` 标签限制创建权限到维护者，阻止标签更新和删除，避免同版本指向不同源码。
- 启用 Dependency graph、Dependabot alerts/security updates、Secret scanning 和 Private vulnerability reporting（以仓库实际可用功能为准）。

以上是 GitHub 端设置，提交 YAML 不会自动启用分支保护或私密漏洞报告。

## 准备版本

1. 完成 [第三方依赖和对应源码清单](DEPENDENCIES.md)，补齐 notices 的生成与安装包/便携包收录；这是首次公开二进制前的必做项。
2. 发布新版本时同步修改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。执行 `npm install --package-lock-only --ignore-scripts` 和 `cargo check --manifest-path src-tauri/Cargo.toml` 更新两份锁文件，然后运行 `npm run check:project`。
3. 将 CHANGELOG 的 Unreleased 内容整理到对应版本节并写入真实发布日期。首次发布 1.0.0 只补日期，不必升级版本。
4. 提交 PR，完成 CI 与相关手动验收并合并到 `main`。当前工作流接受稳定 `X.Y.Z`，预发布标签支持可后续加入。

## 触发构建

在已同步、无未提交源码的 `main` 上执行以下维护命令（示例仅适用于首次 1.0.0）：

```powershell
git switch main
git pull --ff-only origin main
node scripts/check-project.mjs --tag v1.0.0
git tag -a v1.0.0 -m "Proofread 1.0.0"
git push origin v1.0.0
```

`Release` 工作流重新执行完整 CI，并校验标签与所有版本文件一致、提交属于 `main`，之后构建 NSIS。打包成功才上传附件，最后用 GitHub 自带的短期 token 创建 **草稿**。不需要在仓库保存 PAT、模型 API Key 或签名私钥。

附件包含：

- `Proofread-vX.Y.Z-windows-x64-setup.exe`
- `Proofread-vX.Y.Z-windows-x64-portable.zip`
- `Proofreader-vX.Y.Z-source.zip`（本项目源码，依赖源码要求见上文）
- `LICENSE`、`NOTICE`、`RELEASE_NOTES.md`、`SHA256SUMS.txt`

便携包只是免安装分发，配置和凭据仍使用 Windows 用户目录与凭据管理器，并非所有数据随程序目录移动。

## 公开草稿前的验收

- 在干净 Windows x64 环境测试安装、首次启动、重复启动激活、升级和卸载；分别检查已有/缺少 WebView2 的情况。记录实际 Windows 版本。
- 用 `fixtures` 测试导入、模拟模型调用、采用/保留、导出、停止/恢复和重启恢复。验证输入文件未改动、额外字段保留。
- 按需用获准发送的人工文本测试真实服务，记录供应商兼容性，不公开密钥。
- 核对二进制版本、源码标签、许可汇编、对应源码、文件名和校验值。可用 `Get-FileHash -Algorithm SHA256 <文件>` 校验下载内容。
- Release 描述清楚写明未签名、WebView2 要求、支持范围和已知限制；完成草稿清单后再手动 Publish release。

本地打包脚本假设干净的输出目录，避免混入旧包。GitHub 的 Re-run jobs 会使用新工作区，可在同一标签下更新已有草稿；已公开的 Release 不允许被该工作流覆盖。失败时先查看具体 job；若需修改源码或构建配置，使用新的补丁版本和标签，不移动已有标签。

正式公开后如发现严重问题，可将有问题的 Release 标为预发布并说明原因，再发布修复版；保留已公开版本、源码和校验记录。不要静默替换二进制。

## 后续增强

首次稳定发布后再评估代码签名证书、Windows ARM64、多平台构建、Tauri 自动更新和更新包签名。自动更新需要 HTTPS 清单、密钥管理、回滚策略及升级验收，不能仅增加一个 workflow 就视为完成。
