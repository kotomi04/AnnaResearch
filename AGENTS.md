# AGENTS.md

本文件是给代码 agent 使用的项目说明。修改代码前先阅读本文件，并按任务范围继续读取 `CONTEXT.md`、相关 ADR、PRD、issue 和 Anna 协议文档。

## 项目概览

本仓库是将开源 `gpt-researcher` 的研究能力适配为 Anna App 的工作区。当前实现已经超过最初的 Adapter MVP：Anna App Shell 负责用户交互和研究编排，独立 Researcher Tool Backend 负责持久化、检索、附件处理、上下文选择及其他非前端工作。

主要目录：

- `gpt-researcher/`：上游 GPT Researcher 源码和文档。尽量保持接近上游，不要把 Anna 专用代码写进其 backend/frontend。
- `anna-executa-examples/`：Anna App / Executa 示例与协议资料，仅作参考；若与当前 Anna reference 或本仓库最新决策冲突，不应直接照搬旧示例。
- `anna-researcher-app/`：Vite + React + TypeScript Anna App Shell、App manifest、Executa reference 和 App 侧测试。
- `researcher-tool/`：独立 Researcher Tool Project，是 Researcher Tool Backend 的源码和打包入口。
- `CONTEXT.md`：领域词汇和已确认边界。实现、issue、PRD 和测试名优先使用这里的术语。
- `docs/adr/`：架构决策。注意 ADR 的状态以及后续 ADR 对早期设计的 supersede。
- `docs/anna/`：本仓库确认过的 Anna LLM、Agent 和 Tool 调用约定。
- `.scratch/`：本地 Markdown PRD 和 issue tracker。
- `docs/agents/`：agent workflow 的本地约定。

## 当前架构

当前主要调用链：

```text
Anna App Shell (React)
  ├─ anna.tools.invoke
  │    -> App Executa Reference
  │    -> standalone Researcher Tool Backend
  │         ├─ Executa Local Job Store
  │         ├─ Research Sources / retrieval / extraction
  │         ├─ attachment processing and embeddings
  │         ├─ context selection
  │         └─ result persistence / transfer
  ├─ anna.llm.complete
  │    -> bounded frontend-owned planning, framing and rewrite work
  ├─ anna.agent.session({ submode: "auto" })
  │    -> section-scoped research and writing sessions
  └─ anna.files.*
       -> attachment object storage
```

现行默认工作流是 Guided Sectioned Research Workflow：

1. 创建可恢复的 Async Research Job。
2. 处理可选附件并生成附件上下文。
3. 生成并确认 Research Role。
4. 按 ADR-0009 生成 facet ledger、anchor query、sub-queries 和有覆盖保证的 outline draft。
5. 用户确认 Report Section Set 和 Allowed Research Sources。
6. 按 outline 顺序执行 Serial Section Research；每个未完成 section 使用独立前端 Agent session。
7. 每个 section 保存 evidence、selected context、Section Writer Output 和 Section Summary。
8. 使用 Report Framing 加已保存的 section markdown 确定性组装 Assembled Research Report。

`autonomous_agent` 是实验性执行模式；`guided_sections` 仍是默认路径。不要把上游 GPT Researcher 的 detailed/deep/resource/outline/multi-agent report 类型直接混入当前 Anna 工作流，除非有新的明确决策。

## 决策和文档优先级

遇到文档、代码和在线 reference 不一致时，不要静默选择。按以下顺序处理：

1. 用户当前明确要求。
2. 当前目录适用的 `AGENTS.md`。
3. 已接受且未被 supersede 的 ADR；较新 ADR 优先于其明确替代的旧设计。
4. `CONTEXT.md` 中的当前领域语言和已确认决策。
5. 当前实现及其外部行为测试所体现的契约。
6. Anna staging developer reference 的原始 Markdown 页面。
7. `docs/anna/` 和 `anna-executa-examples/` 中的本地协议资料。
8. 早期 PRD、已完成 issue 和上游示例。

如果在线 reference 与 `docs/anna/tool-calls-llm-agent-latest.md` 冲突，必须明确记录冲突，并优先通过当前 runtime frame、平台源代码或最小真实联调验证，不能仅凭文档标题中的 “latest” 推断。当前已知冲突包括 `invoke_id` / `sampling_token` 位于 `params.context` 还是 `params` 顶层，以及 initialize 返回的 sampling capability 字段形状。兼容代码可以读取新旧位置，但新测试必须明确其主契约。

## 关键工作约束

- 不要自行启动 `anna-app dev`。
- 如果需要 Anna App dev server 或 Anna runtime 联调，先说明用户需要在 `anna-researcher-app/` 下运行的命令，由用户启动。
- 不要自行启动长时间运行的 Anna bridge、Anna runtime、GUI 或其他本地服务，除非用户明确要求。
- 不要把 Anna 专用适配代码写进 `gpt-researcher/backend` 或 `gpt-researcher/frontend`。
- App UI 和前端编排写在 `anna-researcher-app/src/`；后端工具逻辑写在 `researcher-tool/`。
- `anna-researcher-app/executas/researcher-python/` 只能保持为最小 App Executa Reference，不要复制或重新嵌入 backend 源码。
- 不要恢复早期的单一 `research` action dispatcher、`start|advance|get_status|get_result` 合约或 backend-owned orchestrator。
- 前端 LLM/Agent 推理和 backend 非 LLM 工作应保持边界清晰。只有已有、明确设计为 Executa reverse RPC 的能力才放入 backend sampling/embedding 路径。
- 不要把 OpenAI embedding 或外部聊天 LLM key 作为默认路径；模型调用应由 Anna host 管理。
- stdout 只能输出 LF 分隔的 JSON-RPC 2.0 协议帧；日志必须写 stderr，并在每次 stdout 写入后 flush。
- Executa 必须持续读取 stdin 到 EOF，不能在一次响应后退出；reverse RPC 响应与 forward request 共用同一 stdin reader。
- 单条 stdio 响应可能超过平台限制时，使用项目已有的受控 transfer 边界或平台支持的大响应机制，不要把大正文直接塞进工具响应。
- 修改用户已有改动时要谨慎；不要 revert、覆盖或格式化无关改动。
- 不要手改 `anna-researcher-app/bundle/` 生成文件。改 `src/` 后运行 build 生成。

## 开发位置

### Anna App Shell

```text
anna-researcher-app/
├── manifest.json                  # App grants、required Executa、UI manifest
├── app.json                       # App metadata 和 bundled Executa 映射
├── executas/researcher-python/    # 指向独立 researcher-tool 的最小 reference
├── src/
│   ├── api/                       # Anna runtime、tools、Agent、APS Files 边界
│   ├── components/                # 页面与展示组件
│   ├── hooks/useResearchJob.ts    # 前端拥有的研究编排主流程
│   ├── i18n/                      # 中英文 App Shell 文案
│   ├── workflow/                  # workflow projection 和运行事件
│   └── types.ts                   # 前端领域类型
├── tests/frontend/                # Vitest / Testing Library
└── tests/                         # bundle、Executa contract、backend unit tests
```

UI 支持中文和英文；locale 只影响 App Shell 文案，不应强制改变 Research Result 的语言。

### Researcher Tool Backend

```text
researcher-tool/
├── researcher_plugin.py           # Executa JSON-RPC 入口和 reverse RPC 分发
├── executa.json                   # 独立 Executa metadata
└── researcher_tool/
    ├── dispatcher.py              # 显式 app_* App Tool Methods
    ├── job_store.py               # Executa Local Job Store
    ├── outline_discovery.py       # facet-covered outline discovery
    ├── attachments.py             # 附件准备和抽取
    ├── attachment_embeddings.py   # Anna-managed embedding checkpointing
    ├── context_selector.py        # Lexical Context Selector
    ├── hybrid_context_selector.py # Hybrid Context Selector
    ├── result_transfer.py         # 大结果本地 transfer 边界
    ├── settings.py                # 本地 Researcher Tool Settings
    ├── sources/                   # Built-in / User-Configured Research Sources
    └── errors.py                  # 稳定错误类型
```

App-facing contract 使用显式 `app_*` 方法。新增复杂 job 行为时优先增加窄而稳定的方法，不要把 `app_update_research_job` 扩展成任意 JSON 写入口。

## Anna 接口约束

- App iframe 调 backend：`anna.tools.invoke({ tool_id, method, args })`；不要把 `args` 写成 `arguments`。
- Mint-only `tool_id` 调用时必须显式提供 `method`。
- App iframe 单轮推理：`anna.llm.complete(...)`；它是 stateless，调用方必须携带完整上下文。
- 多轮或流式 section 工作：`anna.agent.session({ submode: "auto" })`，使用后在成功和失败路径都删除 session。
- Agent tool frames 不应被当成模型正文；final/complete 文本优先于累计 delta，避免内容重复。
- App attachment 使用 `anna.files.*`，持久化逻辑路径而不是短期 download URL。
- Tool reverse sampling 使用 `sampling/createMessage`；plugin 不应读取 sampling token 后自行请求 Anna HTTP API。
- `describe` 必须直接返回 manifest；`invoke` 成功结果必须显式包含 `success: true`。
- credential 不得出现在 tool parameters schema 中。
- `manifest.ui.host_api` 是 iframe Host API 的实际 ACL；`permissions` 主要用于展示/审计，不能替代逐 namespace grant。

开发 Anna LLM、Agent、embedding 或 Executa reverse RPC 前，至少阅读：

- `docs/anna/tool-calls-llm-agent-latest.md`
- Anna staging reference 对应的 `.md` 专题页
- 相关代码路径的 contract tests

## Research Sources 和附件边界

- Research Sources 包括 Built-in 与受限 envelope 内的 User-Configured Research Source。
- Allowed Research Sources 是 Report Section 级严格白名单，不是推荐列表。
- section 内重复的 `(source_id, normalized_query)` 应拒绝；跨 section 可以重复。
- User-Configured source 只支持当前 ADR 定义的受限 JSON-over-HTTP envelope。不要擅自加入 OAuth、HMAC、脚本、multipart 或任意代码执行。
- credential 只保存在专用 credential/settings 边界，返回前必须 mask；不得进入 job、日志、fixture、前端 bundle 或 LLM prompt。
- 附件文件存放在 Anna Files/APS；job 中只保存处理所需 metadata、路径、分析和引用信息。
- Embedding 使用 Anna-managed 路径并保留失败 checkpoint；不要引入外部 OpenAI embedding 默认配置。
- 抽取到的网页、PDF、附件内容必须经过 context budget 和 selector 边界，不能无界传给 LLM。

## 本地验证命令

优先运行不依赖真实 Anna、Tavily、外部 LLM 或公网的离线验证。

Python 聚合测试：

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
python -m compileall -q researcher-tool anna-researcher-app/tests
```

不要为了运行 pytest 或其他工具贸然安装依赖。需要新增依赖或联网安装时，先说明必要性并征求用户同意。

## Anna App 真实联调

不要自行运行：

```bash
cd anna-researcher-app
anna-app dev
```

如确实需要联调，应告诉用户：

1. 在 `anna-researcher-app/` 下启动 `anna-app dev`。
2. 确认 bundled Researcher Executa 能从 `researcher-tool/` 启动。
3. 为使用到的 Built-in Research Source 配置 credential，或选择无需 credential 的可用 source。
4. 为 App/Executa 开启本次路径需要的 LLM、Agent、embedding、files grant。
5. 将 runtime frame、日志、端口或具体错误提供给 agent 继续排查；不要提供 secret 值。

## 持久化和环境

- Researcher Tool Settings、Research Sources 和 jobs 默认位于 `~/anna-workspace/.research` 体系；以 `settings.py` 和 `job_store.py` 的当前实现为准。
- 测试必须通过临时 workspace 或现有 override 隔离，不得读写用户真实 job/settings。
- Tavily credential 可以由 Researcher Tool Settings 管理；本地开发的环境变量 fallback 以当前实现为准。
- 不要在文档中固化已经移除的旧 job path 或 fake 环境变量；新增或修改环境变量时同时更新测试和本节。

## Issue Tracker 和 PRD

本仓库使用本地 Markdown issue tracker：

- PRD：`.scratch/<feature-slug>/PRD.md`
- Issues：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 状态行使用 `Status: ...`
- 可用状态见 `docs/agents/triage-labels.md`

`.scratch/anna-app-adapter-mvp/` 是历史起点，不再是当前全部产品范围。开始任务时应根据用户需求、相关 ADR 和当前代码定位最新 PRD/issue，不要默认只读取最早 MVP PRD。

## 代码风格

- Python 保持清晰、可测试，深模块提供稳定小接口。
- 优先复用现有模块边界；新增第三方依赖前确认必要性、体积、打包和离线测试影响。
- 避免让 React UI、Anna Host API、JSON-RPC、job store、retrieval 和 LLM prompt 相互缠绕。
- 前端源码使用 Vite + React + TypeScript，不使用外部 CDN 或远程静态资源。
- 用户可见错误必须清晰，不能吞掉 grant、credential、sampling、Agent、embedding、retrieval、transfer 或 store 错误。
- Job schema 变化需要考虑旧记录恢复和 normalization，不要只支持新建记录。

## 测试策略

新增或修改行为时优先补离线外部行为测试：

- Executa `initialize`、`describe`、`health`、`invoke` 和 unknown method contract。
- App Tool Methods 的参数验证、稳定错误和持久化结果。
- job store 创建、读取、恢复、schema normalization、损坏记录和 section checkpoint。
- Research Source registry、credential masking、whitelist、duplicate-call prevention 和 fake retrieval。
- attachment extraction、embedding checkpoint、context budget 和引用映射。
- Lexical / Hybrid Context Selector 的排序、去重、source diversity 和预算。
- 前端 role/outline/section workflow、Agent frame normalization、失败恢复和报告组装。
- manifest / bundle contract：Host API grants、tool id/method、静态资源和 legacy contract absence。
- 大结果 transfer 的 compact inline fallback 和完整 payload 路径。

测试验证外部行为，不要锁死私有实现细节。默认测试不得依赖真实 Anna runtime、真实 LLM、真实 Tavily 或公网。

## 安全和凭据

- 不要把 credential、sampling token、storage token、App token 或 presigned upload URL 写入日志、job、测试 fixture、前端状态快照或报告。
- credential 只能通过 Anna 注入的安全 context、Researcher Tool Settings 或专用 credential store 流转。
- 完整 credential 不得返回前端；只返回配置状态和 mask。
- Sampling/Agent metadata 只携带必要的非敏感关联信息。在线 reference 当前可能不会持久化 sampling metadata，因此不能把它当成唯一审计机制。
- Local Result Transfer Server 只能绑定 loopback，使用不可预测的临时授权信息，并限制 method、path、payload 大小和生命周期。
- User-Configured Research Source 的 URL、模板、字段路径和响应体必须按受限 envelope 校验，防止 credential 泄漏、SSRF 和无界抓取。

## 进一步阅读

- `CONTEXT.md`
- `docs/adr/0001-frontend-owned-researcher-tool-backend.md`
- `docs/adr/0003-unified-research-source-abstraction.md`
- `docs/adr/0004-constrained-configurable-research-source-envelope.md`
- `docs/adr/0006-guided-sectioned-research-workflow.md`
- `docs/adr/0007-section-scoped-frontend-agent-sessions.md`
- `docs/adr/0008-optional-autonomous-report-agent-session.md`
- `docs/adr/0009-facet-covered-outline-discovery.md`
- `docs/anna/tool-calls-llm-agent-latest.md`
- Anna staging developer reference：`https://staging.anna.partners/developers/reference.md`
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`
