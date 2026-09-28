import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { assertPathInsideWorkspace } from './acp-fs'
import { appendTerminalOutput } from '../transport/terminal-output-buffer'

const DEFAULT_OUTPUT_BYTE_LIMIT = 1_048_576

export interface AcpTerminalExitStatus {
  exitCode: number | null
  signal: string | null
}

export interface AcpTerminalOutputSnapshot {
  output: string
  truncated: boolean
  exitStatus?: AcpTerminalExitStatus
}

export interface CreateAcpTerminalParams {
  sessionId: string
  command: string
  args?: string[]
  env?: Array<{ name: string; value: string }>
  cwd?: string
  outputByteLimit?: number
  workspaceRoot: string
}

interface TerminalRecord {
  id: string
  sessionId: string
  child: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode: number | null
  signal: string | null
  exited: boolean
  waiters: Array<(status: AcpTerminalExitStatus) => void>
}

function resolveCwd(cwd: string | undefined, workspaceRoot: string): string {
  if (!cwd?.trim()) return assertPathInsideWorkspace(workspaceRoot, workspaceRoot)
  return assertPathInsideWorkspace(cwd, workspaceRoot)
}

function buildEnv(
  extra: Array<{ name: string; value: string }> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (!extra) return env
  for (const row of extra) {
    if (!row.name) continue
    env[row.name] = row.value
  }
  return env
}

/** ACP Client 侧无头终端：spawn 命令，供 Agent 轮询 output / wait / kill / release */
export class AcpTerminalManager {
  private terminals = new Map<string, TerminalRecord>()

  create(params: CreateAcpTerminalParams): { terminalId: string } {
    const command = params.command?.trim()
    if (!command) throw new Error('terminal/create 需要 command')

    const cwd = resolveCwd(params.cwd, params.workspaceRoot)
    const outputByteLimit =
      typeof params.outputByteLimit === 'number' && params.outputByteLimit > 0
        ? params.outputByteLimit
        : DEFAULT_OUTPUT_BYTE_LIMIT

    const child = spawn(command, params.args ?? [], {
      cwd,
      env: buildEnv(params.env),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const id = `term_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const record: TerminalRecord = {
      id,
      sessionId: params.sessionId,
      child,
      output: '',
      truncated: false,
      outputByteLimit,
      exitCode: null,
      signal: null,
      exited: false,
      waiters: [],
    }

    const onChunk = (buf: Buffer) => {
      const chunk = buf.toString('utf8')
      const next = appendTerminalOutput(record.output, chunk, record.outputByteLimit)
      record.output = next.output
      if (next.truncated) record.truncated = true
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('error', (error) => {
      const msg = `\n[spawn error] ${error.message}\n`
      const next = appendTerminalOutput(record.output, msg, record.outputByteLimit)
      record.output = next.output
      if (next.truncated) record.truncated = true
      this.markExited(record, null, null)
    })

    child.on('close', (code, signal) => {
      this.markExited(record, code, signal)
    })

    this.terminals.set(id, record)
    return { terminalId: id }
  }

  getOutput(terminalId: string): AcpTerminalOutputSnapshot {
    const record = this.require(terminalId)
    const snapshot: AcpTerminalOutputSnapshot = {
      output: record.output,
      truncated: record.truncated,
    }
    if (record.exited) {
      snapshot.exitStatus = {
        exitCode: record.exitCode,
        signal: record.signal,
      }
    }
    return snapshot
  }

  waitForExit(terminalId: string): Promise<AcpTerminalExitStatus> {
    const record = this.require(terminalId)
    if (record.exited) {
      return Promise.resolve({ exitCode: record.exitCode, signal: record.signal })
    }
    return new Promise((resolve) => {
      record.waiters.push(resolve)
    })
  }

  kill(terminalId: string): Record<string, never> {
    const record = this.require(terminalId)
    if (!record.exited) {
      this.forceKill(record.child)
    }
    return {}
  }

  release(terminalId: string): Record<string, never> {
    const record = this.terminals.get(terminalId)
    if (!record) return {}
    if (!record.exited) {
      this.forceKill(record.child)
    }
    this.terminals.delete(terminalId)
    return {}
  }

  releaseAll(): void {
    for (const id of [...this.terminals.keys()]) {
      this.release(id)
    }
  }

  private forceKill(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch {
        try {
          child.kill()
        } catch {
          // ignore
        }
      }
      return
    }
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }

  private require(terminalId: string): TerminalRecord {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error(`未知 terminalId: ${terminalId}`)
    return record
  }

  private markExited(
    record: TerminalRecord,
    code: number | null,
    signal: NodeJS.Signals | string | null,
  ): void {
    if (record.exited) return
    record.exited = true
    record.exitCode = code
    record.signal = signal
    const status = { exitCode: code, signal }
    for (const waiter of record.waiters) waiter(status)
    record.waiters = []
  }
}
