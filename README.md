# Proofread · 译文校润

用于视觉小说译文校润的 Windows 桌面工具。导入逐条对应的原文与译文 JSON，由模型结合上下文提出修改建议，人工确认后另存校润版。

仓库名称为 **Proofreader**，应用名称为 **Proofread**。基于 Tauri 2、React、TypeScript 与 Rust，采用 [GPL-3.0-or-later](LICENSE)。

## 功能

- 连续双语阅读，逐条查看理由、上下文依据和修改差异。
- 人工采用、保留原译或直接编辑；保存只写入已确认修改。
- 支持 OpenAI 兼容模型接口、可选 API Key、模型列表和连接测试。
- 支持停止、继续、失败批次重试、文件标签、最近记录和进度恢复。
- 保留原 JSON 的额外字段，禁止覆盖导入的原文与译文。

## 下载与使用

公开构建在 [GitHub Releases](https://github.com/LightYuki/Proofreader/releases) 提供。若尚无 Release，请按下方步骤从源码构建；本地 `release/` 文件不是已发布版本。

目前维护 Windows x64，需要 Microsoft Edge WebView2 Runtime。安装包会在缺少 WebView2 时联网安装；便携 ZIP 需自行准备运行时。当前构建未做代码签名，暂不支持自动更新。Windows 具体版本的兼容性以各 Release 的实际验收说明为准。

1. 在“文件 → 打开…”中选择原文与译文 JSON。
2. 在“校润要求”填写语言方向、风格、术语及可选剧情背景。
3. 在“设置”填写模型服务地址、模型名称及可选 API Key。
4. 开始检查，逐条决定是否采用建议，然后保存校润版。

输入为等长 UTF-8 JSON 数组，按位置对应；`message` 为字符串，`name` 可选，其他字段保留：

```json
[
  { "name": "小夏", "message": "你今天还要出去吗？", "id": 1002 }
]
```

完整操作、快捷键、恢复与重试规则见 [使用手册](docs/USER_GUIDE.md)。无需真实模型的体验与联调见 [人工样例和模拟服务](fixtures/README.md)。

校润会向你配置的模型服务发送当前批次的原文、译文、说话人及要求；模型可能出错，修改需人工确认。API Key 保存在 Windows 凭据管理器，配置和工作记录保存在本机应用配置目录。详情见 [安全政策](SECURITY.md)。

## 开发

开发环境：

- Node.js 24（版本见 `.node-version`）与 npm 11。
- Rust MSVC 工具链（版本和组件见 `rust-toolchain.toml`）。
- Visual Studio 2022 C++ Build Tools 的“使用 C++ 的桌面开发”组件与 Windows SDK。
- WebView2 Runtime，详见 [Tauri 环境准备](https://v2.tauri.app/start/prerequisites/)。

```powershell
git clone https://github.com/LightYuki/Proofreader.git
cd Proofreader
npm ci
npm run tauri dev
```

`npm run dev` 仅预览前端；文件、凭据、模型与进度功能需要 Tauri 桌面环境。

检查与构建：

```powershell
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- build --bundles nsis -- --locked
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`，程序输出到 `src-tauri/target/release/proofread.exe`。最终用户无需安装 Node.js 或 Rust。

## 源码结构

```text
src/                 React 界面、审阅与工作记录状态
  components/        共用菜单、标签与弹窗
  features/          审阅流程、阅读区域与工作记录恢复
  core/              建议解析、窗口计算与纯逻辑测试
  services/          Tauri IPC 接口
src-tauri/           Rust 文件、模型、凭据、持久化与单实例功能
shared/              前后端共用的检查策略
fixtures/            人工样例和本机模拟模型服务
assets/              图标源文件
scripts/             项目检查与发布打包脚本
.github/             CI、Release、依赖更新与协作模板
docs/                使用、架构、维护文档和历史审查记录
```

Git 保留源码、锁文件、图标、测试、样例和文档；依赖目录、缓存、个人配置和发行产物不入库。文档入口见 [docs/README.md](docs/README.md)。

## 维护与发布

PR 与 `main` 提交在 Windows 执行项目元数据校验、前端测试和构建、Rust 格式检查、Clippy 与测试。推送 `vX.Y.Z` 标签会重新验证后构建安装包、便携包、源码包及 SHA-256，并创建 **Release 草稿**，由维护者完成验收后公开。

- [参与贡献](CONTRIBUTING.md) · [报告问题](https://github.com/LightYuki/Proofreader/issues) · [安全报告](SECURITY.md)
- [变更记录](CHANGELOG.md) · [发布流程](docs/RELEASING.md) · [第三方依赖](docs/DEPENDENCIES.md)
- [开源建设规划与验收状态](docs/OPEN_SOURCE_PLAN.md)

当前不提供自动对齐、场景识别、术语库、全部自动采用或超长文本自动拆分；超大文件性能和其他操作系统仍待验证。

## 许可证

Copyright (C) 2026 LightYuki and contributors。项目原创内容按 **GNU GPL v3 或更新版本**发布，全文见 [LICENSE](LICENSE)，授权声明见 [NOTICE](NOTICE)。第三方组件遵守各自许可证，用户导入的文本不属于本项目授权范围。
