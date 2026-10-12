import { describe, expect, it } from 'vitest'
import {
  isSameWorkspace,
  isWslPath,
  linuxToWindowsPath,
  normalizeWorkspaceRoot,
  parseWslPath,
  windowsToLinuxPath,
} from './wsl-path'


describe('wsl-path 工具库', () => {
  it('isWslPath 准确识别各类 WSL UNC 路径', () => {
    expect(isWslPath('\\\\wsl.localhost\\Ubuntu\\home\\user\\blog')).toBe(true)
    expect(isWslPath('//wsl.localhost/Ubuntu/home/user/blog')).toBe(true)
    expect(isWslPath('\\\\wsl$\\Debian\\var\\log')).toBe(true)
    expect(isWslPath('\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home')).toBe(true)
    expect(isWslPath('\\\\?\\wsl.localhost\\Ubuntu\\home')).toBe(true)

    // 非 WSL 路径
    expect(isWslPath('C:\\Users\\admin\\documents')).toBe(false)
    expect(isWslPath('D:/project/notes')).toBe(false)
    expect(isWslPath('\\\\shared-server\\docs')).toBe(false)
    expect(isWslPath('')).toBe(false)
  })

  it('parseWslPath 正确解析发行版与 Linux 内部相对/绝对路径', () => {
    expect(parseWslPath('\\\\wsl.localhost\\Ubuntu\\home\\zheye\\my-blog')).toEqual({
      isWsl: true,
      distro: 'Ubuntu',
      linuxPath: '/home/zheye/my-blog',
    })

    expect(parseWslPath('\\\\wsl$\\openSUSE-Leap-15.4\\etc\\nginx')).toEqual({
      isWsl: true,
      distro: 'openSUSE-Leap-15.4',
      linuxPath: '/etc/nginx',
    })

    expect(parseWslPath('\\\\wsl.localhost\\Arch')).toEqual({
      isWsl: true,
      distro: 'Arch',
      linuxPath: '/',
    })

    expect(parseWslPath('D:\\my-blog')).toEqual({
      isWsl: false,
    })
  })

  it('windowsToLinuxPath 准确映射 Windows 路径到 Linux 路径', () => {
    // WSL 路径 -> Linux 内部路径
    expect(windowsToLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\zheye\\blog')).toBe(
      '/home/zheye/blog',
    )
    expect(windowsToLinuxPath('//wsl$/Ubuntu/var/www/html')).toBe('/var/www/html')

    // Windows 盘符路径 -> /mnt/<drive>/...
    expect(windowsToLinuxPath('C:\\Users\\zheye\\Documents')).toBe('/mnt/c/Users/zheye/Documents')
    expect(windowsToLinuxPath('d:/project/inkdown')).toBe('/mnt/d/project/inkdown')
  })

  it('linuxToWindowsPath 准确映射 Linux 路径到 Windows 路径', () => {
    // Linux 盘符挂载点 -> Windows 盘符
    expect(linuxToWindowsPath('/mnt/c/Users/zheye/Documents')).toBe('C:\\Users\\zheye\\Documents')
    expect(linuxToWindowsPath('/mnt/d/project')).toBe('D:\\project')
    expect(linuxToWindowsPath('/mnt/c')).toBe('C:\\')

    // 纯 Linux 路径 -> WSL UNC 路径
    expect(linuxToWindowsPath('/home/zheye/blog', 'Ubuntu')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\zheye\\blog',
    )
    expect(linuxToWindowsPath('var/log', 'Debian')).toBe(
      '\\\\wsl.localhost\\Debian\\var\\log',
    )
  })

  it('normalizeWorkspaceRoot 规范化工作区路径', () => {
    expect(normalizeWorkspaceRoot(undefined)).toBeUndefined()
    expect(normalizeWorkspaceRoot('')).toBeUndefined()
    expect(normalizeWorkspaceRoot('   ')).toBeUndefined()
    expect(normalizeWorkspaceRoot('D:\\project\\blog\\')).toBe('D:/project/blog')
    expect(normalizeWorkspaceRoot('\\\\wsl.localhost\\Ubuntu\\home\\user\\blog\\')).toBe(
      '//wsl.localhost/Ubuntu/home/user/blog',
    )
    expect(normalizeWorkspaceRoot('\\\\wsl$\\Ubuntu\\home\\user\\blog')).toBe(
      '//wsl$/Ubuntu/home/user/blog',
    )
  })

  it('isSameWorkspace 识别同一工作区（跨正反斜杠、大小写与 WSL UNC 别名）', () => {
    expect(isSameWorkspace('D:\\project\\blog', 'd:/project/blog/')).toBe(true)
    expect(isSameWorkspace(undefined, undefined)).toBe(true)
    expect(isSameWorkspace('D:\\project\\blog', undefined)).toBe(false)
    expect(
      isSameWorkspace(
        '\\\\wsl.localhost\\Ubuntu\\home\\user\\blog',
        '\\\\wsl$\\Ubuntu\\home\\user\\blog\\',
      ),
    ).toBe(true)
    expect(
      isSameWorkspace(
        '\\\\wsl.localhost\\Ubuntu\\home\\user\\blog',
        '\\\\wsl.localhost\\Debian\\home\\user\\blog',
      ),
    ).toBe(false)
  })
})

