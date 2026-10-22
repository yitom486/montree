import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * 解压用的 tar 可执行文件。
 * Windows 必须用系统自带的 bsdtar（System32\tar.exe，可解 zip）；PATH 里若先命中 Git 的 GNU tar，
 * 它不认识 zip，且会把 `C:` 当远程主机，解压直接失败。
 */
export function systemTarCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return 'tar'
  const system = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}
