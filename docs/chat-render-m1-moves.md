# M1 文件级搬运清单：`apps/desktop/src` → `packages/chat-core/src`

> 原则：行为不变、只换 import 源；按批执行，每批独立可合（单测 + `lint:deps` + `tsconfig.node` 全绿）。

## 0. 基线（迁移前，原目录 `master@551be1f` 实测）

`bunx vitest run` 上述 14 个测试文件：**14 passed / 92 passed**（2026-10-16）。
迁移后在工作树用同一批用例逐个对照，只允许路径改、不允许行为改。
> 先在工作树执行 `bun install`（新 worktree 无 `node_modules`）。
> 测试文件随源码同批搬，`@/` 改相对路径。

## A 批：零 `@/` 导入，逐字搬（顺序任意）✅ 已完成并验收（2026-10-16）

- 搬运：10 个 `git mv`（5 源码 + 5 测试）+ 7 个调用方 import 换源（`AgentPanel/AgentPlanCard/AgentMarkdown/tool-display-model/acp-chat-types/chat-slice/annotation-agent-store`，diff 确认仅 import 行）。
- 验收：`packages/chat-core` 5 文件 20 用例全过（与基线同内容，仅 import 路径变）；宿主关联 4 文件 112 用例全过；`lint:deps` 0 错误；`typecheck` exit 0。未 commit。

| # | 源 | 目标 | 备注 |
|---|----|------|------|
| A1 | `src/lib/agent/tool-failure-message.ts` + `.test.ts` | `src/tool-failure-message.ts` | 无导入，直接搬 |
| A2 | `src/lib/agent/streamdown-url-policy.ts` + `.test.ts` | `src/url-policy.ts` | 无导入，直接搬 |
| A3 | `src/lib/agent/generative-submit.ts` + `.test.ts` | `src/generative-submit.ts` | 无导入，直接搬 |
| A4 | `src/components/markdown/agent-markdown-plugins.ts` + `.test.ts` | `src/markdown-plugins.ts` | 外部依赖 `remark-github-blockquote-alert`、`hast-util-sanitize` 原样保留，记入 `chat-core/package.json dependencies`（版本号抄根 `package.json`） |
| A5 | `src/lib/agent/acp-plan.ts` + `.test.ts` | `src/plan.ts` | 无导入，直接搬；`AcpPlanEntry` 改名 `PlanEntry`（`export type { PlanEntry as AcpPlanEntry }` 兼容旧名也行，二选一全表统一） |

## B 批 ✅ B0–B2、B3/B4/B5/B7 已完成并验收（2026-10-16）

- B0–B2：新建 `chat-message.ts`（整搬改名）+ `attachments.ts`（拷贝类型）+ `chapter-mark-plans.ts`（整搬）+ `mark-promotion.ts`（4 纯符号提取）；宿主 `acp-chat-types.ts` 缩为 16 导出兼容层，`promote-mark-proposals.ts` 留 store 部分 + 重导出兼容；调用方仅换源。验收：`chat-core` 7 文件 22 用例 + 留守 `promote-mark-proposals.test.ts`，复验 8 文件 25 用例全过；`lint:deps` 0 错误；`typecheck` exit 0。
- 遗留（M4 清）：`ComposerAttachmentKind` 在 core/host 两处各定义一份（同形 union，结构互换无影响），M4 由 host 改从 core 引。

- 搬运：`parse-mark-proposal / parse-chapter-mark-plan / parse-present-result / tool-display-model / inline-present / chat-timeline`（+测试）入 core；宿主调用方仅换源（`AgentActivityGroup/LoadingState/ToolCallCard/Bubble/List/AnnotationNoteDialog/permission-ui/chat-slice/chat-helpers/useAcpSession/BusinessResult`）；文档引用同步（`agent/README.md`、`ai-elements/tool.tsx` 注释）。
- 验收：`chat-core` 13 文件 80 用例全过；宿主关联 4 文件 85 用例全过（复验一致）；`lint:deps` 0 错误；`lint:docs` 0 错误；`typecheck` exit 0。未 commit。
- 剩余 M1：B6 `permission-ui`、B8 `enrich-tool-message`、C 批收尾。

## B 批 ✅ B6/B8 已完成并验收（2026-10-16）

- 搬运：`permission-ui.ts`（整搬；`AcpPendingPermission`→core 本地 `PendingApprovalRef`）+ `enrich-tool-message.ts`（整搬）；调用方仅换源。B6/B8 并行执行，中间出现一次 B8 首跑撞 B6 半写态（复跑自愈，并行固有 hazard，无残留）。
- 偏离裁决：B6 把 `PendingApprovalRef.toolCallId` 写成可选（清单为必填）——**接受**。用例传入 `undefined` 且函数体有 `if (!pending.toolCallId)` 分支，必填会制造死代码；且与宿主 `AcpPendingPermission.toolCallId?` 同形，双向兼容。
- 验收：`chat-core` 14 文件 90 用例全过（复验一致）；宿主关联（Bubble/List/permission/acp-ui-store）全过；`lint:deps` 0；`typecheck` 0。未 commit。

## C 批 ✅ 已完成并验收（2026-10-16）

- README 同步 4 文件：`lib/README.md`（10 行迁注）、`components/markdown/README.md`、`stores/README.md`（兼容层注）、`chat-core/README.md`（B 批行补齐）。
- 全量门禁终轮：`test` 全绿（见下）、`lint:docs` 0、`lint:deps` 0、`typecheck` 0、`build` 成功、`check:bundle` 8 PASS（37.24MB/55MB，预算未动）。未 commit。
- 环境注记：新工作树须先 `git submodule update --init third-party/foliate-js`（否则 reader 测试 + build 缺 `@foliate` 文件）；全量满载下 `git-service.test.ts`（2）+ `web-doc-agent-content.test.ts`（1）偶发失败，两文件 M1 零触碰、单跑双目录均 16/16 全绿，定性为满载 flaky 非回归。

- 搬运：新建 `chat-message.ts`（整搬改名）+ `attachments.ts`（拷贝类型）+ `chapter-mark-plans.ts`（整搬）+ `mark-promotion.ts`（4 纯符号提取）；宿主 `acp-chat-types.ts` 缩为 16 导出兼容层，`promote-mark-proposals.ts` 留 store 部分 + 重导出兼容；调用方仅换源。
- 验收：`chat-core` 7 文件 22 用例 + 留守 `promote-mark-proposals.test.ts`，复验 8 文件 25 用例全过；`lint:deps` 0 错误；`typecheck` exit 0。未 commit。
- 遗留（M4 清）：`ComposerAttachmentKind` 在 core/host 两处各定义一份（同形 union，结构互换无影响），M4 由 host 改从 core 引。

| # | 源 | 目标 | import 改写 |
|---|----|------|-------------|
| B0 | `src/stores/acp-chat-types.ts`（纯类型+纯函数，无 store 导入，可整搬） | `src/chat-message.ts` | `AcpChatMessage→ChatMessage`（余类推 `AcpChatRole→ChatRole` 等）；`@montree/contracts` 保留；`@montree/annotations` 保留（`chat-core/package.json` 加 `workspace:*`）；`@/lib/agent/acp-plan`→`./plan`；`@/lib/agent/acp-composer` 的 `AcpMessageAttachment` 改为 `→./attachments`（见下）。宿主原文件缩为单行 `export * from '@montree/chat-core'` 兼容层，27 处调用方 M4 再改，M1 零 churn |
| B0a | `src/lib/agent/acp-composer.ts:31-41` 的 `AcpMessageAttachment` 接口（仅拷贝类型，不搬文件） | `src/attachments.ts` | 拷贝时确认无外部导入（原文件仅 contracts 导入）；`acp-composer.ts` 本体不动 |
| B1 | `src/lib/agent/promote-chapter-mark-plans.ts` + `.test.ts` | `src/chapter-mark-plans.ts` | 整文件搬（已核：无 store 导入，`promote/resolve/select` 全以 messages 为参）；`@montree/annotations` 保留；`AcpChatMessage`→`./chat-message` |
| B2 | `src/lib/agent/promote-mark-proposals.ts` 纯部提取 + `.test.ts` 拆分 | `src/mark-promotion.ts` | 只搬 `ChatMarkProposal`、`isPendingMarkProposalEntry`、`isProposalPromotedToAgent`、`shouldHideProposeToolMessage`（已核：三函数纯读 messages）；读 store 的 `promote/resolve` 函数**留宿主**；`toProposedMark` 不跟过去 |
| B3 | `src/lib/agent/parse-mark-proposal.ts`、`parse-chapter-mark-plan.ts`、`parse-present-result.ts`（+各 `.test.ts`） | `src/` 同名 | 已核：仅 `@montree/annotations` / `@montree/contracts` 导入 + `AcpChatMessage`→`./chat-message` |
| B4 | `src/lib/agent/tool-display-model.ts` + `.test.ts` | `src/tool-display-model.ts` | `AcpChatMessage`→`./chat-message`；`tool-failure-message`、`parse-present-result`→相对路径 |
| B5 | `src/lib/agent/inline-present.ts` + `.test.ts` | `src/inline-present.ts` | `@montree/contracts` 保留；`AcpChatMessage`→`./chat-message` |
| B7 | `src/lib/agent/chat-timeline.ts` + `.test.ts` | `src/chat-timeline.ts` | `acp-chat-types`→`./chat-message`；`promote-mark-proposals`→`./mark-promotion`；`promote-chapter-mark-plans`→`./chapter-mark-plans`；`tool-display-model`→相对路径 |
| B6 | `src/lib/agent/acp-permission-ui.ts` + `.test.ts` | `src/permission-ui.ts` | `ChatTimelineItem`→`./chat-timeline`；`AcpPendingPermission`（store 类型）**不引入**，core 新定义最小结构接口 `PendingApprovalRef { toolCallId: string }`（三函数实际只读该字段，宿主类型天然可赋值，反向解耦） |
| B8 | `src/lib/agent/enrich-tool-message.ts` | `src/enrich-tool-message.ts` | 5 个 `@/` 导入全改相对路径；调用方 `src/stores/acp/chat-helpers.ts:9`、`src/stores/annotation-agent-store.ts:14` 改 import 源（renderer 引 workspace 包不违 R6） |

## C 批：包接线

- `chat-core/package.json`：`dependencies += @montree/annotations: workspace:*` + A4 的两个外部包（版本抄根）。
- `chat-core/src/index.ts`：barrel 导出 A/B 全部模块；`chat-core/README.md` 表格打勾。
- 空跑验证：`bunx vitest run packages/chat-core`、`bun run lint:deps`（R1–R5 对 chat-core 必须零豁免）、`tsc --noEmit -p tsconfig.node.json`。

## 明确不搬（留宿主）

`promote-mark-proposals.ts` 读 store 部分、`acp-composer.ts` 本体、`acp-ui-store.ts` + `stores/acp/`、`annotation-agent-store.ts`、`acp-stream-host.ts` 及一切 `api/*`、Electron、workspace 集成。
