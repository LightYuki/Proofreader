# 安全政策

公开发布后，项目维护最新稳定版本的安全修复；旧版本不承诺单独回补。目前没有响应时限或商业支持承诺。

## 报告漏洞

优先使用仓库 **Security → Advisories → Report a vulnerability** 的私密报告入口：
<https://github.com/LightYuki/Proofreader/security/advisories/new>

该入口需要维护者在 GitHub 设置中启用 Private vulnerability reporting。若入口不可用，请先发一个只写“请求开启私密安全报告”的 Issue，不附漏洞细节、密钥、私人文件或利用代码。维护者启用后再私密提交。

报告应包含应用版本、Windows 版本、影响、最小复现和建议修复。请使用人工样例；不要公开第三方凭据或未授权文本。

## 数据边界

API Key 通过 Windows 凭据管理器保存。设置和工作记录包含服务配置、文件路径及审阅内容；工作记录不是加密保险箱。校润会把该批原文、译文、说话人和校润要求发送到用户配置的模型服务。调用费用、服务商保留策略及文本授权由使用者确认。

本项目不要求为反馈上传真实剧本、`settings.json`、`workspace.json` 或凭据。未签名安装包和自动更新的当前状态见 [发布流程](docs/RELEASING.md)。
