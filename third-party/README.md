# 第三方发布材料

`inventory.json` 和根目录 `THIRD_PARTY_NOTICES.txt` 由 `scripts/prepare-licenses.mjs` 从锁文件与安装后的依赖生成。它们包含 Windows x64 的 Rust 依赖（含构建依赖）及 npm 运行依赖；不将所有列出的组件都视为运行时链接组件。

`license-overrides.json` 记录发布包漏附许可文件时的补充来源，`licenses/` 保存相应上游文本。版本和 Git 提交必须与 crate 的 `.cargo_vcs_info.json` 一致。selectors 使用其源码头声明的标准 MPL-2.0，详见对应补充记录。

```powershell
npm run licenses
npm run licenses:check
node scripts/prepare-licenses.mjs --check --sources
```

最后一条命令要求新的 `release/dependency-sources/` 输出目录。发布工作流把这些源码与本项目源码分别归档。此目录内的第三方文本保留原许可，不适用本项目原创内容的 GPL 声明。
