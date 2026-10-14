# electron/vite-plugins

主进程 / electron-vite 构建插件。不是运行时服务。

| 文件 | 功能 |
|------|------|
| `copy-pdfjs-assets.ts` | 把 `pdfjs-dist` 的 cmaps/fonts/wasm 拷到 `src/public/pdfjs`（中文 CID 刚需） |
| `shiki-themes.ts` | 仅生产构建裁剪 Shiki 主题注册表至 GitHub 亮暗两套；保留 web 语言集合，升级后入口未命中则构建报错 |
