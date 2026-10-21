# ai-proposals

AI 修改建议层（Markdown / Typst，共用 `TextDocument`）。

- `proposal-types.ts`：`EditProposal` 结构与状态（drafting / pending / accepted / rejected / invalid）。
- `proposal-manager.ts`：每个 `TextDocument` 一个实例；创建（同一 toolCallId 去重、与未处理建议重叠拒绝）、`ChangeDesc` 映射、恰好一次的接受/拒绝、全部接受（单事务）。
- `proposal-mapping.ts`：`mapPos` 平移；变更触及目标区间即失效，不自动合并。
- `proposal-diff.ts`：基于 fast-diff 的词级 diff（仅用于显示）。
- `proposal-extension.ts`：独立 CodeMirror 扩展（StateField + StateEffect），删除线 mark、行内/块级 widget、接受/拒绝按钮；IME 组合期间延后刷新。
- `proposal-history.ts`：接受/撤销接受的 StateEffect 与 `invertedEffects`，让撤销把已接受建议恢复为待审、重做再次接受。
- `proposal-hunks.ts`：按句（`Intl.Segmenter` + 中文 。！？；）切分替换文本为 hunk，逐句采纳后单事务应用。
- `live-documents.ts`：已挂载文档注册表；线程取消/清空/删除、Agent 断开时撤回建议并显示说明，文件关闭时清理。
- `selection-prompt.ts`：选区工具栏动作（改写/润色/缩短/扩写/翻译/自定义）与发给 Agent 的提示词。
- `selection-actions-extension.ts`：浮动选区工具栏（showTooltip）与 Mod-J 自定义指令快捷键。
- `index.ts`：数据层公共导出。
- `install.ts`：渲染进程注册扩展工厂与审阅模式开关（读取 `aiEditReviewMode` 设置）。

MCP 入口：`montree_text_propose` → 快照资源 `text-propose` → `TextDocument.propose()`。审阅模式下 `montree_text_edit` 同样落为建议。
