import type { AcpAuthMethod, AcpProxySettings, CodexAuthPreflight } from '@inkdown/contracts'
import { DEFAULT_ACP_RUNTIME_ID } from '@inkdown/contracts'
import { codexAdapter } from './codex'
import { emptyAcpAuthPreflight } from './codex/codex-auth-preflight'
import { claudeAdapter } from './claude'
import { geminiAdapter } from './gemini'
import { copilotAdapter } from './copilot'
import { opencodeAdapter } from './opencode'
import { cursorAdapter } from './cursor'
import { deepseekAdapter } from './deepseek'
import { agyAdapter } from './agy'

export * from './codex'
export * from './claude'
export * from './gemini'
export * from './copilot'
export * from './opencode'
export * from './cursor'
export * from './deepseek'
export * from './agy'

export interface GenericRuntimeAdapter {
  id: string
  beforeSpawn?: () => Promise<void>
  /** 仅冷启动（无温进程可用、即将 spawn）时调用一次；各 runtime 自理副作用 */
  onColdStart?: () => Promise<void>
  probeAuth: () => CodexAuthPreflight
  /**
   * 预 spawn 接线点（冷启动 spawn 前调用一次）：
   * 返回 `{ command, args }` 则覆盖模板的 spawn 目标（可透传绝对路径）；
   * 返回 `null` 表示 CLI 未安装，`acp-connection.ts` 直接回带安装指引的
   * `ACP_SPAWN_ERROR`，不触达 spawn（省掉“不是内部或外部命令”秒退）。
   * 缺省（undefined）表示无需预检，沿用模板 command/args。
   * 抛错时按缺省处理（防御性回落），不断连接。
   */
  resolveSpawnCommand?: () => { command: string; args: string[] } | null
  /**
   * 预检判停（缺 key 等，仿 resolveSpawnCommand 的可选 + 缺省兼容做法）：
   * 返回非空字符串表示直接判停，`acp-connection.ts` 以该文案回带
   * `ACP_SPAWN_ERROR`，不触达 spawn（如 deepseek 缺 DEEPSEEK_API_KEY 时
   * harness 秒退，stdio 关闭即裸 `ACP connection closed`）。
   * 缺省（undefined）/返回空表示放行；抛错时按放行处理（防御性回落），不断连接。
   */
  resolveSpawnBlocker?: () => string | null | undefined
  getSpawnEnv?: (proxySettings?: Partial<AcpProxySettings>) => {
    env: NodeJS.ProcessEnv
    envRemove: string[]
  }
  orderAuthMethods?: (methods: AcpAuthMethod[]) => AcpAuthMethod[]
  canSkipInteractiveAuth?: (methodId: string, force?: boolean) => boolean
  /**
   * keychain 化凭据兜底：文件探针只能当 hint（命中→已登录，未命中不断言），
   * 置 true 的 runtime 在 gate 判定 needs_auth 前先试一次直接建会话，
   * 成功则免弹向导（session_without_auth），失败再回落 needs_auth。
   * 缺省（undefined）视为 false，其余 runtime 不动。
   */
  tryDirectSessionFirst?: boolean
}

export type AcpRuntimeAdapter = GenericRuntimeAdapter & {
  getCustomProvider?: typeof codexAdapter.getCustomProvider
}

export function getAcpRuntimeAdapter(runtimeId: string): AcpRuntimeAdapter {
  if (runtimeId === DEFAULT_ACP_RUNTIME_ID) {
    return codexAdapter
  }
  switch (runtimeId) {
    case claudeAdapter.id:
      return claudeAdapter
    case geminiAdapter.id:
      return geminiAdapter
    case copilotAdapter.id:
      return copilotAdapter
    case opencodeAdapter.id:
      return opencodeAdapter
    case cursorAdapter.id:
    case 'cursor':
      // 目录名别名：模板 id 以 `cursor-cli` 为准（见 acp-client 注释与 contracts 模板）
      return cursorAdapter
    case deepseekAdapter.id:
      return deepseekAdapter
    case agyAdapter.id:
      return agyAdapter
    default:
      return {
        id: runtimeId,
        probeAuth: emptyAcpAuthPreflight,
      }
  }
}
