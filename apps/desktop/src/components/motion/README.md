# src/components/motion

beUI 官方 registry 组件，经 `bunx --bun shadcn@latest add @beui/collapsible --yes` 安装。
CLI 未识别本仓库别名时会输出到 `@/` 字面目录；安装后仅校正文件位置与 import，不手写组件核心。

| 文件 | 用途 |
|------|------|
| `collapsible.tsx` | beUI Animated Collapsible：可访问的折叠、焦点管理与 reduced-motion 支持 |
| `ease.ts` | registry 随组件安装的共享动效参数，局部存放以遵守 lib 根目录约束 |
