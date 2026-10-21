import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AcpPermissionOutcome } from '@yitom/contracts'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

/**
 * Agent 无头终端（ACP terminal/create）审批：
 * - 未信任的工作区：每条命令先走审批卡（允许一次 / 信任此工作区 / 拒绝），拒绝或取消即不执行；
 * - 「信任此工作区」写入信任清单（按规范化绝对路径），之后该工作区内命令免审；
 * - 每次决定（含免审放行）追加一行 JSONL 审计日志。
 */
export const TERMINAL_OPTION_ALLOW_ONCE = 'montree-terminal-allow-once'
export const TERMINAL_OPTION_TRUST_WORKSPACE = 'montree-terminal-trust-workspace'
export const TERMINAL_OPTION_REJECT = 'montree-terminal-reject'

export type TerminalDecision = 'trusted' | 'allowed-once' | 'trusted-now' | 'rejected' | 'cancelled'

export interface TerminalApprovalRequest {
  sessionId: string
  command: string
  args?: string[]
  cwd?: string
  workspaceRoot: string
}

export interface TerminalApprovalDeps {
  trustFile: string
  auditFile: string
  requestPermission: (sessionId: string, params: RequestPermissionRequest) => Promise<AcpPermissionOutcome>
  now?: () => Date
}

const normalize = (path: string) => {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export function formatCommandLine(command: string, args: string[] = []): string {
  const quote = (part: string) => (/[\s"'$`\\]/.test(part) ? JSON.stringify(part) : part)
  return [command, ...args].map(quote).join(' ')
}

export class TerminalApprovalPolicy {
  constructor(private readonly deps: TerminalApprovalDeps) {}

  private async loadTrusted(): Promise<Set<string>> {
    // 每次读盘：多窗口/多连接共享同一份信任清单
    try {
      const parsed = JSON.parse(await readFile(this.deps.trustFile, 'utf8')) as { workspaces?: unknown }
      return new Set(Array.isArray(parsed.workspaces) ? parsed.workspaces.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  }

  async isTrusted(workspaceRoot: string): Promise<boolean> {
    return (await this.loadTrusted()).has(normalize(workspaceRoot))
  }

  async trust(workspaceRoot: string): Promise<void> {
    const set = await this.loadTrusted()
    set.add(normalize(workspaceRoot))
    await mkdir(dirname(this.deps.trustFile), { recursive: true })
    await writeFile(this.deps.trustFile, JSON.stringify({ workspaces: [...set].sort() }, null, 2))
  }

  async revoke(workspaceRoot: string): Promise<void> {
    const set = await this.loadTrusted()
    if (!set.delete(normalize(workspaceRoot))) return
    await writeFile(this.deps.trustFile, JSON.stringify({ workspaces: [...set].sort() }, null, 2))
  }

  /** 返回是否放行；同时写审计日志。 */
  async authorize(request: TerminalApprovalRequest): Promise<{ allowed: boolean; decision: TerminalDecision }> {
    let decision: TerminalDecision
    if (await this.isTrusted(request.workspaceRoot)) {
      decision = 'trusted'
    } else {
      const commandLine = formatCommandLine(request.command, request.args)
      const outcome = await this.deps.requestPermission(request.sessionId, {
        sessionId: request.sessionId,
        toolCall: {
          toolCallId: `montree-terminal-${randomUUID()}`,
          title: `运行命令：${commandLine}`,
          kind: 'execute',
          status: 'pending',
          rawInput: { command: request.command, args: request.args ?? [], cwd: request.cwd ?? request.workspaceRoot },
        },
        options: [
          { optionId: TERMINAL_OPTION_ALLOW_ONCE, name: '允许一次', kind: 'allow_once' },
          { optionId: TERMINAL_OPTION_TRUST_WORKSPACE, name: '信任此工作区', kind: 'allow_always' },
          { optionId: TERMINAL_OPTION_REJECT, name: '拒绝', kind: 'reject_once' },
        ],
      } as RequestPermissionRequest)
      const selected = outcome.outcome === 'selected' ? (outcome as { optionId?: string }).optionId : undefined
      if (selected === TERMINAL_OPTION_TRUST_WORKSPACE) {
        await this.trust(request.workspaceRoot)
        decision = 'trusted-now'
      } else if (selected === TERMINAL_OPTION_ALLOW_ONCE) {
        decision = 'allowed-once'
      } else {
        decision = outcome.outcome === 'selected' ? 'rejected' : 'cancelled'
      }
    }
    await this.audit(request, decision)
    return { allowed: decision !== 'rejected' && decision !== 'cancelled', decision }
  }

  private async audit(request: TerminalApprovalRequest, decision: TerminalDecision): Promise<void> {
    const line = JSON.stringify({
      ts: (this.deps.now?.() ?? new Date()).toISOString(),
      sessionId: request.sessionId,
      workspace: request.workspaceRoot,
      cwd: request.cwd ?? request.workspaceRoot,
      command: request.command,
      args: request.args ?? [],
      decision,
    })
    try {
      await mkdir(dirname(this.deps.auditFile), { recursive: true })
      await appendFile(this.deps.auditFile, line + '\n')
    } catch (cause) {
      console.error('[acp] 终端审计日志写入失败', cause)
    }
  }
}
