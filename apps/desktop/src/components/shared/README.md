# src/components/shared

跨编辑器 / 阅读器复用的对话框与错误边界。

| 文件 | 功能 |
|------|------|
| `SettingsDialog` / `AboutDialog` / `UpdatePromptHost` | 设置、关于、更新提示 |
| `SyncSettingsSection` | WebDAV 云同步配置与状态管理面板 |
| `TtsSettingsSection` | 语音朗读（TTS）配置：Google Gemini / 微软 Azure Speech / Local OpenAI / 服务默认切换、双 Key 容灾、Region/音色选择、试听与本地缓存管理 |
| `QuickOpenDialog` | 全局快速切换文件对话框（Ctrl+P） |
| `UnsavedChangesDialog` / `DraftRecoveryDialog` | 未保存确认、草稿恢复 |
| `ErrorLogDialog` / `ErrorBanner` | 错误日志与横幅 |
| `AppErrorBoundary` / `PaneErrorBoundary` | 应用级 / 分栏级错误边界 |
