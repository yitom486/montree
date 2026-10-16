# @montree/chat-core

聊天渲染纯逻辑层：**零 react、零 store、零 ACP 传输**。任何 UI（本包 `chat-ui`、外部 App 自研 UI）都吃这一层。

## 归属（M1 起陆续迁入，行为不变、只换 import 源）

| 迁入后文件 | 来源 | 说明 |
|------|------|------|
| `chat-feed.ts` + `.test.ts` | 新写（E1，对齐 `chat-slice`/`chat-helpers` 语义，行号见文件头） | `ChatFeedState/ChatFeedEvent/applyChatEvent` + `finalizeFeedMessages`；宿主保留回放清洗/合并器/快照队列/审批 ingest/隔离过滤 |
| `prune-agent-replies.ts` | `apps/desktop/src/lib/agent/acp-prune-agent-replies.ts` | 整搬（`AcpChatMessage`→`ChatMessage`）；宿主留单行兼容重导出 |
| `mark-promotion.ts`（增） | `apps/desktop/src/lib/agent/promote-mark-proposals.ts` 纯部 | `mergeProposals/currentTurnStart/collectToolProposals/promoteMarkProposalsToLastAgent(messages, fallback)`；store 快照旁路由宿主 wrapper 传参 |
|------|------|------|
| `chat-message.ts` | `apps/desktop/src/stores/acp-chat-types.ts` 纯部 | `ChatMessage` 显示模型 + `extract/flatten/parse` 纯函数；store/annotations 引用在迁入时剪掉 |
| `chat-timeline.ts` | `apps/desktop/src/lib/agent/chat-timeline.ts` | 回合分组、`ChatTimelineItem = message \| work-log`，只读输入 |
| `tool-display-model.ts` | `apps/desktop/src/lib/agent/tool-display-model.ts` | `ToolDisplayModel`（7 终态 × 11 resultKind），渲染只认它 |
| `tool-call-metadata.ts` + `.test.ts` | ACP 工具展示适配 | 提取真实工具名与有界参数摘要，兼容 MCP 包装参数；不保存完整输入 |
| `tool-failure-message.ts` | `apps/desktop/src/lib/agent/tool-failure-message.ts` | 失败摘要纯文案 |
| `url-policy.ts` | `apps/desktop/src/lib/agent/streamdown-url-policy.ts` | Markdown 链接白名单 |
| `markdown-plugins.ts` | `apps/desktop/src/components/markdown/agent-markdown-plugins.ts` | remark/rehype 微插件 |
| `inline-present.ts` | `apps/desktop/src/lib/agent/inline-present.ts` 纯部 | 正文 `montree-present` 引用归属派生 |
| `permission-ui.ts` | `apps/desktop/src/lib/agent/acp-permission-ui.ts` 纯部 | 审批命中判定 |
| `generative-submit.ts` | `apps/desktop/src/lib/agent/generative-submit.ts` | 提交 payload 组装与上限 |
| `attachments.ts` ✅ | `apps/desktop/src/lib/agent/acp-composer.ts`（`AcpMessageAttachment` 类型拷贝，源文件本体留宿主） | 输入框附件类型 |
| `chapter-mark-plans.ts` ✅ | `apps/desktop/src/lib/agent/promote-chapter-mark-plans.ts` | 章级划重点 promote（整搬改名） |
| `mark-promotion.ts` ✅ | `apps/desktop/src/lib/agent/promote-mark-proposals.ts` 纯部 | 4 纯符号提取；读 store 的 promote/resolve 留宿主 |
| `parse-mark-proposal.ts` ✅ | `apps/desktop/src/lib/agent/parse-mark-proposal.ts` | 标记提议解析 |
| `parse-chapter-mark-plan.ts` ✅ | `apps/desktop/src/lib/agent/parse-chapter-mark-plan.ts` | 章级划重点 tool 解析 |
| `parse-present-result.ts` ✅ | `apps/desktop/src/lib/agent/parse-present-result.ts` | `montree_present` 结果 enrich |
| `enrich-tool-message.ts` ✅ | `apps/desktop/src/lib/agent/enrich-tool-message.ts` | tool 消息 enrich（提议卡 + 章级建议） |
| `message-parts.ts` ✅ | E2 新建（无宿主来源，对照 `chat-ui/agent-message-bubble.tsx` 分支条件） | `MessagePart` 9 变体 + `splitMessage()` 零件级拆分；顺序 = 宿主渲染顺序，steps 独立成 part |

呈现契约（四种 `montree_present` kind、白名单校验）不复制，直接依赖 `@montree/contracts`。

工具展示使用真实 `name` 与有界输入摘要（标题、图形类型、路径等）；agy 的通用 MCP 包装先解开再展示，稀疏完成更新保留原摘要。思考正文仅来自实际 thought 事件，进入新工具或正文阶段时结束上一段思考的 streaming；usage 中的思考 token 数不冒充思考正文。

## 门禁

- 禁 electron / `node:` / react / `@/` / `apps/desktop`（沿用 `lint:deps` R1–R5，无豁免）。
