# src/components/data

结构化数据与日志流专属视图组件。纯逻辑模型位于 `@/lib/data`。

| 组件 | 功能 |
|------|------|
| `DataSheetViewer.tsx` | CSV / TSV 电子表格网格，支持双击单元格就地编辑、增删行列、列排序、文本搜索与源码视图切换 |
| `JsonTreeViewer.tsx` | JSON 树形结构可视化，集成社区工业级全能编辑器（vanilla-jsoneditor）与轻量大纲/源码视图切换 |
| `VanillaJsonEditorHost.tsx` | 基于社区顶流 `vanilla-jsoneditor` 封装的工业级 React JSON 编辑宿主，支持 Tree/Table/Text 三模式、模式切换与主题自适应 |
| `LogStreamViewer.tsx` | LOG 日志流专业分析视图，支持 ERROR/WARN/INFO/DEBUG 级别药丸过滤、时间戳/模块标签解析与多行堆栈折叠 |
