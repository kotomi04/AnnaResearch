# 仓库贡献指南

## 项目结构与模块组织

核心 Python 包位于 `gpt_researcher/`，包含 actions、config、context、retrievers、scraper、LLM providers、memory、MCP 和工具函数等模块。FastAPI 后端、服务代码与报告模板位于 `backend/`。浏览器端资源分布在 `frontend/`，Next.js UI 包位于 `frontend/nextjs/`。文档站点位于 `docs/`，使用 Docusaurus。多智能体示例在 `multi_agents/` 和 `multi_agents_ag2/`。测试集中在 `tests/`，测试夹具示例包括 `tests/docs/doc.pdf`。

## 构建、测试与本地开发命令

- `pip install -r requirements.txt`：安装主 Python 依赖。
- `python -m uvicorn main:app --reload`：启动本地 FastAPI 应用，默认访问 `http://localhost:8000`。
- `pytest`：运行 `pyproject.toml` 中配置的 Python 测试套件。
- `docker compose up --build`：使用 Docker 构建并运行应用栈。
- `cd frontend/nextjs && npm run dev`：启动 Next.js UI 开发服务器。
- `cd frontend/nextjs && npm run build`：构建 Next.js UI。
- `cd docs && npm run start`：本地启动 Docusaurus 文档站点。

## 编码风格与命名约定

Python 使用 3.11+，遵循 PEP 8：4 空格缩进，函数和模块使用 `snake_case`，类名使用 `PascalCase`。配置读取应集中在 `gpt_researcher/config/`，新增抽象前优先复用现有 provider、retriever 等接口。前端代码遵循 `frontend/nextjs/` 中已有的 TypeScript/React 风格：组件使用 `PascalCase`，hooks 使用 `use*`，Tailwind class 由 Prettier 和 Tailwind 插件格式化。

## 测试指南

主要测试框架是 Pytest。新增测试文件命名为 `test_*.py`，放在 `tests/` 或更聚焦的子目录中。优先为 retriever、日志、报告生成、MCP 行为和安全敏感工具编写小而明确的测试。迭代单个文件时可运行 `pytest tests/test_quick_search.py`；提交大范围改动前运行 `pytest`。

## 提交与 Pull Request 规范

近期提交信息通常简洁，并按范围或意图加前缀，例如 `fix/streaming-empty-chunks-flush`、`feat/xquik-retriever` 或 `Refine GPT Researcher description in README`。保持提交聚焦；如行为变化不明显，在正文中说明原因和影响。PR 应包含清晰摘要、关联 issue（如有）、测试结果；涉及 UI 的改动需附截图或录屏。若需要环境变量或迁移步骤，也要在 PR 中说明。

## 安全与配置提示

不要提交密钥。从 `.env.example` 开始配置本地环境，并将 `OPENAI_API_KEY`、`TAVILY_API_KEY` 等值放入未跟踪的 `.env`。网页抓取、文件加载和报告导出路径都属于安全敏感区域；修改清理、权限或路径逻辑时应补充回归测试。
