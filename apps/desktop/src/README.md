# src

Electron **渲染进程**源码。入口：`main.tsx` → `App.tsx`。路径别名 `@/` 指向本目录。

| 目录 / 文件 | 职责 |
|-------------|------|
| `App.tsx` | 根组件：工作区壳、文件操作、对话框、自动保存/草稿 |
| `main.tsx` | React 挂载、Providers |
| `index.html` / `env.d.ts` | Vite 入口与类型 |
| [`api/`](./api/) | 对 preload/`window.electronAPI` 的 IPC 封装 |
| [`hooks/`](./hooks/) | React Hook（按域分子目录） |
| [`lib/`](./lib/) | 无 React 的纯逻辑（按域分子目录） |
| [`stores/`](./stores/) | Zustand 本地 UI / 会话状态 |
| [`components/`](./components/) | UI 组件 |
| [`providers/`](./providers/) | Query / Theme 等全局 Provider |
| [`styles/`](./styles/) | 全局与阅读器/预览 CSS |
| [`types/`](./types/) | 渲染端补充类型声明 |
| [`public/`](./public/) | 静态资源（含 pdf.js 资源） |

主进程代码在 [`electron/`](../electron/README.md)；跨进程契约在 `packages/contracts/`（`@montree/contracts`，原 `shared/`）；ACP 纯逻辑在独立包 `@yitom/acp-client`（传输/认证决策链/多运行时矩阵/会话能力与 registry/终端缓冲/MCP RPC 与工具表；主进程留守接线与桥接，渲染端零直接引用）；阅读器纯逻辑在 `packages/reader-core/`（`@montree/reader-core`）；PDF 归一/映射在 `packages/pdf/`（`@montree/pdf`，页码归一/分类映射/整档拼装）；OCR 纯逻辑在 `packages/ocr-core/`（`@montree/ocr-core`，目录/水印/页质量判断及 pdf-bytes 与缓存 ports，外部运行时 pin 见 `inspector-pins`）；标注在 `packages/annotations/`（`@montree/annotations`：标记合并/纯核/Anki 构建/Flashcard 模型与复习，另含标记提议 `mark-proposal` 与章级建议 `chapter-mark-plan`）；在线文档目录抽取/站点谓词在 `packages/web-doc/`（`@montree/web-doc`）。细则见根目录 [AGENTS.md](../../AGENTS.md)。

门禁：`bun run lint:docs`（`scripts/lint-docs.ts`）+ `bun run lint:deps`（`scripts/check-deps.ts`，R1–R6 依赖边界：`packages/*` 禁 electron/node:/react，渲染非 `api/` 禁直调 `window.electronAPI`）。

**约定**：本树内带 `README.md` 的目录，增删或改文件名后须同步更新对应 README。
