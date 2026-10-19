import { existsSync } from 'node:fs'
import { stat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { IPty } from 'node-pty'
import type { WorkspaceDescriptor } from '@yitom/contracts'
import type { TerminalCreate, TerminalEvent, TerminalInfo, TerminalOutput, TerminalProfile } from '../../contracts/terminal'

interface Profile extends TerminalProfile { file: string; args: string[] }
interface RecordEntry { owner: string; info: TerminalInfo; pty: IPty; output: string; cursor: number }
const OUTPUT_LIMIT = 262_144
function executable(name: string): string | undefined {
  const names = process.platform === 'win32' && !name.endsWith('.exe') ? [name + '.exe', name] : [name]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const candidate of names) { const file = join(directory, candidate); if (existsSync(file)) return file }
  }
  return undefined
}
function localProfiles(): Profile[] {
  if (process.platform !== 'win32') return [{ id: 'default', label: '默认 Shell', file: process.env.SHELL || '/bin/bash', args: ['-l'] }]
  const profiles: Profile[] = [{ id: 'powershell', label: 'PowerShell', file: executable('pwsh') || join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), args: ['-NoLogo'] },
    { id: 'cmd', label: '命令提示符', file: process.env.ComSpec || 'cmd.exe', args: [] }]
  const bash = process.env.OPENCODE_GIT_BASH_PATH || join(process.env.ProgramFiles || 'C:\\Program Files', 'Git/bin/bash.exe')
  if (existsSync(bash)) profiles.push({ id: 'bash', label: 'Git Bash', file: bash, args: ['-l'] })
  return profiles
}
export function terminalProfiles(workspace: WorkspaceDescriptor | null): TerminalProfile[] {
  if (workspace?.kind === 'wsl') return [{ id: 'wsl', label: `WSL · ${workspace.target}` }]
  if (workspace && workspace.kind !== 'local') throw new Error('当前远程工作区尚未提供交互式终端')
  return localProfiles().map(({ id, label }) => ({ id, label }))
}
function dimension(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 2 || value > maximum) throw new Error('终端尺寸无效')
  return value
}

export class TerminalService {
  private records = new Map<string, RecordEntry>()
  private epochs = new Map<string, number>()
  constructor(private emit: (owner: string, event: TerminalEvent) => void,
    private loadPty: () => Promise<Pick<typeof import('node-pty'), 'spawn'>> = () => import('node-pty')) {}

  list(owner: string): TerminalInfo[] { return [...this.records.values()].filter(r => r.owner === owner).map(r => ({ ...r.info })) }

  async create(owner: string, workspace: WorkspaceDescriptor | null, params: TerminalCreate = {},
    isCurrent: () => boolean = () => true): Promise<TerminalInfo> {
    if (this.list(owner).length >= 12) throw new Error('终端数量已达上限，请先关闭不用的终端')
    const epoch = this.epochs.get(owner) ?? 0
    const cols = dimension(params.cols, 80, 1000), rows = dimension(params.rows, 24, 500)
    const available = terminalProfiles(workspace)
    const profileId = params.profile || available[0].id
    if (!available.some(p => p.id === profileId)) throw new Error('此工作区不支持所选 Shell')
    let cwd = workspace?.rootLabel || homedir()
    let file: string, args: string[]
    if (workspace?.kind === 'wsl') {
      if (process.platform !== 'win32' || !workspace.target || !cwd.startsWith('/')) throw new Error('WSL 终端配置无效')
      file = join(process.env.SystemRoot || 'C:\\Windows', 'System32/wsl.exe')
      args = ['--distribution', workspace.target, '--cd', cwd, '--exec', 'bash', '-l']
    } else {
      cwd = await realpath(resolve(cwd))
      if (!(await stat(cwd)).isDirectory()) throw new Error('终端工作目录不存在')
      const profile = localProfiles().find(p => p.id === profileId)!
      file = profile.file
      args = profile.args
    }
    const pty = await this.loadPty()
    if ((this.epochs.get(owner) ?? 0) !== epoch || !isCurrent()) throw new Error('窗口或工作区已变更，终端创建已取消')
    if (this.list(owner).length >= 12) throw new Error('终端数量已达上限')
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE
    const child = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: workspace?.kind === 'wsl' ? homedir() : cwd, env })
    const info: TerminalInfo = { id: randomUUID(), title: available.find(p => p.id === profileId)!.label,
      cwd, profile: profileId }
    const record: RecordEntry = { owner, info, pty: child, output: '', cursor: 0 }
    this.records.set(info.id, record)
    child.onData(data => {
      if (!this.records.has(info.id)) return
      record.cursor += data.length
      record.output = (record.output + data).slice(-OUTPUT_LIMIT)
      this.emit(owner, { type: 'data', id: info.id, data, cursor: record.cursor })
    })
    child.onExit(({ exitCode }) => {
      info.exitCode = exitCode
      if (this.records.has(info.id)) this.emit(owner, { type: 'exit', id: info.id, exitCode })
    })
    this.emit(owner, { type: 'created', terminal: { ...info } })
    return { ...info }
  }

  private require(owner: string, id: string): RecordEntry {
    const record = this.records.get(id)
    if (!record || record.owner !== owner) throw new Error('终端不存在或不属于当前窗口')
    return record
  }
  read(owner: string, id: string, cursor = 0): TerminalOutput {
    const r = this.require(owner, id)
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > r.cursor) throw new Error('终端输出位置无效')
    const base = r.cursor - r.output.length
    return { output: r.output.slice(Math.max(0, cursor - base)), cursor: r.cursor, truncated: cursor < base, exitCode: r.info.exitCode }
  }
  write(owner: string, id: string, data: string): void {
    const r = this.require(owner, id)
    if (typeof data !== 'string' || data.length > 65536) throw new Error('终端输入过长或无效')
    if (r.info.exitCode !== undefined) throw new Error('终端已经退出')
    r.pty.write(data)
  }
  resize(owner: string, id: string, cols: number, rows: number): void {
    const r = this.require(owner, id)
    if (r.info.exitCode === undefined) r.pty.resize(dimension(cols, 80, 1000), dimension(rows, 24, 500))
  }
  private kill(r: RecordEntry): void {
    if (r.info.exitCode !== undefined) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(r.pty.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => { try { r.pty.kill() } catch { /* already exited */ } })
    } else {
      try { process.kill(-r.pty.pid, 'SIGKILL') } catch { try { r.pty.kill() } catch { /* already exited */ } }
    }
  }
  close(owner: string, id: string): void {
    const r = this.require(owner, id)
    this.kill(r); this.records.delete(id); this.emit(owner, { type: 'closed', id })
  }
  disposeOwner(owner: string): void {
    this.epochs.set(owner, (this.epochs.get(owner) ?? 0) + 1)
    for (const r of [...this.records.values()]) if (r.owner === owner) this.close(owner, r.info.id)
  }
  dispose(): void { for (const owner of new Set([...this.records.values()].map(r => r.owner))) this.disposeOwner(owner) }
}
