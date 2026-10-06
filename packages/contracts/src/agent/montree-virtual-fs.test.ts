import { describe, expect, it } from 'vitest'
import {
  isMontreeVirtualDirPath,
  parseMontreeVirtualPath,
} from '@montree/contracts'

const ROOT = 'D:/books/workspace'

describe('parseMontreeVirtualPath', () => {
  it('识别绝对路径', () => {
    expect(parseMontreeVirtualPath(`${ROOT}/.montree/agent/toc.json`, ROOT)).toBe('toc.json')
  })

  it('识别 Windows 反斜杠路径', () => {
    expect(
      parseMontreeVirtualPath('D:\\books\\workspace\\.montree\\agent\\focused.json', ROOT),
    ).toBe('focused.json')
  })

  it('识别相对路径与 ./ 前缀', () => {
    expect(parseMontreeVirtualPath('.montree/agent/toc.json', ROOT)).toBe('toc.json')
    expect(parseMontreeVirtualPath('./.montree/agent/toc.json', ROOT)).toBe('toc.json')
  })

  it('识别 viewport.txt', () => {
    expect(parseMontreeVirtualPath(`${ROOT}/.montree/agent/viewport.txt`, ROOT)).toBe(
      'viewport.txt',
    )
  })

  it('普通文件返回 null', () => {
    expect(parseMontreeVirtualPath(`${ROOT}/README.md`, ROOT)).toBeNull()
    expect(parseMontreeVirtualPath('src/App.tsx', ROOT)).toBeNull()
  })

  it('虚拟目录下的未知资源返回 null，但能被目录判定捕获', () => {
    const unknown = `${ROOT}/.montree/agent/nope.json`
    expect(parseMontreeVirtualPath(unknown, ROOT)).toBeNull()
    expect(isMontreeVirtualDirPath(unknown, ROOT)).toBe(true)
  })

  it('同名前缀目录不误判', () => {
    expect(isMontreeVirtualDirPath(`${ROOT}/.montree/agentlog/a.txt`, ROOT)).toBe(false)
    expect(parseMontreeVirtualPath(`${ROOT}/.montree-agent/toc.json`, ROOT)).toBeNull()
  })
})
