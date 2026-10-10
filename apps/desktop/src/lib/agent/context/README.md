# lib/agent/context

Montree → Agent 上下文：静态 Skill、turn-context、阅读器内容/选区/标记 registry、MCP 快照序列化。

说明见 [../../README.md](../../README.md) 的 **agent/** 节（`agent/context/`）。

MCP 工具表与传输纯逻辑已独立至 `@yitom/acp-client`；快照/虚拟文件类型见 `@montree/contracts`（`packages/contracts/src/agent/`）。

`reader-visual-context.ts` 收集图片引用和阅读区范围（图片内容不自动注入）；`reader-content-registry.ts` 的正文读取附带简短图片提示。宿主新增 `montree_list_images` 与 `montree_capture_viewport`，截图返回 PNG 内容，保持链接与像素语义分离。契约见 `packages/contracts/src/agent/reader-visual-context.ts`。

增删或改名后，更新 `apps/desktop/src/lib/README.md`。

`document-tool-registry.ts` 连接当前表格/PPT 内存模型和 MCP 读写，同时供文件操作读取 dirty 状态、撤销和保存。坐标选区契约见 `packages/contracts/src/agent/document-tools.ts`；空白单元格同样有效。`useDocumentReader` 将 HTML、JSON、LOG、DOCX、表格和 PPT 接入正文/搜索/目录工具。

PPT 的 `montree_ppt_edit_text` 使用读取结果中的段落/片段编号及 UTF-16 范围进行局部修改；替换文字必须核对 expectedText，整批核对 expectedCount 和 revision。读取结果的 context 分别返回可见页、导航页及选区页，不以滚动位置猜测选中目标。

高级 PPT 工具沿用同一内存模型与快照链路：`montree_ppt_read` 的 charts/design/animation 查询先返回能力、稳定 ID 与影响范围，再由 `montree_ppt_chart_edit`、`montree_ppt_design_edit`、`montree_ppt_animation_edit` 定点修改。图表缓存与内嵌 XLSX 原子同步，共享部件须核对 expectedSlides，动画全量列表须核对 expectedEffectIds；复杂类型保留并拒绝覆盖。组合内部沿用原元素删改工具与局部坐标，继承装饰通过 sourcePart 对应设计工具修改。静态 Skill 与工具概览同步这些限制。
