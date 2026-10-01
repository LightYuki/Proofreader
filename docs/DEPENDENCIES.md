# 第三方依赖与许可

本项目原创内容使用 GPL-3.0-or-later。引入的依赖、工具和素材保留原许可证；根目录 LICENSE 不会将第三方组件改为 GPL。

## 清单来源

| 范围 | 准确版本来源 | 核对方式 |
| --- | --- | --- |
| 前端运行依赖及构建工具 | `package-lock.json` | 对照已安装包的 `package.json`、LICENSE、COPYING、NOTICE |
| Rust 依赖 | `src-tauri/Cargo.lock` | `cargo metadata --locked --format-version 1`，核对 crates 源码中的许可文件 |
| GitHub Actions | `.github/workflows/*.yml` 的提交 SHA | 核对 Action 源仓库与更新 PR |
| 图标和样例 | `assets/`、`src-tauri/icons/`、`fixtures/` | 确认创作来源或第三方授权，不把来源不明的内容声明为原创 |
| 平台运行时及安装工具 | Tauri bundler、WebView2、NSIS | 核对实际分发内容和对应许可；系统组件与应用依赖分别记录 |

运行时依赖包括 React、React DOM、diff、Tauri API/对话框和 Rust 的 Tauri、serde、reqwest、tokio、keyring 等。实际传递依赖以锁文件和构建目标为准，不能只审查这些直接依赖。

## 首次公开二进制前必须完成

1. 从锁定版本安装依赖，列出实际分发的直接及传递组件、版本、来源与 SPDX 许可表达式。
2. 对照上游 LICENSE/NOTICE 和双许可选项确认与 GPLv3 的兼容性；特殊条款或未知许可逐项处理。
3. 使用 `npm run licenses` 生成 `THIRD_PARTY_NOTICES.txt` 和 `third-party/inventory.json`。目前覆盖 Windows 目标的 315 个 Rust 组件（含构建依赖）及 6 个 npm 运行依赖。许可汇编纳入安装包、便携包和 Release；CI 使用 `npm run licenses:check` 防止锁文件变化后遗漏更新。
4. 发布构建执行 `node scripts/prepare-licenses.mjs --check --sources`，导出上述锁定依赖的原始源码包，打包为 `dependency-sources.zip`，与本项目 `source.zip` 一起提供。依赖代码未修改，MPL 覆盖文件保留原有许可。该快照不承诺完全离线构建；构建工具、Node/Rust 工具链及 npm 开发依赖按 README 和锁文件安装。
5. 确认图标、样例及历史文档可以公开，不包含受限剧本文本或私人资料。

部分 crates 发布包未附许可证文件，已按 `.cargo_vcs_info.json` 指向的上游提交补回原始文本，来源记录在 `third-party/license-overrides.json`。selectors 的清单和源码头声明 MPL-2.0，补充标准 MPL 文本；原始源码头在依赖源码附件中保留。更新这些组件时必须重新核对版本和来源。新增未知许可证会阻止生成，维护者审查后才能更新允许列表。

这些检查用于核对分发材料，不替代对新素材或特殊授权条件的人工审查。平台 WebView2 由微软分发，不在依赖源码快照中；安装器通过官方引导程序获取运行时。

## 漏洞与更新

```powershell
npm audit --audit-level=high
cargo install cargo-audit --locked
cargo audit --file src-tauri/Cargo.lock
```

`cargo-audit` 是维护检查工具，不是应用依赖；运行时记录其版本及数据库时间。`npm audit --omit=dev` 可辅助区分运行依赖，但发布前还应检查构建依赖。任何审计通过都只代表检查时已知漏洞数据库的结果。

Dependabot 按周检查 npm/Cargo、按月检查 Actions。启用仓库的 Dependency graph、Dependabot alerts 和 security updates；依赖变更经 CI 与必要桌面验收后合并，不自动合并。无需为初次开源批量升级全部依赖。
