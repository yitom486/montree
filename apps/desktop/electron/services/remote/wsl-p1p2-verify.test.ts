/**
 * P1/P2 真实 WSL 验证（门控 live 测试，默认跳过）。
 *
 * Run: MONTREE_LIVE_WSL=1 bunx vitest run apps/desktop/electron/services/remote/wsl-p1p2-verify.test.ts
 *
 * 在 B1 验收基础上验证本次 P1/P2 修复的新增接线（真实 Ubuntu + 真实服务）：
 * 1. WslWorkspaceHost.getTransport/getSessionGeneration 经 RemoteWorkspaceHost
 *    读写/冲突闭环（P1 传输适配）。
 * 2. 远端 watch 事件经适配器 onEvent → 宿主代际过滤后送达（P4 代际匹配）。
 * 3. 两个独立 WslWorkspaceHost（模拟两窗口）连不同根，断开 A 后 B 照常
 *    读写（P2 传输层隔离）。
 * 4. saveFile 携带过期 expectedContent 被拒且磁盘不动（P3 provider 路径）。
 *
 * 约束：只用 /tmp 临时目录；Node 用户态供给（复用系统临时目录缓存的
 * tarball）；不改 wsl.conf/.wslconfig/SSH/科研项目与个人配置。
 * 证据落盘：.plan/p1p2-wsl-verify.log（gitignore，不提交）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { WslWorkspaceHost } from './wsl-workspace-host'
import { RemoteWorkspaceHost } from '../remote-workspace-host'
import { realWslRunner, type WslRunner } from './wsl-bootstrap'
import type { WorkspaceDescriptor, WorkspaceWatchEvent } from '@montree/contracts'

const DISTRO = 'Ubuntu'
const LOG = join(process.cwd(), '.plan', 'p1p2-wsl-verify.log')
const NODE_VERSION = 'v22.14.0'
const NODE_TARBALL = `node-${NODE_VERSION}-linux-x64.tar.gz`
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}`
const NODE_SUMS_URL = `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  appendFileSync(LOG, `${stamped}\n`)
}

async function wslSh(script: string, stdin?: Buffer, timeoutMs = 60000) {
  const r = await realWslRunner(['-d', DISTRO, '--exec', 'sh', '-c', script], stdin, timeoutMs)
  return { code: r.exitCode, out: r.stdout.toString('utf8').replace(/\r/g, ''), err: r.stderr }
}

describe.runIf(process.env.MONTREE_LIVE_WSL === '1')('P1/P2 真实 WSL 验证', () => {
  it('传输适配 + 代际 watch + 双连接隔离 + provider 保存语义', async () => {
    rmSync(LOG, { force: true })
    const t0 = Date.now()
    const roots: string[] = []
    const nodeDirs: string[] = []
    log(`P1/P2 verify start distro=${DISTRO} winNode=${process.version}`)

    try {
      const bundlePath = join(process.cwd(), 'apps', 'desktop', 'resources', 'remote-server', 'montree-remote-server.cjs')
      const manifestPath = join(process.cwd(), 'apps', 'desktop', 'resources', 'remote-server', 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { buildId: string; entry: string }
      expect(existsSync(bundlePath)).toBe(true)

      const mkNode = await wslSh('mktemp -d /tmp/montree-p1p2-node-XXXXXX')
      const nodeDir = mkNode.out.trim().split('\n').pop()!
      nodeDirs.push(nodeDir)
      const dlDir = join(tmpdir(), 'montree-b1-dl')
      mkdirSync(dlDir, { recursive: true })
      const tarPath = join(dlDir, NODE_TARBALL)
      if (!existsSync(tarPath)) {
        log(`downloading ${NODE_URL}`)
        const resp = await fetch(NODE_URL)
        expect(resp.ok).toBe(true)
        writeFileSync(tarPath, Buffer.from(await resp.arrayBuffer()))
        const sums = await (await fetch(NODE_SUMS_URL)).text()
        const want = sums.split('\n').find((l) => l.includes(NODE_TARBALL))?.split(/\s+/)[0]
        const got = createHash('sha256').update(readFileSync(tarPath)).digest('hex')
        log(`tarball sha256 ok=${got === want}`)
        expect(got).toBe(want)
      } else {
        log('tarball 复用已下载版本')
      }
      const nodeBinDir = `${nodeDir}/dist/bin`
      const extract = await wslSh(`mkdir -p '${nodeDir}/dist' && tar -xz -C '${nodeDir}/dist' --strip-components=1`, readFileSync(tarPath), 180000)
      expect(extract.code).toBe(0)
      const wrapArgs = (args: string[]): string[] => {
        const i = args.indexOf('--exec')
        if (i < 0) return args
        return [...args.slice(0, i + 1), 'sh', '-c', `export PATH="${nodeBinDir}:$PATH"; exec "$@"`, 'montree-wrap', ...args.slice(i + 1)]
      }
      const pathRunner: WslRunner = (args, stdin, timeout) => realWslRunner(wrapArgs(args), stdin, timeout)
      const pathSpawn = (command: string, args: string[]): ChildProcess => {
        expect(command).toBe('wsl.exe')
        return spawn(command, wrapArgs(args), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      }
      const deps = { runner: pathRunner, spawnFn: pathSpawn, serverAssets: { bundlePath, manifestPath }, onLog: (l: string) => log(l) }

      const mkA = await wslSh(`mktemp -d '/tmp/montree p1p2 A-XXXXXX'`)
      const rootA = mkA.out.trim().split('\n').pop()!
      const mkB = await wslSh(`mktemp -d '/tmp/montree p1p2 B-XXXXXX'`)
      const rootB = mkB.out.trim().split('\n').pop()!
      roots.push(rootA, rootB)
      await wslSh(`printf 'hello-a\\n' > '${rootA}/a.md' && printf 'hello-b\\n' > '${rootB}/b.md' && echo ready`)
      log(`rootA=${rootA}`)
      log(`rootB=${rootB}`)

      const hostA = new WslWorkspaceHost(deps)
      const hostB = new WslWorkspaceHost(deps)
      const connA = await hostA.connect(DISTRO, rootA)
      expect(connA.ok).toBe(true)
      if (!connA.ok) return
      const connB = await hostB.connect(DISTRO, rootB)
      expect(connB.ok).toBe(true)
      if (!connB.ok) return
      log(`A handshake platform=${connA.value.handshake?.platform} node=${connA.value.handshake?.nodeVersion}`)
      log(`B handshake platform=${connB.value.handshake?.platform} node=${connB.value.handshake?.nodeVersion}`)
      expect(connA.value.handshake?.platform).toBe('linux')
      expect(connA.value.handshake?.buildId).toBe(manifest.buildId)

      const descA: WorkspaceDescriptor = { id: `wsl:${DISTRO}:${rootA}`, kind: 'wsl', target: DISTRO, rootLabel: rootA, displayName: 'A' }
      const transportA = hostA.getTransport()
      const sessionGenA = hostA.getSessionGeneration()
      expect(transportA).not.toBeNull()
      expect(sessionGenA).not.toBeNull()
      if (!transportA || !sessionGenA) return
      log(`A sessionGeneration=${sessionGenA}`)
      const remoteA = new RemoteWorkspaceHost(descA, transportA, sessionGenA)

      // 1) 远端宿主经适配器读写 + revision 冲突（P1/P3）
      const read1 = await remoteA.readText('a.md')
      expect(read1.ok).toBe(true)
      if (!read1.ok) return
      expect(read1.value.content).toBe('hello-a\n')
      const write1 = await remoteA.writeText('a.md', { content: 'hello-a2\n', expectedRevision: read1.value.revision })
      expect(write1.ok).toBe(true)
      await wslSh(`printf 'external-a\\n' > '${rootA}/a.md'`)
      const conflict = await remoteA.writeText('a.md', { content: 'stale\n', expectedRevision: read1.value.revision })
      expect(conflict.ok).toBe(false)
      if (conflict.ok) return
      expect(conflict.error.code).toBe('REVISION_CONFLICT')
      const reread = await remoteA.readText('a.md')
      expect(reread.ok).toBe(true)
      if (!reread.ok) return
      expect(reread.value.content).toBe('external-a\n')
      log('1) 适配器读写/冲突/磁盘不动 ok')

      // saveFile provider 语义（P3）：一致写盘，两次过期拒绝
      const saveOk = await remoteA.saveFile({ filePath: 'a.md', content: 'v-next\n', expectedContent: 'external-a\n' })
      expect(saveOk.ok).toBe(true)
      await wslSh(`printf 'external-a2\\n' > '${rootA}/a.md'`)
      const saveBad1 = await remoteA.saveFile({ filePath: 'a.md', content: 's1\n', expectedContent: 'v-next\n' })
      const saveBad2 = await remoteA.saveFile({ filePath: 'a.md', content: 's2\n', expectedContent: 'v-next\n' })
      expect(saveBad1.ok).toBe(false)
      expect(saveBad2.ok).toBe(false)
      if (saveBad1.ok || saveBad2.ok) return
      expect(saveBad1.error.code).toBe('REVISION_CONFLICT')
      const diskA = await wslSh(`cat '${rootA}/a.md'`)
      expect(diskA.out).toBe('external-a2\n')
      log('2) saveFile expectedContent 两次拒绝 + 磁盘不动 ok')

      // 2) watch 事件代际匹配（P4）：外部写 → 宿主监听器收到
      let watched: WorkspaceWatchEvent | null = null
      const unwatch = remoteA.onWatchEvent((event) => {
        watched = event
      })
      try {
        const sub = await remoteA.watchDirectory('')
        expect(sub.ok).toBe(true)
        await wslSh(`printf 'watch-me\\n' > '${rootA}/watch.md'`)
        const deadline = Date.now() + 20000
        while (!watched && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
        expect(watched).not.toBeNull()
        const paths = (watched as unknown as WorkspaceWatchEvent).changes.map((c) => c.path).join(',')
        log(`3) watch 事件送达 changes=${paths} generation=${(watched as unknown as WorkspaceWatchEvent).generation}`)
        expect(paths.split(',')).toContain('watch.md')
      } finally {
        unwatch()
      }

      // 3) P2 隔离：断开 A，B 照常读写
      hostA.disconnect()
      expect(hostA.getTransport()).toBeNull()
      const transportB = hostB.getTransport()
      const sessionGenB = hostB.getSessionGeneration()
      expect(transportB).not.toBeNull()
      expect(sessionGenB).not.toBeNull()
      if (!transportB || !sessionGenB) return
      const descB: WorkspaceDescriptor = { id: `wsl:${DISTRO}:${rootB}`, kind: 'wsl', target: DISTRO, rootLabel: rootB, displayName: 'B' }
      const remoteB = new RemoteWorkspaceHost(descB, transportB, sessionGenB)
      const readB = await remoteB.readText('b.md')
      expect(readB.ok).toBe(true)
      if (!readB.ok) return
      expect(readB.value.content).toBe('hello-b\n')
      const writeB = await remoteB.writeText('b.md', { content: 'hello-b2\n', expectedRevision: readB.value.revision })
      expect(writeB.ok).toBe(true)
      log('4) A 断开后 B 照常读写 ok')

      // 5) 迷你性能矩阵（中位数/环境同记；无历史基线，不宣称倍数）
      // 200 文件目录浏览
      await wslSh(`mkdir -p '${rootB}/perf200' && for i in $(seq 1 200); do printf "# f$i\\n" > '${rootB}/perf200/f$i.md'; done && echo seeded`)
      const browseTimes: number[] = []
      for (let i = 0; i < 5; i += 1) {
        const t = Date.now()
        const listed = await transportB.invoke<{ entries: unknown[] }>('listDirectory', { path: 'perf200' })
        browseTimes.push(Date.now() - t)
        expect(listed.ok).toBe(true)
      }
      browseTimes.sort((a, b) => a - b)
      log(`perf browse200 median=${browseTimes[2]}ms p100=${browseTimes[4]}ms entries=200`)
      // 1MB 文本读/写
      await wslSh(`python3 -c "print('0123456789abcdef'*62500)" > '${rootB}/big.md' && wc -c '${rootB}/big.md'`)
      const tRead = Date.now()
      const bigRead = await remoteB.readText('big.md')
      const readMs = Date.now() - tRead
      expect(bigRead.ok).toBe(true)
      if (!bigRead.ok) return
      log(`perf read1MB ms=${readMs} bytes=${bigRead.value.content.length}`)
      const tWrite = Date.now()
      const bigWrite = await remoteB.writeText('big.md', { content: `${bigRead.value.content}\n`, expectedRevision: bigRead.value.revision })
      const writeMs = Date.now() - tWrite
      expect(bigWrite.ok).toBe(true)
      log(`perf write1MB ms=${writeMs}`)
      // Git status（含 WSL 内 git 冷启动）
      await wslSh(`cd '${rootB}' && git init -q -b main 2>/dev/null; git config user.email t@t.t && git config user.name t && git add -A && git commit -qm init && echo git-ready`)
      const tGit = Date.now()
      const gitSt = await remoteB.gitStatus('')
      const gitMs = Date.now() - tGit
      expect(gitSt.isRepo).toBe(true)
      log(`perf gitStatus ms=${gitMs} branch=${gitSt.branch} total=${gitSt.totalChanges}`)
      hostB.disconnect()

      log(`P1/P2 WSL verify PASS totalMs=${Date.now() - t0}`)
    } finally {
      for (const root of roots) await wslSh(`rm -rf '${root}' && echo cleaned`).catch(() => undefined)
      for (const nodeDir of nodeDirs) await wslSh(`rm -rf '${nodeDir}' && echo cleaned`).catch(() => undefined)
      const manifestNow = JSON.parse(readFileSync(join(process.cwd(), 'apps', 'desktop', 'resources', 'remote-server', 'manifest.json'), 'utf8')) as { buildId: string }
      await wslSh(`rm -rf "$HOME/.cache/montree/remote-server/${manifestNow.buildId}" && echo cleaned`).catch(() => undefined)
    }
  }, 300000)
})
