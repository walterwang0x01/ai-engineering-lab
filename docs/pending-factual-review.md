# 待人工判定的事实性题目清单（mismatch / delete）

> 自动生成。机器可验的都已验完（全库 `noanchor=0`），以下题目需要人工判是「事实错误」还是「写法差异」。
>
> **怎么看「源中痕迹」这一列**（决定你该花多少力气）：
>
> - `NONE`：源里一个 token 都找不到——**最可疑**，引用的数字/版本号/API 名可能根本不存在，优先查。
> - `SOME n/m`：部分 token 在源里，可能是写法差异，也可能真的错了一半。
> - `ALL`：token 全在源里，但表达式里没有强特征名（如 `dict.get` 只有 `dict`），证据弱，未自动放行。
> - `中文 claim`：中文是事实陈述，不适用 token 匹配，必须你自己读。

## 总览

- 待判定合计：**36**（mismatch 33 + delete 3）
- 其中**源里毫无痕迹**（NONE，最可疑）：**12**

> 本轮新增「代码签名 token 兜底」后，已自动放行 **7 道**（源里确有原文依据，只是解析写成了省略形式），已从本清单移除：
>
> `guardrail-tripwire`、`advisor-role`、`entity-auth-isolation`、`context-trim-direction`、`openai-compat-boundary`、`rerun-whole-crew-cost`、`hook-failure-strategy`

## 一、mismatch（33，按可疑度排序，NONE 在前）

| 题目 id                                | 源笔记                                                                              | 源里找不到的项                                                       | 源中痕迹             |
| -------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| `autocompact-circuit-breaker`          | `static/notes/04-ai-agent/14-可观测与评估/06-Agent成本优化工程.md`                  | 3272，1279                                                           | NONE，NONE           |
| `checkpointer-persistence-purpose`     | `static/notes/04-ai-agent/10-记忆与状态/02-对话管理与上下文.md`                     | VectorMemory                                                         | NONE                 |
| `drop-params-tradeoff`                 | `static/notes/04-ai-agent/13-AI网关与路由/01-LiteLLM统一接口.md`                    | 200                                                                  | NONE                 |
| `eval-code-tool-risk`                  | `static/notes/04-ai-agent/05-Java-TS Agent生态/02-Vercel AI SDK Agent开发.md`       | CodeSandbox                                                          | NONE                 |
| `eval-fail-open`                       | `static/notes/04-ai-agent/23-实战案例/06-内容创作Agent.md`                          | 围栏，一旦解析失败，，continue                                       | 中文 claim，NONE     |
| `guardrail-eval-parse`                 | `static/notes/04-ai-agent/14-可观测与评估/04-安全与对齐.md`                         | json.loads，NameError，300                                           | SOME 1/2，NONE，NONE |
| `hybrid-dense-sparse`                  | `static/notes/04-ai-agent/06-RAG进阶/02-向量数据库选型.md`                          | ERR-4021，-4021                                                      | NONE，NONE           |
| `linear-graph-no-sql-retry`            | `static/notes/04-ai-agent/23-实战案例/03-数据分析Agent.md`                          | updated_at，add_conditional_edges                                    | NONE，NONE           |
| `map-not-manual`                       | `static/notes/04-ai-agent/16-Harness Engineering/01-Harness Engineering完整指南.md` | 2000                                                                 | NONE                 |
| `memorysaver-with-interrupt`           | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                        | PostgresSaver.from_conn_string(...)                                  | NONE                 |
| `severity-router-auto-resolve`         | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                        | acknowledged，deferred                                               | NONE，NONE           |
| `sql-keyword-blacklist-false-positive` | `static/notes/04-ai-agent/23-实战案例/03-数据分析Agent.md`                          | UPDATED_AT，SELECT COUNT(*) ... 'paid'，ORDER BY price DESC LIMIT 10 | NONE，SOME 2/3，ALL  |
| `agentic-rag-tool-description`         | `static/notes/04-ai-agent/04-Agent框架补充/02-LlamaIndex Agent与Workflow.md`        | 功能性契约                                                           | 中文 claim           |
| `approval-inside-tool`                 | `static/notes/04-ai-agent/23-实战案例/05-自动化运维Agent.md`                        | kubectl scale                                                        | ALL                  |
| `default-approval-level`               | `static/notes/04-ai-agent/15-Agent安全与治理/02-Agent治理框架.md`                   | dict.get                                                             | ALL                  |
| `entity-memory-role`                   | `static/notes/04-ai-agent/10-记忆与状态/01-短期与长期记忆.md`                       | {role: 产品经理, project: 电商项目, deadline: 下周}                  | 中文 claim           |
| `event-driven-routing`                 | `static/notes/04-ai-agent/04-Agent框架补充/02-LlamaIndex Agent与Workflow.md`        | 事件类型匹配                                                         | 中文 claim           |
| `gateway-alias-indirection`            | `static/notes/04-ai-agent/13-AI网关与路由/02-Vercel AI SDK与Gateway.md`             | openai('...')                                                        | ALL                  |
| `groupchat-vs-graphflow`               | `static/notes/04-ai-agent/03-Agent框架/07-Microsoft Agent Framework.md`             | 控制流归属                                                           | 中文 claim           |
| `handoff-who-routes`                   | `static/notes/04-ai-agent/03-Agent框架/03-OpenAI Agents SDK.md`                     | 可交接的候选集                                                       | 中文 claim           |
| `hashing-open-vocab`                   | `static/notes/01-machine-learning/03-特征工程/02-类别与高基数特征.md`               | d < V                                                                | 无特征词             |
| `lstm-mitigate-not-eliminate`          | `static/notes/01-machine-learning/07-RNN与序列/01-RNN-LSTM-GRU.md`                  | 1.48                                                                 | 无特征词             |
| `output-key-state-passing`             | `static/notes/04-ai-agent/03-Agent框架/04-Google ADK详解.md`                        | 具名的、由作者指定注入位置的                                         | 中文 claim           |
| `redteam-leak-oracle`                  | `static/notes/04-ai-agent/14-可观测与评估/04-安全与对齐.md`                         | "系统提示" in response.lower()                                       | 中文 claim           |
| `regression-assert-shape`              | `static/notes/04-ai-agent/14-可观测与评估/03-Agent评估与基准.md`                    | result["output"]                                                     | ALL                  |
| `runtime-vs-embedded-layer`            | `static/notes/04-ai-agent/11-Agent记忆框架/02-Letta-MemGPT记忆系统.md`              | memory.search()，memory.add()                                        | ALL，ALL             |
| `sandbox-resolve-before-check`         | `static/notes/04-ai-agent/15-Agent安全与治理/03-Agent安全纵深防御实战.md`           | ..，%2e                                                              | 无特征词，无特征词   |
| `save-vs-publish`                      | `static/notes/04-ai-agent/22-低代码平台/03-n8n与Flowise.md`                         | 1.14                                                                 | 无特征词             |
| `sequential-vs-hierarchical`           | `static/notes/04-ai-agent/03-Agent框架/02-CrewAI多Agent协作.md`                     | 调度权归谁，tools=[...]                                              | 中文 claim，ALL      |
| `task-context-dependency`              | `static/notes/04-ai-agent/03-Agent框架/02-CrewAI多Agent协作.md`                     | 任务之间的依赖                                                       | 中文 claim           |
| `validate-at-tool-side`                | `static/notes/04-ai-agent/07-工具与Function Calling/03-工具编排与安全.md`           | {"sql": "DROP TABLE orders"}                                         | SOME 1/3             |
| `voting-is-llm-judgement`              | `static/notes/04-ai-agent/09-多Agent系统/02-Agent通信与协调.md`                     | {Agent 名: 意见}                                                     | 中文 claim           |
| `word-overlap-similarity-limit`        | `static/notes/04-ai-agent/14-可观测与评估/05-Agent测试工程实战.md`                  | str.split                                                            | ALL                  |

## 二、delete（3，≥2 个 claim 在源里完全找不到，疑似编造）

| 题目 id                  | 源笔记                                                                       | 源里找不到的项                                                               | 源中痕迹                     |
| ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `sdk-vs-agentcore-split` | `static/notes/04-ai-agent/03-Agent框架/06-AWS Strands与Bedrock AgentCore.md` | Agent 是什么，跑在生产上需要的那些横切能力                                   | 中文 claim，中文 claim       |
| `result-type-guarantee`  | `static/notes/04-ai-agent/03-Agent框架/08-AG2-PydanticAI-Agno.md`            | 请求，闸门                                                                   | 中文 claim，中文 claim       |
| `permission-check-order` | `static/notes/04-ai-agent/23-实战案例/07-从Claude Code学构建生产级Agent.md`  | )`这类模式，而黑名单里是`FileRead(~~/.ssh/，)`覆盖了`~~/.ssh/，~/.ssh/id_rsa | 中文 claim，中文 claim，NONE |
