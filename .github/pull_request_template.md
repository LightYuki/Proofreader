## 改动与原因

描述解决的问题、用户可见行为及关联 Issue。

## 验证

- [ ] `npm run check`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked`
- [ ] 涉及桌面行为时，写明实际验收步骤；未执行的检查说明原因。

## 兼容性

说明是否影响输入输出 JSON、配置目录、工作记录、凭据或发布版本。
如增加依赖或第三方素材，注明来源和许可证。
