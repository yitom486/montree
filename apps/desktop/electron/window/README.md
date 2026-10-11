# electron/window

主窗口生命周期。不把业务 IO 写在这里，文件/ACP 走 `services/`。

| 文件 | 功能 |
|------|------|
| `create-window.ts` | 创建 `BrowserWindow`、preload、图标、会话登记；`before-input` 全局快捷键 |
| `artifact-navigation-guard.ts` / `artifact-navigation-guard.test.ts` | Artifact 预览子 frame 导航守卫：`frame-created` 登记不可变 `frameTreeNodeId`，`will-frame-navigate` 按身份阻止自导航（改名不解除）；阅读器帧不受影响 |
| `window-shortcuts.ts` / `window-shortcuts.test.ts` | 原生快捷键映射：新建窗口、设置、打开/保存、搜索；网页 iframe 获得焦点时仍可用 |
| `app-menu.ts` | Application Menu（`editMenu` 等），保证 Ctrl+C/V 在隐藏菜单栏时仍可用 |
| `window-session.ts` | 按 `webContents` 登记窗口会话（dirty、允许关闭、稳定聊天存储分区等） |
| `window-close.ts` / `close-gate.ts` | 关闭前与渲染进程确认未保存 |
| `window-title.ts` | 窗口标题（应用名 + 文件名） |
| `external-file.ts` | 外部文件打开队列：argv/second-instance/mac open-file 只入队，渲染进程挂载后与聚焦时取走 |
