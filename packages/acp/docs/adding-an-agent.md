# 新增 Agent 运行时适配器指南 (Adding an Agent)

`@inkdown/acp` 采用插件化适配器（Adapter Pattern）架构。如果你想接入一个新的 Agent 运行时，**只需要在一个地方新增适配器文件并注册**，所有调用该 SDK 的项目（CLI、Electron、Tauri、Web 等）即可全局自动支持该 Agent！

---

## 适配器接口规范

所有运行时适配器必须实现 `GenericRuntimeAdapter` 接口：

```typescript
export interface GenericRuntimeAdapter {
  /** 唯一运行时标识，如 'my-agent' */
  id: string

  /** 凭证存在性探测（判断用户是否已在本机登录或配置了 Key） */
  probeAuth: () => CodexAuthPreflight

  /**
   * [可选] 启动前 CLI 命令探测：
   * 返回实际执行的 { command, args }，若返回 null 表示未安装，提前提示安装指引
   */
  resolveSpawnCommand?: () => { command: string; args: string[] } | null

  /**
   * [可选] 启动前预检拦截：
   * 返回非空字符串表示拦截并提示用户（例如缺少必要环境变量时阻止 spawn）
   */
  resolveSpawnBlocker?: () => string | null | undefined

  /** [可选] 环境变量定制 */
  getSpawnEnv?: (proxySettings?: Partial<AcpProxySettings>) => {
    env: NodeJS.ProcessEnv
    envRemove: string[]
  }

  /** [可选] 认证方式重新排序 */
  orderAuthMethods?: (methods: AcpAuthMethod[]) => AcpAuthMethod[]

  /** [可选] 是否尝试直接建立会话（针对把 Token 保存在系统 Keychain 的 CLI） */
  tryDirectSessionFirst?: boolean
}
```

---

## 步骤教学：以接入 `ollama-acp` 为例

### 步骤 1：新建适配器目录与文件

在 `packages/acp/src/runtimes/` 下新建目录 `ollama/index.ts`：

```typescript
// packages/acp/src/runtimes/ollama/index.ts
import type { CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

export function probeOllamaAuth(): CodexAuthPreflight {
  // 检查本机是否已运行 Ollama 服务或配置了 OLLAMA_HOST
  const hasHostEnv = Boolean(process.env.OLLAMA_HOST?.trim())
  return {
    hasCodexHome: false,
    hasAuthFile: false,
    hasApiKeyEnv: hasHostEnv,
    looksLoggedIn: true, // 本地开源模型通常无需登录
  }
}

export const ollamaAdapter: GenericRuntimeAdapter = {
  id: 'ollama-acp',
  probeAuth: () => probeOllamaAuth(),
  resolveSpawnBlocker: () => {
    // 检查服务是否存活，或者放行
    return null
  },
}
```

### 步骤 2：在适配器矩阵中注册

打开 `packages/acp/src/runtimes/index.ts`，导出并加入工厂分发：

```typescript
import { ollamaAdapter } from './ollama'

export * from './ollama'

export function getAcpRuntimeAdapter(runtimeId: string): AcpRuntimeAdapter {
  switch (runtimeId) {
    // ... 原有适配器
    case ollamaAdapter.id:
      return ollamaAdapter
    default:
      return { id: runtimeId, probeAuth: emptyAcpAuthPreflight }
  }
}
```

### 步骤 3：验证与测试

编写对应的单元测试 `ollama/index.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { getAcpRuntimeAdapter } from '../index'

describe('ollama runtime adapter', () => {
  it('正确派发 ollama 适配器', () => {
    const adapter = getAcpRuntimeAdapter('ollama-acp')
    expect(adapter.id).toBe('ollama-acp')
    expect(adapter.probeAuth().looksLoggedIn).toBe(true)
  })
})
```

运行测试：
```bash
bunx vitest run packages/acp/src/runtimes/ollama/index.test.ts
```

完成！此后任何项目使用 `new AcpClient({ runtime: 'ollama-acp', ... })` 即可开箱即用。
