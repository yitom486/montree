# Tauri 集成与 Sidecar 模式实战指南

本指南面向希望在 **Tauri** 桌面应用中复用 `@inkdown/acp` 的开发者。

---

## 核心思考：为什么选择 Sidecar 模式？

Tauri 的前端 WebView 运行在受限的浏览器沙盒中，无法直接调用 `node:child_process` 拉起后台 Agent 子进程。

要在 Tauri 中复用本 SDK，**无需将整套协议和 8 大 Agent 适配器用 Rust 重写一遍**。Tauri 官方提供了非常成熟的 **Sidecar（伴生进程）** 机制：

```
┌────────────────────────────────────────────────────────┐
│                      Tauri 应用                        │
│                                                        │
│  ┌───────────────────────┐    ┌─────────────────────┐  │
│  │     Tauri 前端 UI     │    │   Tauri Rust 后端   │  │
│  │   (React / Vue / Svelte│   │                     │  │
│  └───────────┬───────────┘    └──────────┬──────────┘  │
│              │ Tauri invoke 命令         │              │
│              ▼                           ▼              │
│  ┌──────────────────────────────────────────────────┐  │
│  │     ACP Sidecar 引擎 (纯独立二进制可执行文件)      │  │
│  │   由 @inkdown/acp 编译而成，负责所有 Agent 交互   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 步骤 1：一键编译出原生二进制 Sidecar

利用 Bun 的单文件编译能力，可以将我们的 SDK 与驱动入口秒级编译为独立的原生二进制程序（无任何环境依赖，体积仅几十 MB）：

```bash
# Windows
bun build ./packages/acp/examples/standalone-acp-demo.ts --compile --outfile acp-engine-x86_64-pc-windows-msvc.exe

# macOS
bun build ./packages/acp/examples/standalone-acp-demo.ts --compile --outfile acp-engine-aarch64-apple-darwin

# Linux
bun build ./packages/acp/examples/standalone-acp-demo.ts --compile --outfile acp-engine-x86_64-unknown-linux-gnu
```

---

## 步骤 2：在 Tauri 中配置 Sidecar

把编译好的二进制文件放入 Tauri 项目的 `src-tauri/bin/` 目录下，并在 `tauri.conf.json` 中声明：

```json
{
  "tauri": {
    "bundle": {
      "externalBin": [
        "bin/acp-engine"
      ]
    }
  }
}
```

---

## 步骤 3：在 Rust 后端拉起 Sidecar

在 Tauri 的 `main.rs` 中，通过 Tauri 提供的命令直接拉起并建立管道：

```rust
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
fn start_acp_sidecar(app_handle: tauri::AppHandle) {
    let (mut rx, mut child) = Command::new_sidecar("acp-engine")
        .expect("未能初始化 acp-engine sidecar")
        .spawn()
        .expect("启动 acp-engine 失败");

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    // 将 Agent 输出广播给前端页面
                    println!("Sidecar 输出: {}", line);
                }
                CommandEvent::Stderr(err) => {
                    eprintln!("Sidecar 错误: {}", err);
                }
                _ => {}
            }
        }
    });
}
```

---

## 总结：Sidecar vs 纯 Rust 重写的优劣对比

| 考量因素 | Sidecar 模式（推荐） | 纯 Rust 重写模式 |
| :--- | :--- | :--- |
| **代码复用率** | **100% 共用**：Electron、CLI、Tauri 维护同一份 Agent 适配逻辑 | 0%：需用 Rust 把 8 大 Agent 适配器完全重写一遍 |
| **生态跟进** | **极快**：依赖官方 `@agentclientprotocol/sdk`，上游一更新立即生效 | **滞后**：Rust 生态目前缺少官方实时维护的 ACP 客户端库 |
| **内存与启动** | 启动毫秒级，常驻内存约 30~50MB | 启动纳秒级，常驻内存约 5~15MB |
| **适用建议** | **适合 95% 的应用**，用极低维护成本换取跨平台、跨项目通用性 | 仅适合极致追求超小包体积与极低内存的单体纯 Rust 项目 |
