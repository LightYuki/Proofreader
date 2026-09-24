# 本地联调样例

`source.zh.json` 与 `target.en.json` 为 8 条连续台词，包含说话人、换行、`{player}`、`\\c[2]` 标记及额外的嵌套字段。预设明显错误是第 2 条否定关系相反、第 5 条人物代词错误。

启动仅监听本机的模拟 OpenAI 兼容服务：

```powershell
node fixtures/mock-server.mjs
```

在软件模型设置中填写：

- Base URL：`http://127.0.0.1:8787/v1`
- API Key：`local-test-key`
- 模型：`fixture-model`

服务只返回上述样例的两条固定建议，用于验证导入、接口调用、索引拼接、审阅和导出流程，不连接外部 LLM，也不执行实际语言判断。点击连接测试会返回 `OK`。

检查完成后，采用第 2 条、保留第 5 条原译，并保存校润版；预期只有第 2 条 `message` 改变，原有 `name`、额外字段、数组顺序、换行及控制标记保留。再修改已采用条目的草稿但不采用，保存时应仍使用上一次确认的内容。

可选联调模式：

```powershell
# 延迟 10 秒返回，用于检查停止操作。
node fixtures/mock-server.mjs --delay=10000

# 返回错误格式，预期批次失败而不是“未发现问题”。
node fixtures/mock-server.mjs --mode=malformed

# 模拟 HTTP 服务错误。
node fixtures/mock-server.mjs --mode=http-error
```

同一端口只启动一个服务，使用 `Ctrl+C` 停止。需要时可用 `--port=8788` 改端口。
