# 待人工判定的事实性题目清单（mismatch / delete）

> 自动生成（脚本思路见本次会话，可复现）。机器可验的都已验完（全库 `noanchor=0`），以下 **43 道**需要人工判是「事实错误」还是「写法差异」。
>
> - **软 mismatch**：缺失项全是符号/公式，judge 已标「疑似写法差异，请确认后可放行」——大概率只是记号不同，确认后可放行并翻 `reviewed`。
> - **硬 mismatch / delete**：缺失项是具体事实 claim，源里真找不到——需通读判。若是事实错就改题，若是写法差就调整锚点后重判。

## 总览

- 待判定合计：**43**（mismatch 40 + delete 3）
- 软 mismatch（符号/公式差异，低风险）：**18**
- 硬 mismatch（含具体事实 claim 缺失）：**22**
- delete（≥2 个 claim 在源里完全找不到，疑似编造）：**3**

## 一、软 mismatch（18，疑似写法差异，可优先放行）

| 题目 id                         | 源笔记                                                                              | 源里找不到的项                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lstm-mitigate-not-eliminate`   | `static/notes/01-machine-learning/07-RNN与序列/01-RNN-LSTM-GRU.md`                  | 1.48                                                                                                   |
| `guardrail-tripwire`            | `static/notes/04-ai-agent/03-Agent框架/03-OpenAI Agents SDK.md`                     | GuardrailFunctionOutput(..., tripwire_triggered=...)                                                   |
| `advisor-role`                  | `static/notes/04-ai-agent/05-Java-TS Agent生态/01-Spring AI Agent.md`               | aroundCall(request, chain)                                                                             |
| `hybrid-dense-sparse`           | `static/notes/04-ai-agent/06-RAG进阶/02-向量数据库选型.md`                          | ERR-4021，-4021                                                                                        |
| `entity-auth-isolation`         | `static/notes/04-ai-agent/08-工具平台与沙箱/02-Composio工具平台.md`                 | initiate_connection(app=..., entity_id="user-alice")，get_tools(actions=[...], entity_id="user-alice") |
| `context-trim-direction`        | `static/notes/04-ai-agent/10-记忆与状态/02-对话管理与上下文.md`                     | ContextOptimizer.truncate_middle，ContextOptimizer.compress_history                                    |
| `runtime-vs-embedded-layer`     | `static/notes/04-ai-agent/11-Agent记忆框架/02-Letta-MemGPT记忆系统.md`              | memory.search()，memory.add()                                                                          |
| `drop-params-tradeoff`          | `static/notes/04-ai-agent/13-AI网关与路由/01-LiteLLM统一接口.md`                    | 200                                                                                                    |
| `gateway-alias-indirection`     | `static/notes/04-ai-agent/13-AI网关与路由/02-Vercel AI SDK与Gateway.md`             | openai('...')                                                                                          |
| `word-overlap-similarity-limit` | `static/notes/04-ai-agent/14-可观测与评估/05-Agent测试工程实战.md`                  | str.split                                                                                              |
| `autocompact-circuit-breaker`   | `static/notes/04-ai-agent/14-可观测与评估/06-Agent成本优化工程.md`                  | 3272，1279                                                                                             |
| `default-approval-level`        | `static/notes/04-ai-agent/15-Agent安全与治理/02-Agent治理框架.md`                   | dict.get                                                                                               |
| `map-not-manual`                | `static/notes/04-ai-agent/16-Harness Engineering/01-Harness Engineering完整指南.md` | 2000                                                                                                   |
| `openai-compat-boundary`        | `static/notes/04-ai-agent/21-云厂商Agent方案/01-阿里云百炼与通义.md`                | OpenAI(base_url="…/compatible-mode/v1")                                                                |
| `save-vs-publish`               | `static/notes/04-ai-agent/22-低代码平台/03-n8n与Flowise.md`                         | 1.14                                                                                                   |
| `linear-graph-no-sql-retry`     | `static/notes/04-ai-agent/23-实战案例/03-数据分析Agent.md`                          | updated_at，add_conditional_edges                                                                      |
| `memorysaver-with-interrupt`    | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                        | PostgresSaver.from_conn_string(...)                                                                    |
| `rerun-whole-crew-cost`         | `static/notes/04-ai-agent/23-实战案例/06-内容创作Agent.md`                          | max_iterations=3                                                                                       |

## 二、硬 mismatch（22，需通读）

| 题目 id                                | 源笔记                                                                        | 源里找不到的项                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `hashing-open-vocab`                   | `static/notes/01-machine-learning/03-特征工程/02-类别与高基数特征.md`         | d < V                                                                |
| `task-context-dependency`              | `static/notes/04-ai-agent/03-Agent框架/02-CrewAI多Agent协作.md`               | 任务之间的依赖                                                       |
| `sequential-vs-hierarchical`           | `static/notes/04-ai-agent/03-Agent框架/02-CrewAI多Agent协作.md`               | 调度权归谁，tools=[...]                                              |
| `handoff-who-routes`                   | `static/notes/04-ai-agent/03-Agent框架/03-OpenAI Agents SDK.md`               | 可交接的候选集                                                       |
| `output-key-state-passing`             | `static/notes/04-ai-agent/03-Agent框架/04-Google ADK详解.md`                  | 具名的、由作者指定注入位置的                                         |
| `groupchat-vs-graphflow`               | `static/notes/04-ai-agent/03-Agent框架/07-Microsoft Agent Framework.md`       | 控制流归属                                                           |
| `event-driven-routing`                 | `static/notes/04-ai-agent/04-Agent框架补充/02-LlamaIndex Agent与Workflow.md`  | 事件类型匹配                                                         |
| `agentic-rag-tool-description`         | `static/notes/04-ai-agent/04-Agent框架补充/02-LlamaIndex Agent与Workflow.md`  | 功能性契约                                                           |
| `eval-code-tool-risk`                  | `static/notes/04-ai-agent/05-Java-TS Agent生态/02-Vercel AI SDK Agent开发.md` | CodeSandbox                                                          |
| `validate-at-tool-side`                | `static/notes/04-ai-agent/07-工具与Function Calling/03-工具编排与安全.md`     | {"sql": "DROP TABLE orders"}                                         |
| `hook-failure-strategy`                | `static/notes/04-ai-agent/07-工具与Function Calling/04-Agent可扩展性设计.md`  | onReject: block，onFailure: injectContext                            |
| `voting-is-llm-judgement`              | `static/notes/04-ai-agent/09-多Agent系统/02-Agent通信与协调.md`               | {Agent 名: 意见}                                                     |
| `entity-memory-role`                   | `static/notes/04-ai-agent/10-记忆与状态/01-短期与长期记忆.md`                 | {role: 产品经理, project: 电商项目, deadline: 下周}                  |
| `checkpointer-persistence-purpose`     | `static/notes/04-ai-agent/10-记忆与状态/02-对话管理与上下文.md`               | VectorMemory                                                         |
| `regression-assert-shape`              | `static/notes/04-ai-agent/14-可观测与评估/03-Agent评估与基准.md`              | result["output"]                                                     |
| `guardrail-eval-parse`                 | `static/notes/04-ai-agent/14-可观测与评估/04-安全与对齐.md`                   | json.loads，NameError，300                                           |
| `redteam-leak-oracle`                  | `static/notes/04-ai-agent/14-可观测与评估/04-安全与对齐.md`                   | "系统提示" in response.lower()                                       |
| `sandbox-resolve-before-check`         | `static/notes/04-ai-agent/15-Agent安全与治理/03-Agent安全纵深防御实战.md`     | ..，%2e                                                              |
| `sql-keyword-blacklist-false-positive` | `static/notes/04-ai-agent/23-实战案例/03-数据分析Agent.md`                    | UPDATED_AT，SELECT COUNT(*) ... 'paid'，ORDER BY price DESC LIMIT 10 |
| `approval-inside-tool`                 | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                  | kubectl scale                                                        |
| `severity-router-auto-resolve`         | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                  | acknowledged，deferred                                               |
| `eval-fail-open`                       | `static/notes/04-ai-agent/23-实战案例/06-内容创作Agent.md`                    | 围栏，一旦解析失败，，continue                                       |

## 三、delete（3，疑似编造，需确认）

| 题目 id                  | 源笔记                                                                       | 源里找不到的项                                                               |
| ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `sdk-vs-agentcore-split` | `static/notes/04-ai-agent/03-Agent框架/06-AWS Strands与Bedrock AgentCore.md` | Agent 是什么，跑在生产上需要的那些横切能力                                   |
| `result-type-guarantee`  | `static/notes/04-ai-agent/03-Agent框架/08-AG2-PydanticAI-Agno.md`            | 请求，闸门                                                                   |
| `permission-check-order` | `static/notes/04-ai-agent/23-实战案例/07-从Claude Code学构建生产级Agent.md`  | )`这类模式，而黑名单里是`FileRead(~~/.ssh/，)`覆盖了`~~/.ssh/，~/.ssh/id_rsa |
