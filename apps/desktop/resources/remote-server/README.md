# remote-server（远端工作区 Node 服务产物目录）

本目录的 `montree-remote-server.cjs` + `manifest.json` 由构建生成，
不提交（见根 `.gitignore`）：

```bash
bun run build:remote-server
```

来源：`packages/remote-server/src/entry.ts`（Bun 打成单个 CJS，
`@montree/workspace-core` 内联、`@montree/contracts` 仅直引子模块），
`manifest.json` 含 buildId（产物 sha256 前 16 位）/协议版本/文件校验。

main 启动前校验 manifest（协议主版本 + sha256 + 尺寸），失败拒绝启动；
打包经 `electron-builder.yml` 的 `extraResources` 带入 `resources/remote-server`。
