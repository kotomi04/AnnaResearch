# Anna Researcher 产品化路线图

Status: draft

## 目标

将 Anna Researcher 从当前的 sectioned research MVP 升级为产品级 deep research app。

目标体验应支持更丰富的联网搜索、网页全文证据采集、更强的上下文选择、多阶段 deep research、更高质量的报告生成、导出、可观测性和文件导入，同时保持 Anna App Shell 与 Researcher Tool Backend 的边界清晰。

## 当前差距

当前 Anna Researcher 已支持：

- 用户确认研究角色、研究重点和报告大纲。
- 分章节研究工作流。
- 基于 Tavily 的 Research Source 调用。
- Lexical Context Selector。
- 基于 Anna `llm.complete` 的章节写作。
- Markdown 研究结果持久化。

相比 GPT Researcher / STORM / Perplexity 类产品，当前主要差距是：

- 搜索仍偏浅，主要依赖 snippet。
- 没有完整网页抓取。
- 没有文件导入。
- 没有语义级上下文选择。
- 没有递归 deep research task tree。
- 没有 multi-agent 报告审阅、编辑和修订流程。
- 没有报告导出。
- 没有 streaming 研究日志。
- 没有成本统计。
- 引用质量和事实校验较弱。

## 需求

### 1. 搜索与来源扩展

在 Tavily 之外增加更多联网搜索能力。

- 增加 DDGS / DuckDuckGo 作为 Native Research Source。
- 优化 Tavily 调用和结果标准化。
- 保持所有来源输出统一 item 结构：`source_id`、`source_name`、`query`、`url`、`title`、`content`。
- 保留现有可配置 Research Source envelope，用于用户自定义 JSON API。

### 2. 完整网页抓取

搜索结果不应停留在 snippet。

- 对选中的搜索结果 URL 抓取并清理全文内容。
- 合并 search snippet、网页正文、URL、title 和 metadata。
- 处理超时、重复 URL、抓取失败和超长内容。
- 后续支持 PDF 抽取。

### 3. Context Selector 升级

提升报告写作前的 evidence selection。

- 增加 BM25 风格 lexical scoring。
- 增加 Anna-managed embedding similarity 作为可选语义分数。
- 对 top candidates 做 rerank。
- 增加 source credibility scoring。
- 保留 score breakdown，方便调试。

可能的评分公式：

```text
final_score =
  bm25_score
  + embedding_similarity
  + source_credibility
  + freshness_score
  + original_rank_score
```

可信度分数可以先从后端规则权重开始，后续再加入 LLM 辅助标签。

### 4. Deep Research 工作流

从当前 section loop 升级为多阶段深度研究。

- 支持递归或多阶段任务分解。
- 在 UI 中渲染 deep search task tree。
- 跟踪子任务、queries、source calls、evidence 和状态。
- 增加 depth、branch count、source calls、time、cost 等限制。
- 支持长任务 checkpoint recovery。

### 5. Multi-Agent 报告生成

从单一 confirmed role 升级为分角色生成流程。

建议角色：

- `researcher`：发现证据缺口并提出搜索。
- `writer`：基于上下文写章节草稿。
- `reviewer`：检查引用覆盖和弱证据 claim。
- `editor`：优化结构、去重和表达。
- `reviser`：根据 review feedback 修改。
- `publisher`：组装最终报告和附录。

先做 prompt-level 角色分离，再考虑完整 Anna Agent sessions。

### 6. 引用质量与事实校验

提高报告可信度。

- 检查重要结论是否有来源支撑。
- 检测缺失引用或虚假引用。
- 对 source credibility 进行排序。
- 检测 contradictory evidence。
- 标记 unsupported 或 weakly supported claims。

### 7. 报告导出

支持产品级输出格式。

- Markdown 导出。
- PDF 导出。
- DOCX 导出。
- 可选 source appendix 和 citation table。

### 8. Streaming 日志与可观测性

提升长任务可见性。

- 展示 source calls、任务进度、章节状态和 review steps。
- 增加 streaming 或 event-style 研究日志。
- 保留足够日志用于恢复和调试。

### 9. 成本统计

统计并展示使用量。

- LLM completion 次数。
- Embedding 次数。
- Search API 调用次数。
- Fetched page 数量。
- 估算 token usage 和 cost。
- 每个章节的成本摘要。

### 10. 文件导入

支持用户提供文档作为研究来源。

- 先支持 TXT / Markdown。
- 后续增加 PDF 和 DOCX。
- 将上传文件视为 Local Research Source。
- 文件 chunk 复用 context selection pipeline。

## 优先级

### P0

- DDGS / 扩展 Research Sources。
- 完整网页抓取。
- Context Selector 升级，先做 BM25 和可信度。
- Citation coverage validator。

### P1

- Deep research task tree。
- Deep search UI 渲染。
- Checkpoint recovery。
- Follow-up search generation。

### P2

- Multi-agent 报告生成流程。
- Reviewer / editor / reviser passes。
- Contradiction detection。
- Semantic embedding rerank。

### P3

- 报告导出。
- Streaming logs。
- 成本统计。
- 文件导入。
- Research history、retry 和 cancel。

## 建议排期

### 6.18：搜索源扩展与 Tavily 整理

目标：先补足后续功能依赖的 evidence 来源。

- 实现 DDGS / DuckDuckGo Native Research Source。
- 整理 Tavily API 输出，统一 normalized item 结构。
- 明确 Research Source 返回字段：`source_id`、`source_name`、`query`、`url`、`title`、`content`。
- 补充离线 fake source / contract tests。

### 6.22：完整网页抓取

目标：从 snippet-based search 升级为 page-content evidence。

- 对搜索结果 URL 抓取正文。
- 清理 HTML、去重 URL、处理 timeout 和 fetch failure。
- 将 snippet 与 fetched content 合并为统一 evidence item。
- 为后续 context selector 保留 metadata。

### 6.23：Context Selector 升级

目标：让证据选择能利用更完整的网页内容。

- 实现 BM25 / lexical score。
- 加入 source credibility 基础规则。
- 输出 score breakdown。
- 预留 Anna embedding rerank 接口，但不强制作为默认路径。

### 6.24：递归搜索能力

目标：从 section loop 升级为 deep search 的第一版。

- 实现 follow-up question / follow-up query generation。
- 增加 task tree / subtask 状态模型。
- 设置 max depth、max branches、max source calls 等安全上限。
- UI 初步渲染 deep search 过程。

### 6.25：Multi-Agent 报告生成

目标：从单一 confirmed role 升级为分角色生成流程。

- 增加 researcher / writer / reviewer / editor / reviser / publisher 的 prompt-level roles。
- 先实现 reviewer -> reviser 的最小闭环。
- 保持最终报告仍由代码组装，避免完全交给 LLM 重写全文。

### 6.26：引用质量、事实校验与研究日志

目标：增强可信度和过程可见性。

- Citation coverage validator。
- 检测 missing / fake citation。
- 初步 claim support check。
- 初步 contradictory evidence detection。
- 增加 event-style research log。

### 后续：导出、文件导入与成本统计



- 报告导出：Markdown / PDF / DOCX。
- 文件导入：TXT / Markdown first，后续 PDF / DOCX。
- 成本统计：LLM completion、embedding、search calls、fetched pages、per-section cost。