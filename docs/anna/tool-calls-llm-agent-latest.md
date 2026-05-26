# Anna App Tool 调用 LLM / Agent 最新实现说明

本文给 AI Agent 使用。目标是让你在本仓库里实现 Anna App / Executa Tool 调用 Anna LLM 或 Anna Agent 时，按最新 staging 开发者文档写代码。

重要结论：

- App iframe 直调 LLM：用 `anna.llm.complete(...)`。
- App iframe 直调 Agent：用 `anna.agent.session({ submode: "auto" })`。
- App iframe 调后端 Tool：用 `anna.tools.invoke({ tool_id, method, args })`。
- Tool 内调 Anna LLM：用 Executa v2 reverse RPC `sampling/createMessage`。
- Tool 内调 Anna Agent：用 Executa v2.1 reverse RPC `agent/session.*`。
- 最新协议中，`invoke_id`、`sampling_token` 在 `invoke` 的 `params.context` 里。
- 不要再按旧文档把 `invoke_id`、`sampling_token` 写成或读取成 `params.invoke_id`、`params.sampling_token` 顶层字段。

## 1. App iframe 调 Tool 的链路

Anna App bundle 运行在 iframe / static SPA 中。连接 runtime 后，通过 Host API 调工具：

```js
const anna = await window.AnnaAppRuntime.connect();

const result = await anna.tools.invoke({
  tool_id: "tool-yourhandle-example-abc123",
  method: "complete",
  args: { prompt: "Explain Anna Sampling." },
});
```

字段含义：

- `tool_id`：服务器 mint 出来的完整 Tool ID，必须和 `manifest.json` 的 `required_executas[].tool_id` 完全一致。
- `method`：插件 `describe` manifest 里 `tools[].name` 的值。
- `args`：插件收到的 `params.arguments`。

Host 会把上面的调用转换成 Executa stdio JSON-RPC：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "invoke",
  "params": {
    "tool": "complete",
    "arguments": { "prompt": "Explain Anna Sampling." },
    "context": {
      "invoke_id": "8f1c...",
      "sampling_token": "eyJ...",
      "credentials": {}
    }
  }
}
```

实现插件时要这样读：

```python
params = msg.get("params") or {}
args = params.get("arguments") or {}
context = params.get("context") or {}
invoke_id = context.get("invoke_id") or ""
```

不要这样读：

```python
invoke_id = params.get("invoke_id") or ""
sampling_token = params.get("sampling_token") or ""
```

可以为了兼容旧 harness 做 fallback，但主路径必须是 `params.context`。

## 2. Tool 内调用 Anna LLM：sampling/createMessage

Tool 想在处理 `invoke` 时调用 Anna LLM，不要内置 OpenAI / Anthropic API key。使用 reverse RPC：

```json
{
  "jsonrpc": "2.0",
  "id": "plugin-generated-id",
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": { "type": "text", "text": "Summarize:\n..." }
      }
    ],
    "maxTokens": 512,
    "systemPrompt": "You are a concise assistant.",
    "temperature": 0.2,
    "includeContext": "none",
    "metadata": {
      "executa_invoke_id": "8f1c...",
      "tool": "complete"
    }
  }
}
```

实现要求：

- `metadata.executa_invoke_id` 必须来自 `params.context.invoke_id`。
- `includeContext` 当前只使用 `"none"`。
- 一般不要传 `modelPreferences`，让 Anna 使用用户保存的 preferred model。
- 插件不需要、也不应该读取 `sampling_token` 后自己发 HTTP；host 会用 `params.context.sampling_token` 做鉴权。

插件 manifest 必须声明：

```json
{
  "host_capabilities": ["llm.sample"]
}
```

v2 `initialize` 也要声明插件会使用 sampling：

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2.0",
    "serverInfo": { "name": "tool-yourhandle-example-abc123", "version": "0.1.0" },
    "capabilities": { "sampling": {} }
  }
}
```

## 3. Tool 内调用 Anna Agent：agent/session.*

如果只需要单轮 completion，优先用 `sampling/createMessage`。如果需要多轮、工具调用、Agent run、thread/session 语义，用 `agent/session.*`。

插件 manifest 必须声明：

```json
{
  "host_capabilities": ["llm.sample", "llm.agent.auto"]
}
```

创建 session：

```json
{
  "jsonrpc": "2.0",
  "id": "agent-create-id",
  "method": "agent/session.create",
  "params": {
    "kind": "agent",
    "agent_submode": "auto",
    "label": "my tool run",
    "ttl_seconds": 600
  }
}
```

Host 返回的是不含 bearer token 的 session 信息：

```json
{
  "jsonrpc": "2.0",
  "id": "agent-create-id",
  "result": {
    "app_session_uuid": "aps_...",
    "thread_id": "thr_...",
    "expires_in": 600,
    "granted_tools": []
  }
}
```

运行一轮：

```json
{
  "jsonrpc": "2.0",
  "id": "agent-run-id",
  "method": "agent/session.run",
  "params": {
    "app_session_uuid": "aps_...",
    "content": "Plan my week.",
    "recursion_limit": 8
  }
}
```

当前 v2.1 是 buffered：host 会在 run 完成后一次性返回 frames。

```json
{
  "jsonrpc": "2.0",
  "id": "agent-run-id",
  "result": {
    "run_id": "run_...",
    "stream_id": "strm_...",
    "frames": [
      { "event": "token", "text": "..." },
      { "event": "tool_call", "name": "search_web", "args": {}, "call_id": "..." },
      { "event": "tool_result", "call_id": "...", "ok": true, "data": {} },
      { "event": "complete" }
    ]
  }
}
```

最后删除 session：

```json
{
  "jsonrpc": "2.0",
  "id": "agent-delete-id",
  "method": "agent/session.delete",
  "params": {
    "app_session_uuid": "aps_..."
  }
}
```

不要持久化 `app_session_uuid`。host 的 token cache 是进程内缓存，插件重启后旧 uuid 可能失效。

## 4. App iframe 直调 LLM / Agent

如果能力在 App UI 里完成，不需要绕到 Tool。

直调 LLM：

```js
const reply = await anna.llm.complete({
  messages: [
    { role: "user", content: { type: "text", text: "Say hi." } },
  ],
  maxTokens: 256,
});
```

直调 Agent：

```js
const session = await anna.agent.session({ submode: "auto" });
try {
  const stream = session.run({ content: "Find me 3 lunch options nearby." });
  for await (const frame of stream) {
    if ((frame.event === "token" || frame.event === "delta") && frame.text) {
      // render token
    }
  }
} finally {
  await session.delete();
}
```

`manifest.json` 的 `ui.host_api` 要授权：

```json
{
  "ui": {
    "host_api": {
      "llm": ["complete"],
      "agent": {
        "session": { "auto": true, "fixed": null },
        "tools": []
      }
    }
  }
}
```

如果 App 还要调用 Tool，再加：

```json
{
  "required_executas": [
    { "tool_id": "tool-yourhandle-example-abc123", "min_version": "0.1.0" }
  ],
  "ui": {
    "host_api": {
      "tools": ["required:tool-yourhandle-example-abc123"]
    }
  }
}
```

## 5. stdio 分发和日志规则

Executa 插件是长期运行进程。不要处理完一次 `invoke` 就退出。

同一个 stdin reader 会收到两类消息：

- Host 主动请求：有 `method` 字段，例如 `initialize`、`describe`、`invoke`、`health`。
- Reverse RPC 响应：没有 `method` 字段，只有 `id + result/error`。

分发逻辑示例：

```python
if "method" not in msg:
    if agent.dispatch_response(msg):
        return
    if sampling.dispatch_response(msg):
        return
    log(f"unmatched response id={msg.get('id')!r}")
    return

method = msg.get("method")
```

stdout 只能写 JSON-RPC 帧：

```python
sys.stdout.write(json.dumps(frame, ensure_ascii=False) + "\n")
sys.stdout.flush()
```

所有调试日志写 stderr：

```python
print("[my-tool] invoke start ...", file=sys.stderr, flush=True)
```

不要把日志写到 stdout，否则 Anna host 会把日志当 JSON-RPC 解析，导致协议错误。

日志里不要输出 credential、token、完整 bearer。可以输出：

- `invoke_id`
- tool name
- request id
- prompt length / preview
- reverse RPC method
- model / usage
- elapsed time
- error code / message

## 6. 禁用旧方案清单

不要这样做：

- 不要从 `params.invoke_id` 作为主路径读取 invoke id。
- 不要从 `params.sampling_token` 作为主路径读取 sampling token。
- 不要在 Tool 参数 schema 里声明 credential 或 token。
- 不要把 `sampling_token` 暴露给 LLM、前端或日志。
- 不要让插件自己携带 OpenAI / Anthropic API key 来完成 Anna 用户侧 LLM 调用。
- 不要在 App bundle 里调用不存在的 envelope，例如 `anna.tools.invoke({ tool, method, arguments })`。
- 不要把 `tools.invoke` 的 `args` 写成 `arguments`；App Host API 使用 `args`。
- 不要把插件内部 method 写进 `tool_id` 做前缀切分；使用完整 minted `tool_id` 加单独的 `method`。
- 不要在 stdout 输出普通日志。
- 不要处理完一次请求就 `exit()`。

可以兼容但不要作为新代码主路径：

```python
context = params.get("context") or {}
invoke_id = context.get("invoke_id") or params.get("invoke_id") or ""
```

这只是为了兼容旧 harness 或旧本地文档示例。新实现、测试、说明都应以 `params.context.invoke_id` 为准。

## 7. 最小插件骨架

```python
async def handle_invoke(req_id, params):
    tool = params.get("tool")
    args = params.get("arguments") or {}
    context = params.get("context") or {}
    invoke_id = context.get("invoke_id") or ""

    if tool == "complete":
        result = await sampling.create_message(
            messages=[{
                "role": "user",
                "content": {"type": "text", "text": args["prompt"]},
            }],
            max_tokens=512,
            metadata={"executa_invoke_id": invoke_id, "tool": tool},
        )
        return {"text": result["content"]["text"]}

    if tool == "agent_session":
        session = await agent.create(kind="agent", agent_submode="auto")
        try:
            run = await agent.run(
                app_session_uuid=session["app_session_uuid"],
                content=args["prompt"],
            )
            return {"frames": run.get("frames", [])}
        finally:
            await agent.delete(app_session_uuid=session["app_session_uuid"])
```

这个骨架省略了线程、pending future、错误处理和 stdout lock。生产代码应参考 `test-app/executas/llm-test-python/llm_test_plugin.py` 或 `anna-executa-examples/examples/python/executa-agent-demo/` 的完整分发结构。
