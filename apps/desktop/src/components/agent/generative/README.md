# generative/ 生成式 UI（G2）

官方 `GenerativeUIRender`（`@assistant-ui/react@0.15.27` 已含）+ 白名单注册表。
模型经 `montree_present(kind=component-ui)` 提交 JSON 树，宿主渲染真实 React 组件；
用户选择经宿主回调沿原 ACP `sendPrompt` 回到同一会话。不引入新依赖、不替换运行时。

| 文件 | 功能 |
|------|------|
| `ComponentUiCard.tsx` | 白名单渲染（Card/Row/Column/Text/Select/Button/Evidence）+ 本地选择态 + 提交/定位回调 + 未知组件 Fallback + 卡内错误边界 |
| `ComponentUiCard.lazy.tsx` | 懒加载入口（首屏不进包） |
| `ComponentUiCard.test.ts` | 树渲染/选择提交/busy 禁用/错误降级回归 |
| `ReactArtifactCard.tsx` / `.test.ts` | React 内联卡：构建/编译/恢复/加载/就绪/编译失败/运行失败真实状态机；成功经共享 `ArtifactFrame` 直接挂内联 iframe（初始 320/上限 640，内部滚动）；ready 仅认包装层 commit 确认，失败优先于晚到确认，30s 加载超时；挂载 ID 归源码+重跑，宿主更新不重建；源码视图为模型源码，导出离线 HTML；无预览对话框，单实例 |
| `react-artifact-runtime.ts` | iframe 浏览器运行库构建入口，预置 React / react-dom/client / jsx-runtime；不在宿主主进程运行 |

组件组合的渲染类型保持稳定，选择与提交状态经 Context 更新；提交包含同步防重复与 8KiB 限制。React artifact 当前仅预置 React，编译器 Sucrase 在主进程独立懒块，未提供任意依赖安装或直接宿主业务操作；文本请求桥接见下文R3。

R3：React 页面可调用 `window.montreeArtifact.requestAnalysis(text)` 提出 ≤1536 UTF-8 字节的文本请求。`ArtifactFrame` 仅在显式 allowRequests 时开放并校验来源/挂载/字节上限；宿主展示不可被后续消息替换的待发送内容，用户确认后经原 `onGenerativeSubmit` / ACP `sendPrompt` 继续归属会话。运行失败可准备修复请求（携带该 artifact 源码与错误），同样需确认。无任意 IPC、文件操作或自动发送；离线导出 API 返回 false。页面内部状态在确认提交时保持。
