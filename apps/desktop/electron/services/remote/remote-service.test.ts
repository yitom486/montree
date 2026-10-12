import { describe, expect, it } from 'vitest'
import {
  decodeWslBuffer,
  getLinuxParentPath,
  parseSshConfigFile,
  parseWslListOutput,
  resolveWslUncPath,
} from './remote-service'

describe('parseWslListOutput', () => {
  it('正确解析并标记默认发行版，过滤掉 docker-desktop-data', () => {
    const raw = `
  NAME              STATE           VERSION
* Ubuntu            Running         2
  Debian            Stopped         2
  docker-desktop    Running         2
  docker-desktop-data Stopped       2
`
    const distros = parseWslListOutput(raw)
    expect(distros).toEqual([
      { name: 'Ubuntu', isDefault: true },
      { name: 'Debian', isDefault: false },
      { name: 'docker-desktop', isDefault: false },
    ])
  })

  it('空文本或无分发版时返回空数组', () => {
    expect(parseWslListOutput('')).toEqual([])
    expect(parseWslListOutput('   ')).toEqual([])
  })
})

describe('getLinuxParentPath', () => {
  it('计算正确的父级路径', () => {
    expect(getLinuxParentPath('/home/user/blog')).toBe('/home/user')
    expect(getLinuxParentPath('/home/user')).toBe('/home')
    expect(getLinuxParentPath('/home')).toBe('/')
    expect(getLinuxParentPath('/')).toBeNull()
    expect(getLinuxParentPath('')).toBeNull()
  })
})

describe('decodeWslBuffer', () => {
  it('支持解码 UTF-16LE 缓冲区', () => {
    const buf = Buffer.from('Ubuntu\r\n', 'utf16le')
    expect(decodeWslBuffer(buf)).toContain('Ubuntu')
  })

  it('支持解码 UTF-8 缓冲区', () => {
    const buf = Buffer.from('Ubuntu\r\n', 'utf8')
    expect(decodeWslBuffer(buf)).toContain('Ubuntu')
  })
})

describe('parseSshConfigFile', () => {
  it('正确解析 ~/.ssh/config 并提取 Host 主机信息', () => {
    const config = `
# 个人博客主机
Host my-blog
  HostName 192.168.1.100
  User ubuntu
  Port 2222

# 公司开发机
Host dev-server
  HostName dev.company.com
  User dev

# 全局配置，应忽略通配符
Host *
  ServerAliveInterval 60
`
    const hosts = parseSshConfigFile(config)
    expect(hosts).toEqual([
      { host: 'my-blog', hostname: '192.168.1.100', user: 'ubuntu', port: 2222 },
      { host: 'dev-server', hostname: 'dev.company.com', user: 'dev' },
    ])
  })

  it('空配置返回空数组', () => {
    expect(parseSshConfigFile('')).toEqual([])
  })
})
