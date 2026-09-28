import type { AcpAuthMethod, CodexAuthPreflight } from '@inkdown/contracts'
import type { GenericRuntimeAdapter } from '../index'

/**
 * agy 运行时适配器（`bunx -y @yitom/agy-acp-map`，无参 stdio 服务）。
 *
 * 形态照抄 codex 条目：模板直调官方桥 JS 入口（`agy-acp → dist/bin.js`，
 * src/sdk-server.ts 构建，target node），免安装、跨平台（win/mac/linux
 * 有 bun 即行；JS 入口无旧 exe 的 win-only 限制）。
 *
 * 语义（对齐同源参考实现，不拷贝架构）：
 * - initialize 跑 `agy models`/`agents`（10s 超时，进程级缓存）；
 * - 模型经 session/new 的 configOptions 到达，中途换模型走
 *   session/set_config_option（configId 含 model|effort|mode|agent|…），
 *   即我方现有 setModel 通道直通，无需 set_model 逃生口；
 * - authMethods 为 []（直连即可）；
 * - 历史回放刻意极简（本地 zustand 仍是显示真相源）。
 */
export function probeAgyAuth(): CodexAuthPreflight {
  return {
    codexHome: '',
    hasCodexHome: false,
    hasAuthFile: false,
    hasApiKeyEnv: false,
    looksLoggedIn: false,
  }
}

export const agyAdapter: GenericRuntimeAdapter = {
  id: 'agy',
  probeAuth: () => probeAgyAuth(),
  orderAuthMethods: (methods: AcpAuthMethod[]) => methods,
  canSkipInteractiveAuth: () => false,
  // authMethods 为 []，直连即可；文件探针中性，gate 侧先试直接建会话
  tryDirectSessionFirst: true,
}
