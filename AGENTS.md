# AGENTS.md

本文件是给代码 agent 使用的项目说明。请先阅读本文件，再修改代码。

## 项目概览

本仓库是将开源 `gpt-researcher` 适配为 Anna App 的工作区。

主要目录：

- `gpt-researcher/`：上游 GPT Researcher 源码。尽量保持接近上游，不要把 Anna 专用代码直接塞进它的 backend/frontend。
- `anna-executa-examples/`：Anna App / Executa 示例和协议文档，用作实现参考。
- `anna-researcher-app/`：本项目新增的 Anna App Adapter MVP。
- `CONTEXT.md`：本仓库的领域词汇表。写实现、issue、PRD、测试名时优先使用这里的术语。
- `.scratch/`：本地 markdown issue tracker 和 PRD。
- `docs/agents/`：agent workflow 的本地约定。

当前 Anna App Adapter MVP 的核心形态：

```text
Anna App Shell
  -> anna.tools.invoke
  -> Executa Wrapper
  -> Anna Research Orchestrator
  -> Tavily Summary Retrieval
  -> Lexical Context Selector
  -> Anna Sampling LLM
  -> Minimal Research Result
```

第一版只支持 `research_report`。不要把 detailed/deep/resource/outline/multi-agent report 混进 MVP。

当前 Anna App Shell 已改为工程化前端：

- `anna-researcher-app/src/`：Vite + React + TypeScript 源码，是正常编辑入口。
- `anna-researcher-app/bundle/`：Anna 加载的静态 SPA 构建产物，需要随源码一起提交。
- 不要手写修改 `bundle/` 中的生成文件；需要改 UI 时改 `src/` 后运行前端 build。
- UI 支持中文和英文，但这只影响 App Shell 文案，不改变研究报告语言策略。

## 关键工作约束

- 不要自行启动 `anna-app dev`。
- 如果需要 Anna App dev server 或 Anna runtime 联调，先告诉用户需要启动什么命令，让用户自己启动。
- 不要自行启动长时间运行的 Anna bridge、Anna runtime、GUI 或本地服务，除非用户明确要求。
- 不要把 Anna 专用适配代码写进 `gpt-researcher/backend` 或 `gpt-researcher/frontend`，优先在 `anna-researcher-app/` 内实现。
- 不要引入 OpenAI embedding 作为 MVP 默认路径。
- 不要把任意 `source_urls` ingestion 加回 MVP；第一版只支持 web search 和可选 domain filter。
- 不要实现 PDF/DOCX 导出、历史列表、取消/重试、多任务并发、聊天追问，除非新的 issue 明确要求。
- stdout 只能输出 JSON-RPC 协议帧；调试日志必须写 stderr。
- 开发 Anna LLM / Agent 调用链时，必须先读 `docs/anna/tool-calls-llm-agent-latest.md`，按其中最新方案实现；尤其注意 `invoke_id`、`sampling_token` 在 `params.context` 中，不要按旧文档写成顶层 `params.invoke_id` / `params.sampling_token`。
- 修改用户已有改动时要谨慎。不要 revert 不是自己做的改动。

## 开发位置

Anna App Adapter 的实现入口在：

```text
anna-researcher-app/
```

重要子目录：

```text
anna-researcher-app/
├── src/                            # 工程化 Anna App Shell 源码
├── bundle/                         # 静态 SPA 构建产物，提交但不要手写修改
├── executas/researcher-python/     # Python Executa Wrapper
│   ├── researcher_plugin.py
│   └── researcher_adapter/         # 可测试的核心模块
└── tests/                          # 离线 contract / unit / smoke tests
```

`researcher_adapter/` 中的深模块边界：

- `dispatcher.py`：Research Tool Dispatcher 和 Core Research Actions。
- `job_store.py`：Executa Local Job Store。
- `orchestrator.py`：Anna Research Orchestrator 状态机。
- `sampling_llm.py`：Anna Sampling LLM 边界和 fake sampling。
- `tavily_retrieval.py`：Tavily Summary Retrieval 和 fake retrieval。
- `context_selector.py`：Context Selector / Lexical Context Selector。
- `errors.py`：稳定错误类型。

## 本地验证命令

优先使用不依赖外部服务的离线测试：

```bash
python anna-researcher-app/tests/run_tests.py
```

前端测试：

```bash
cd anna-researcher-app
npm run test:frontend
```

静态 bundle 构建：

```bash
cd anna-researcher-app
npm run build
```

Python 语法检查：

```bash
python -m compileall -q anna-researcher-app/executas/researcher-python anna-researcher-app/tests
```

当前环境可能没有 `pytest`。不要为了跑 pytest 贸然安装依赖；如果需要新增依赖或联网安装，先说明原因并征求用户同意。

## Anna App 运行说明

不要自己运行：

```bash
anna-app dev
```

如果确实需要真实 Anna App 联调，请向用户说明：

1. 需要在 `anna-researcher-app/` 下启动 `anna-app dev`。
2. 需要配置 Tavily credential 或开启 fake 模式。
3. 需要 Anna Sampling grant 才能走真实 LLM sampling。

由用户启动后，agent 可以根据用户提供的日志、端口或错误继续排查。

## 环境变量

离线测试使用 fake 模式：

```bash
ANNA_RESEARCHER_FAKE_SAMPLING=1
ANNA_RESEARCHER_FAKE_TAVILY=1
```

真实 Tavily 检索需要：

```bash
TAVILY_API_KEY=<key>
```

Job store 默认写入：

```text
~/anna-workspace/researcher/{jobs-id}/{research_id}.json
```

测试或本地隔离时可以设置：

```bash
ANNA_RESEARCHER_WORKSPACE=/tmp/some-workspace
ANNA_RESEARCHER_JOBS_ID=jobs-local
```

## Issue Tracker 和 PRD

本仓库使用本地 markdown issue tracker：

- PRD：`.scratch/<feature-slug>/PRD.md`
- Issues：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 状态行使用 `Status: ...`
- 可用状态见 `docs/agents/triage-labels.md`

当前 MVP PRD：

```text
.scratch/anna-app-adapter-mvp/PRD.md
```

当前 MVP issues：

```text
.scratch/anna-app-adapter-mvp/issues/
```

## 代码风格

- Python 代码保持简单、可测试、少依赖。
- 优先使用标准库；引入第三方依赖前先确认必要性。
- 深模块要有稳定小接口，避免让 UI、JSON-RPC、job store 和业务逻辑互相缠绕。
- 前端保持 Anna 可加载的静态 SPA 输出；源码使用 Vite + React + TypeScript，构建结果提交到 `bundle/`。
- 不要用外部 CDN 或远程静态资源。
- 用户可见错误要清晰，不要吞掉配置错误、sampling 错误或 retrieval 错误。

## 测试策略

新增行为时优先补离线测试，避免依赖真实 Anna/Tavily/LLM：

- dispatcher action 行为。
- job store 创建/读取/更新/损坏记录。
- orchestrator stage 顺序。
- fake sampling 请求 metadata。
- fake Tavily retrieval。
- Lexical Context Selector 的排序、去重和 context budget。
- bundle contract：SPA 是否调用正确 action，是否展示状态和结果。

测试应验证外部行为，不要锁死私有实现细节。

## 安全和凭据

- Tavily key 只从 Anna 注入的 `context.credentials` 或本地环境变量读取。
- 不要把 credential 放进工具参数 schema。
- 不要把 credential 写进 job store、日志、测试 fixture 或前端代码。
- Sampling metadata 只带审计需要的信息，例如当前 invoke id、stage、query。

## 进一步阅读

- `CONTEXT.md`：领域语言和已确认决策。
- `docs/anna/tool-calls-llm-agent-latest.md`：Anna App / Executa Tool 调用 Anna LLM 与 Agent 的最新实现方案。
- `anna-executa-examples/docs/protocol-spec.zh-CN.md`：Executa JSON-RPC 协议。
- `anna-executa-examples/docs/sampling.zh-CN.md`：Anna Sampling LLM。
- `anna-executa-examples/examples/anna-app-focus-flow/`：Anna App + Executa 结构参考。
