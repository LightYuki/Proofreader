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
3. 汇总需要保留的版权和许可全文到 `THIRD_PARTY_NOTICES.txt`，同时纳入安装包、便携包和 Release。目前脚手架仅携带本项目 LICENSE/NOTICE，**尚未完成这份第三方许可汇编**。
4. 确认对应源码的提供方式。当前工作流的 `source.zip` 只包含本项目 Git 跟踪的源码、锁文件和构建脚本，**不包含所有第三方依赖源码**。按实际许可证补齐依赖源码、修改补丁和必要构建材料，并与二进制同处可访问的发布入口；锁文件不等于对应源码归档。
5. 确认图标、样例及历史文档可以公开，不包含受限剧本文本或私人资料。

完成前，自动生成的 Release 应保留为草稿。生成依赖清单和 notices、收集必要源码可在首次打包验收时实现自动化；当前不声称已完成完整许可审计。

## 漏洞与更新

```powershell
npm audit --audit-level=high
cargo install cargo-audit --locked
cargo audit --file src-tauri/Cargo.lock
```

`cargo-audit` 是维护检查工具，不是应用依赖；运行时记录其版本及数据库时间。`npm audit --omit=dev` 可辅助区分运行依赖，但发布前还应检查构建依赖。任何审计通过都只代表检查时已知漏洞数据库的结果。

Dependabot 按周检查 npm/Cargo、按月检查 Actions。启用仓库的 Dependency graph、Dependabot alerts 和 security updates；依赖变更经 CI 与必要桌面验收后合并，不自动合并。无需为初次开源批量升级全部依赖。
