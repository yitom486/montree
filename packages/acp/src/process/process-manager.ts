import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import type { AcpRuntimeInfo } from "../contracts"

export interface SpawnedAcpProcess {
  runtimeId: string
  child: ChildProcessWithoutNullStreams
  kill: () => void
  /** spawn 时间戳（保留供诊断/排序，stderr 归因已去窗口化，不再参与判定） */
  spawnedAt: number
  /** stderr 最后 N 行活引用（连接失败自诊断用，上限见 ACP_EARLY_EXIT_STDERR_TAIL_LINES） */
  stderrTail: string[]
}

const active = new Map<string, SpawnedAcpProcess>()

/**
 * @deprecated 早退判定窗口已去窗口化（dsh 依赖解析慢退漏归因教训）：
 * 保留导出仅防旧引用，`getAcpEarlyExitStderrDetail` 不再读取它。
 */
export const ACP_EARLY_EXIT_WINDOW_MS = 3_000
/** 连接失败时拼进错误的 stderr 尾部行数上限。单处常量。 */
export const ACP_EARLY_EXIT_STDERR_TAIL_LINES = 20

export interface SpawnAcpOptions {
  runtime: AcpRuntimeInfo
  cwd: string
  env?: NodeJS.ProcessEnv
  /** 需要从继承环境里剔除的变量名（如关闭代理时清理 HTTP(S)_PROXY） */
  envRemove?: string[]
  onStderrLine?: (line: string) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

/**
 * 进程是否仍存活。exitCode 非 null 表示已退出；killed 仅表示收到过 kill 信号，
 * 必须两者结合判断，避免对已退出（PID 可能已被系统复用）的进程再下手。
 */
export function isSpawnedAcpProcessAlive(handle: SpawnedAcpProcess): boolean {
  const child = handle.child
  return !child.killed && child.exitCode === null && child.signalCode === null
}

/**
 * 按 PID 树级联杀（Windows）：趁父进程（PyInstaller 引导器）还活着时沿父子链
 * 把外层引导器 / 内层 Python / harness 一并击杀，避免只杀外层留下孤儿。
 * 仅对确认存活的进程执行，防止误伤已被系统回收复用的 PID。
 */
function killProcessTree(pid: number): void {
  if (process.platform !== 'win32') return
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      timeout: 8000,
    })
  } catch {
    // taskkill 失败时上层仍有 child.kill() 兜底
  }
}
function resolveCommand(runtime: AcpRuntimeInfo): { file: string; shell: boolean } {
  // Windows 上 .exe（如 node.exe, bun.exe 等）以及 node/bun runtime 绝对不能使用 shell: true，
  // 否则当路径含有空格（如 C:\Program Files\...）时 cmd.exe 会发生截断并报 'C:\Program' 不是内部或外部命令。
  if (process.platform === 'win32') {
    const cmd = runtime.command.toLowerCase()
    if (/\.exe$/i.test(cmd) || cmd === 'bun' || cmd === 'node') {
      return { file: runtime.command, shell: false }
    }
    return { file: runtime.command, shell: true }
  }
  return { file: runtime.command, shell: false }
}

/**
 * 多运行时温进程隔离：`active` 按 runtime.id 分键，绝不跨 runtime 串用。
 * connect 前一律经 `getLiveAcpProcess(runtime.id)` 取同 runtime 温进程；
 * 不同 runtime 即使 command 相同也各持独立句柄。
 */
// TODO(下游 contracts 未就绪): 8 模板落地后各 runtime 独立 command/args 在此自然分键，无需再改。
export function spawnAcpProcess(options: SpawnAcpOptions): SpawnedAcpProcess {
  // 防御性：模板缺 command/args 时早失败，避免 spawn 空命令污染温进程表。
  if (!options.runtime?.id || !options.runtime.command || !Array.isArray(options.runtime.args)) {
    throw new Error(`ACP 运行时模板缺失 command/args: ${options.runtime?.id ?? '(empty)'}`)
  }
  // 同 runtime 旧句柄先杀（换命令/参数后不复用）；其他 runtime 的温进程不受影响。
  const existing = active.get(options.runtime.id)
  if (existing) {
    existing.kill()
  }

  const { file, shell } = resolveCommand(options.runtime)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  }
  for (const key of options.envRemove ?? []) {
    delete env[key]
  }

  // 过滤 Python/PyInstaller 临时环境变量，避免嵌入式运行时校验中断
  for (const key of Object.keys(env)) {
    if (key.startsWith('_PYI') || key.startsWith('_MEI')) {
      delete env[key]
    }
  }

  // 默认允许本机浏览器 OAuth（对齐 VS Code/Zed）；无头/CI 才禁用
  const forceNoBrowser =
    process.env.INKDOWN_ACP_NO_BROWSER === '1' ||
    process.env.CI === 'true' ||
    process.env.CI === '1'
  if (forceNoBrowser) {
    env.NO_BROWSER = '1'
  } else {
    delete env.NO_BROWSER
  }

  const child = spawn(file, options.runtime.args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams

  let stderrBuffer = ''
  const stderrTail: string[] = []
  const pushStderrTailLine = (line: string) => {
    if (!line.trim()) return
    stderrTail.push(line)
    if (stderrTail.length > ACP_EARLY_EXIT_STDERR_TAIL_LINES) {
      stderrTail.splice(0, stderrTail.length - ACP_EARLY_EXIT_STDERR_TAIL_LINES)
    }
  }
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrBuffer += chunk
    while (true) {
      const idx = stderrBuffer.indexOf('\n')
      if (idx < 0) break
      const line = stderrBuffer.slice(0, idx).replace(/\r$/, '')
      stderrBuffer = stderrBuffer.slice(idx + 1)
      if (line.trim()) {
        pushStderrTailLine(line)
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[acp:${options.runtime.id}]`, line)
        }
        options.onStderrLine?.(line)
      }
    }
  })

  const handle: SpawnedAcpProcess = {
    runtimeId: options.runtime.id,
    child,
    spawnedAt: Date.now(),
    stderrTail,
    kill: () => {
      // 已退出的进程不再下手：其 PID 可能已被系统回收复用，误杀后果严重。
      if (isSpawnedAcpProcessAlive(handle)) {
        // 先递 EOF，让官方服务端走 stdin 优雅退出（PyInstaller 退出钩子会自删 _MEI）。
        try {
          child.stdin.end()
        } catch {
          // stdin 已坏时忽略，走下面的强制路径
        }
        // 树杀整棵进程树（外层引导器/内层 Python/harness），杜绝孤儿残留。
        // 注意：必须趁父子关系还在内核登记时执行，父死后 /T 即失效。
        if (typeof child.pid === 'number') {
          killProcessTree(child.pid)
        }
        if (!child.killed) {
          try {
            child.kill()
          } catch {
            // 忽略竞态关闭
          }
        }
      }
      active.delete(options.runtime.id)
    },
  }

  child.on('exit', (code, signal) => {
    // 无换行结尾的 stderr 残行落尾（harness 缺 key 秒退常为单行无换行输出，不丢）。
    const rest = stderrBuffer.trim()
    if (rest) pushStderrTailLine(rest)
    stderrBuffer = ''
    active.delete(options.runtime.id)
    options.onExit?.(code, signal)
  })

  active.set(options.runtime.id, handle)
  return handle
}

/**
 * 连接失败自诊断（去窗口化）：进程已死且连接失败时，一律取 stderr 尾部
 * 供连接层拼进失败错误，替代裸 `ACP connection closed`。
 * 背景：dsh 自解析依赖耗时远超旧 3s 窗口，慢退漏归因；故不再限早退窗口，
 * 慢退/长会话失败同样受益；正常成功路径不调用此处，零变化。
 * 无 stderr 尾返回 null，调用方保持原错误不变；
 * killProcess/温复用路径不经此处，不受影响。
 * `now` 参数保留仅防旧调用（已忽略）。
 */
export function getAcpEarlyExitStderrDetail(
  handle: Pick<SpawnedAcpProcess, 'spawnedAt' | 'stderrTail'> | null | undefined,
  _now: number = Date.now(),
): string | null {
  if (!handle) return null
  void _now
  const tail = (handle.stderrTail ?? [])
    .filter((line) => line.trim())
    .slice(-ACP_EARLY_EXIT_STDERR_TAIL_LINES)
  if (tail.length === 0) return null
  return tail.join('\n')
}

/** 失败尾部拼进连接失败错误（已含尾部时不重复拼）。函数名保留早退字样仅防旧引用。 */
export function withAcpEarlyExitDetail(message: string, detail: string | null): string {
  if (!detail) return message
  if (message.includes(detail)) return message
  return `${message}\n\n子进程早退 stderr 尾部：\n${detail}`
}

export function disposeAllAcpProcesses(): void {
  for (const handle of [...active.values()]) {
    handle.kill()
  }
  active.clear()
}

export function getActiveAcpProcess(runtimeId: string): SpawnedAcpProcess | undefined {
  return active.get(runtimeId)
}

/** 当前仍存活的温进程 runtime 清单（调试/测试用，不暴露 child 句柄细节）。 */
export function listLiveAcpRuntimeIds(): string[] {
  const ids: string[] = []
  for (const [runtimeId, handle] of active) {
    if (isSpawnedAcpProcessAlive(handle)) ids.push(runtimeId)
  }
  return ids.sort()
}

/**
 * 取同 runtime 下仍存活的常驻进程（复用时用）。已退出或被外部杀掉的返回 undefined，
 * 调用方应走冷启动并顺手清扫其残留临时目录。
 */
export function getLiveAcpProcess(runtimeId: string): SpawnedAcpProcess | undefined {
  const handle = active.get(runtimeId)
  if (!handle) return undefined
  if (!isSpawnedAcpProcessAlive(handle)) {
    active.delete(runtimeId)
    return undefined
  }
  return handle
}
