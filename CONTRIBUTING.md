# 参与贡献

欢迎中文或英文 Issue 和 Pull Request。维护者为 [LightYuki](https://github.com/LightYuki)，当前以 Windows x64 为维护目标。

## 开始开发

1. Fork 并克隆仓库，从 `main` 建立自己的功能分支。
2. 按 [README](README.md#开发) 安装 Node.js、Rust MSVC、C++ Build Tools 和 WebView2。
3. 执行 `npm ci`，然后 `npm run tauri dev`。离线模型联调见 [fixtures](fixtures/README.md)。

`package-lock.json` 与 `src-tauri/Cargo.lock` 必须提交。`private: true` 及 Cargo 的 `publish = false` 只阻止误发 npm/crates.io，不影响开源。安装依赖时使用锁文件，不随功能改动批量升级依赖。

## 代码与验证

保持 `src/core` 的纯逻辑、`src/features` 的交互流程、`src/services` 的 IPC 边界与 `src-tauri/src` 的本机能力分层。业务变更配套相关回归测试；纯文档或格式变更无需额外测试。遵循 `.editorconfig`，Rust 使用 `cargo fmt --manifest-path src-tauri/Cargo.toml --all`。

提交前执行：

```powershell
npm run check
npm run licenses:check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

CI 在 Windows 执行同一组检查。界面、凭据、文件写回及安装器改动还需手动验收；请在 PR 中说明环境、执行步骤和未验证项。贡献者从 Fork 提交 PR，CI 不需要真实模型密钥，也不会获得发布权限。

不要改动 `com.proofread.desktop` 配置标识、已有存储键或工作记录格式而不提供迁移方案。不要在常规清理中递增应用版本。发布时由维护者统一调整版本、变更日志和标签，见 [发布流程](docs/RELEASING.md)。

## 讨论和许可

较大架构或产品调整先用 Issue 说明场景与方案；小修复可直接提交 PR。讨论应围绕问题，尊重贡献者，不进行人身攻击、骚扰或泄露私人信息。

提交贡献即表示你有权提供这些内容，并同意按项目的 GPL-3.0-or-later 许可证发布。第三方代码、图标、字体及样例须说明来源并保留原有许可。请使用人工样例，不提交真实剧本、API Key、个人路径或工作记录。安全问题按 [SECURITY.md](SECURITY.md) 处理。
