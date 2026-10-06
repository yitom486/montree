import type { AcpConnectReadyResult } from '@montree/contracts'

/** 连接成功后的系统文案（恢复成功 / 失败回退新建） */
export function formatAcpConnectedMessage(
  result: AcpConnectReadyResult,
  prefix: string,
): string {
  const name = result.agentName ? `（${result.agentName}）` : ''
  if (result.sessionRestored) {
    const via =
      result.restoreMethod === 'resume'
        ? 'resume'
        : result.restoreMethod === 'load'
          ? 'load'
          : 'restore'
    return `${prefix}${name}，已恢复会话 ${result.sessionId}（${via}）`
  }

  const attempts = result.restoreAttempts ?? []
  if (result.requestedSessionId && attempts.length > 0) {
    const detail = attempts
      .map((a) => {
        if (a.ok) return `${a.method}×${a.tries}=ok`
        return `${a.method}×${a.tries}失败：${a.error ?? '未知错误'}`
      })
      .join('；')
    return `${prefix}${name}，恢复 ${result.requestedSessionId.slice(0, 8)}… 失败（${detail}），已新建会话 ${result.sessionId}（旧上下文可能丢失）`
  }

  if (result.requestedSessionId) {
    return `${prefix}${name}，未能恢复 ${result.requestedSessionId.slice(0, 8)}…（Agent 可能不支持 resume/load），已新建会话 ${result.sessionId}`
  }

  return `${prefix}${name}，会话 ${result.sessionId}`
}
