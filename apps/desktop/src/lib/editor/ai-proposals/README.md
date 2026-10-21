# ai-proposals

AI 修改建议层（Markdown / Typst，共用 `TextDocument`）。

- `proposal-types.ts`：`EditProposal` 结构与状态（drafting / pending / accepted / rejected / invalid）。
- `proposal-manager.ts`：每个 `TextDocument` 一个实例；创建（同一 toolCallId 去重、与未处理建议重叠拒绝）、`ChangeDesc` 映射、恰好一次的接受/拒绝、全部接受（单事务）。
- `proposal-mapping.ts`：`mapPos` 平移；变更触及目标区间即失效，不自动合并。
- `proposal-diff.ts`：基于 fast-diff 的词级 diff（仅用于显示）。
- `proposal-extension.ts`：独立 CodeMirror 扩展（StateField + StateEffect），删除线 mark、行内/块级 widget、接受/拒绝按钮；IME 组合期间延后刷新。
- `index.ts`：数据层公共导出。
- `install.ts`：渲染进程注册扩展工厂与审阅模式开关（读取 `aiEditReviewMode` 设置）。

MCP 入口：`montree_text_propose` → 快照资源 `text-propose` → `TextDocument.propose()`。审阅模式下 `montree_text_edit` 同样落为建议。
