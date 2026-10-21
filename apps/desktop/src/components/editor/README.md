# src/components/editor

Markdown **编辑** UI（CodeMirror 6）。

| 文件 | 功能 |
|------|------|
| `MarkdownEditor` | 编辑器本体：主题、粘贴图、语法 gutter、滚动同步句柄 |
| `FindReplaceBar` | 查找替换条 |
| `InlineCompletionToggle` | 状态栏行内补全开关（全局设置 + 按文件禁用） |

预览在 `../preview/`；解析与导出逻辑在 `src/lib/editor/`。
