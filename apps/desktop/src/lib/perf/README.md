# src/lib/perf

渲染性能探针。

- `render-probe.ts`：`useRenderProbe(id)` 渲染计数（`window.__montreeRenderCounts`），供 E2E 断言外壳区域（聊天面板等）在切换文档时零重渲染。
