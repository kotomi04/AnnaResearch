# Anna Researcher

Anna Researcher 是把 GPT Researcher 风格的 Web 研究报告能力适配为 Anna App 的工作区。

当前实现不是把原始 GPT Researcher 的 FastAPI 后端和前端完整迁移到 Anna。它是一个聚焦的 Anna App Adapter：静态 Anna App Shell 负责用户工作流和 LLM 推理，独立的 Executa 工具后端负责本地设置、Research Source 调用、上下文选择和结果持久化。

## 这个仓库在做什么

当前主路径是：

```text
Anna App Runtime
  -> anna-researcher-app 静态 SPA
  -> anna.llm.complete 做有边界的研究推理
  -> anna.tools.invoke 调用 app_* 方法
  -> researcher-tool 独立 Executa 后端
  -> Tavily 或用户配置的 JSON API Research Source
  -> Lexical Context Selector
  -> Executa Local Job Store 和本地结果传输服务
```

产品工作流是一个 guided Sectioned Research Job：

1. 用户先配置至少一个 Research Source。
2. Anna App Shell 创建一个 Async Research Job。
3. 前端通过 LLM completion 生成研究角色候选、研究重点候选和报告大纲草稿。
4. 用户确认角色、重点和 Report Sections。
5. 系统按大纲顺序串行研究每个 section。
6. 每个 section 调用允许的 Research Sources，选择有边界的上下文，并生成 section markdown 与 Section Summary。
7. Report Framing 只生成标题、引言和结论。
8. 代码把 framing 输出和各 section markdown 组装成最终 Research Result。

## 目录结构

```text
.
├── anna-researcher-app/       # Anna App Shell：Vite + React + TypeScript 静态 SPA
│   ├── src/                   # 前端源码入口
│   ├── bundle/                # Anna 加载的构建产物，不要手写修改
│   ├── executas/              # 指向仓库根目录 researcher-tool/ 的最小 App Executa Reference
│   ├── manifest.json          # Anna App 权限、视图、host API 和工具版本要求
│   └── tests/                 # 前端、contract、smoke 和离线后端测试
├── researcher-tool/           # 独立 Python Executa Researcher Tool Backend
│   ├── researcher_plugin.py   # JSON-RPC stdio 入口
│   └── researcher_tool/       # app 方法、job store、settings、source registry、selector
├── gpt-researcher/            # 上游 GPT Researcher 源码，主要作为参考保留
├── anna-executa-examples/     # Anna App 和 Executa 协议示例
├── docs/adr/                  # Anna 适配相关架构决策
├── docs/anna/                 # Anna LLM / Agent tool-call 集成说明
├── .scratch/                  # 本地 markdown PRD 和 issue tracker
├── CONTEXT.md                 # 项目领域词汇和术语约定
└── AGENTS.md                  # coding agent 项目约束
```

多数新实现应该放在 `anna-researcher-app/` 或 `researcher-tool/`。不要把 Anna 专用适配代码写进 `gpt-researcher/backend` 或 `gpt-researcher/frontend`。

## 主要组件

### Anna App Shell

`anna-researcher-app/src/` 是用户界面的源码入口。它拥有研究工作流，并直接调用 Anna host APIs：

- `anna.llm.complete`：用于角色选择、重点 brainstorm、大纲生成、section research decision、section 写作和 report framing。
- `anna.tools.invoke`：用于调用 Researcher Tool Backend 暴露的显式 `app_*` 方法。

前端使用 Vite、React 和 TypeScript。构建输出在 `anna-researcher-app/bundle/`，这个目录是生成产物，不要直接编辑。

### Researcher Tool Backend

`researcher-tool/` 是独立的 Executa tool project。它实现 Executa JSON-RPC stdio 进程，并只暴露面向 app 的方法，例如：

- `app_list_research_sources`
- `app_update_research_source_credential`
- `app_create_research_job`
- `app_save_confirmed_research_outline`
- `app_call_section_research_source`
- `app_select_section_context`
- `app_save_section_result`
- `app_save_report_framing`
- `app_save_assembled_research_result`

后端不拥有 LLM 推理，也不声明 Anna Sampling 或 Agent 能力。它的职责是本地且确定性的：settings、credentials、source execution、context selection、persistence、compact job views，以及大 payload 的 transfer descriptor。

### Research Sources

Research Source 是统一的检索抽象。Tavily 是第一个 Built-in Research Source，用户也可以添加受约束的 JSON-over-HTTP User-Configured Research Source。

所有 Research Source 都输出同一种规范化结果，后续进入同一个 Lexical Context Selector。用户配置的 source 有意保持小边界：GET 或 POST JSON API、一个 token placeholder、有上限的 pagination、JSON response、固定 result mapping。OAuth、HMAC 签名、脚本、multipart body 和 streaming response 都不在当前范围内。

### 本地存储和结果传输

Researcher Tool Backend 默认把本地状态写到：

```text
~/anna-workspace/.research
```

这里包含 settings、source definitions、source credentials、job records 和 latest-job metadata。测试或本地隔离时可以设置 `ANNA_RESEARCHER_WORKSPACE` 改变根目录。

较大的 payload，例如 selected context、section markdown、report framing 和完整报告，通过一个临时的 loopback HTTP transfer server 传输。这个服务只绑定 `127.0.0.1`。App Tool Methods 仍然是控制面，只返回 transfer descriptor；本地 HTTP 服务不是公开 API。

## 环境要求

- Python 3.10 或更新版本
- Node.js 和 npm
- `uv`，用于通过 app executa reference 启动独立 Python tool
- Anna App Runtime，用于真实 Anna 集成
- Tavily API key，或用 `ANNA_RESEARCHER_FAKE_TAVILY=1` 开启离线 fake retrieval

Python tool 当前只使用标准库。前端依赖声明在 `anna-researcher-app/package.json`。

## 安装依赖

安装前端依赖：

```bash
cd anna-researcher-app
npm install
```

准备独立 tool 环境：

```bash
cd researcher-tool
uv sync
```

## 构建 Anna App Bundle

从 app 目录运行前端 build：

```bash
cd anna-researcher-app
npm run build
```

构建结果会写入 `anna-researcher-app/bundle/`。

## 运行测试

优先跑不依赖外部服务的离线测试：

```bash
python anna-researcher-app/tests/run_tests.py
```

运行前端测试：

```bash
cd anna-researcher-app
npm run test:frontend
```

运行 Python 语法检查：

```bash
python -m compileall -q researcher-tool/researcher_plugin.py researcher-tool/researcher_tool anna-researcher-app/tests
```

离线 fake retrieval 可以这样跑：

```bash
ANNA_RESEARCHER_FAKE_TAVILY=1 python anna-researcher-app/tests/run_tests.py
```

## 在 Anna 中运行

App manifest 位于 `anna-researcher-app/manifest.json`。它要求 Executa tool `tool-test-researcher-12345678` 版本不低于 `0.2.0`，并允许静态 SPA 使用：

- `tools.invoke`
- `ui.svg`
- host API `tools`
- host API `llm.complete`

App executa reference 位于：

```text
anna-researcher-app/executas/researcher-python/executa.json
```

它会从独立的 `researcher-tool/` 项目启动后端：

```bash
env UV_CACHE_DIR=/tmp/anna-researcher-uv-cache uv run --project ../../../researcher-tool tool-test-researcher-12345678
```

真实 Anna App 联调时，在 `anna-researcher-app/` 下启动 Anna dev server，并在 UI 中配置至少一个 Research Source credential。真实 Tavily 检索需要 Tavily key；离线开发可以使用 fake mode。

## 常用环境变量

```bash
# 使用确定性的 Tavily-shaped fake response，不访问真实 Tavily API。
ANNA_RESEARCHER_FAKE_TAVILY=1

# 当没有本地存储 credential 时，从环境变量提供 Tavily key。
TAVILY_API_KEY=...

# 隔离本地 settings、source config、credentials 和 job records。
ANNA_RESEARCHER_WORKSPACE=/tmp/anna-researcher-workspace
```

## 开发约束

- 保持 `gpt-researcher/` 接近上游。新的 Anna adapter 代码应放在 `anna-researcher-app/` 或 `researcher-tool/`。
- 不要手写修改 `anna-researcher-app/bundle/`；改 `src/` 后重新 build。
- 后端 stdout 只输出 JSON-RPC 协议帧；调试日志写 stderr。
- 不要把 credential 写进 job records、前端 assets、日志、fixtures 或 tool schemas。
- 保持 App Tool Methods 显式，不要把旧的通用 `research` action dispatcher 加回来。
- LLM 和 Agent 推理默认属于 Anna App Shell，除非新的 ADR 改变这个边界。
- 修改 Anna LLM 或 Agent 调用链前，先读 `docs/anna/tool-calls-llm-agent-latest.md`。

## 进一步阅读

- `CONTEXT.md`：领域词汇和推荐/避免使用的术语。
- `docs/adr/0001-frontend-owned-researcher-tool-backend.md`：frontend-owned orchestration 边界。
- `docs/adr/0002-temporary-local-result-transfer-server.md`：loopback transfer server 的原因和限制。
- `docs/adr/0003-unified-research-source-abstraction.md`：Research Source 模型。
- `docs/adr/0004-constrained-configurable-research-source-envelope.md`：用户配置 API 的能力边界。
- `docs/adr/0006-guided-sectioned-research-workflow.md`：当前 guided sectioned workflow。
