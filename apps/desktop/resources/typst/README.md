# Typst 运行时资源

`bun run prepare:typst` 下载固定版本 Tinymist，按发布归档 SHA-256 校验后生成当前平台的运行资源。只支持当前应用发布目标 Windows x64、macOS arm64、Linux x64；其他目标明确失败。macOS/Linux 构建需要系统 `tar`。

| 文件 | 用途 |
|------|------|
| `tinymist.exe` / `tinymist` | 当前平台可执行文件，内嵌 Typst 编译器与预览资源 |
| `manifest.json` | 版本、平台、架构、归档与可执行文件校验、大小 |
| `LICENSE` | 上游 Apache-2.0 许可证 |
| `README.md` | 资源准备与分发说明 |

除 README 外资源不提交 Git。打包通过 `extraResources` 复制到 `resources/typst`，不能在 ASAR 内执行。`pack*` 会先准备运行时，开发时首次使用 Typst 也需执行准备命令；已有资源命中校验后不会重复下载。

固定版本和三平台校验见根目录 `scripts` 中的资源脚本；许可证源为根目录 `LICENSES` 中的 Tinymist 文本。升级时一起更新并验证。可用 `MONTREE_TYPST_ARCHIVE` 指向预先下载的**同版本官方归档**，仍须通过相同 SHA-256 校验。该变量只用于构建期，不是运行时工具路径。electron-builder 的 beforePack 还会再次校验目标平台、可执行文件与许可证，拒绝缺失或不匹配的资源。

中文字体默认使用系统字体，可在 Typst 设置中增加字体目录。首次引用未缓存的社区包需要联网；无外部依赖的文档或缓存齐备的项目可离线编译。资源准备不包含整个字体库或包仓库。
