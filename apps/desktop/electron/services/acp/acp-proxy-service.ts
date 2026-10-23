import { app } from 'electron'
import type { AcpProxySettings } from '@yitom/contracts'
import {
  readAcpProxySettings as readAcpProxySettingsFrom,
  saveAcpProxySettings as saveAcpProxySettingsTo,
} from '@yitom/acp-client'

/**
 * ACP 子进程代理设置：读写 userData/agent/proxy.json。
 * 仅影响 spawn 的 Agent 进程（HTTP_PROXY 等环境变量），应用自身网络不受影响。
 * 实现在 `@yitom/acp-client`；本层只把默认目录绑定到 Electron userData
 * （SDK 缺省目录不同，直接用会读不到已保存的设置）。
 */
export { DEFAULT_ACP_PROXY_SETTINGS, buildAcpProxySpawnEnv } from '@yitom/acp-client'

/** 文件缺失/损坏回落默认值（enabled=false 保证未知状态直连） */
export function readAcpProxySettings(dir = app.getPath('userData')) {
  return readAcpProxySettingsFrom(dir)
}

export function saveAcpProxySettings(payload: AcpProxySettings, dir = app.getPath('userData')) {
  return saveAcpProxySettingsTo(payload, dir)
}
