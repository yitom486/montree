# 未发布迁移包快照

本目录的七个 `.tgz` 是外部源码仓库构建后的安装快照，随本仓保存，供新环境和 CI 正常执行 `bun install --frozen-lockfile`。不包含 `node_modules` 或认证数据；源码权威仍为外部仓库，不在此修改归档内容。

| 快照 | 源码归属 |
| --- | --- |
| `yitom-acp-client.tgz` | `acp-client` 仓库：ACP 请求、流桥接、会话恢复和运行时适配 |
| `yitom-contracts.tgz` / `yitom-reader-core.tgz` / `yitom-annotations.tgz` | `montree-chat` 仓库的契约与阅读业务基础包 |
| `yitom-chat-core.tgz` / `yitom-chat-ui.tgz` / `yitom-chat-session.tgz` | `montree-chat` 仓库的消息模型、渲染和会话适配 |

更新：修改外部源码后，在 Montree 根目录运行 `bun run sync:chat-packages`；默认外部路径为 `../../montree-chat` 与 `../../acp-client`，也可通过 `MONTREE_CHAT_ROOT`、`MONTREE_ACP_ROOT` 指定。命令构建、打包、安装并更新锁文件，不执行 npm 发布。

正式发布外部包后，将根依赖和六包 overrides 切回同版本发布包，即可移除这些过渡快照。
