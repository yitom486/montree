# src/components/ui

**shadcn/ui** 生成组件。用 `cn()`；业务逻辑不要写进这里。

新增：`bunx shadcn@latest add <component>`。配置见仓库根 `components.json`（`utils` → `@/lib/utils`）。

| 文件 | 用途 |
|------|------|
| `button` / `dialog` / `alert-dialog` / `input` / `textarea` / `input-group` | 按钮与表单对话框 |
| `dropdown-menu` / `menubar` | 菜单 |
| `breadcrumb` / `separator` / `scroll-area` | 导航与布局装饰 |
| `resizable` | `react-resizable-panels` 封装 |
| `sonner` | Toast |
| `tooltip` / `hover-card` | 悬停提示与附件预览 |

新接入 input-group/textarea/hover-card 来自 shadcn 官方 new-york-v4 registry（2026-10-12）；仅替换路径别名，复用现有 Button/Input；MIT 许可证见 LICENSE.md。
