import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { injectHtmlPreviewBridge } from './bridge-script'
import {
  handleHtmlPreviewRequest,
  previewHostFor,
  registerHtmlPreview,
  releaseHtmlPreview,
  releaseHtmlPreviewsFor,
  resetHtmlPreviewsForTest,
  resolvePreviewBaseDir,
  resolvePreviewResource,
  updateHtmlPreview,
} from './html-preview-protocol'

const workspace = join(process.cwd(), 'fixture-workspace')
const pagePath = join(workspace, 'docs', 'page one.html')

function readFrom(files: Record<string, string>) {
  return async (path: string) => {
    const content = files[path]
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return Buffer.from(content)
  }
}

afterEach(() => resetHtmlPreviewsForTest())

describe('html-preview-protocol', () => {
  it('工作区内文件以工作区根为基准，否则只开放所在目录', () => {
    expect(resolvePreviewBaseDir(pagePath, workspace)).toBe(workspace)
    expect(resolvePreviewBaseDir(join(process.cwd(), 'elsewhere', 'a.html'), workspace)).toBe(join(process.cwd(), 'elsewhere'))
    expect(resolvePreviewBaseDir(pagePath, null)).toBe(join(workspace, 'docs'))
  })

  it('同一工作区共享稳定的源，不同工作区互相隔离', () => {
    const first = registerHtmlPreview({ ownerId: 1, filePath: pagePath, workspaceRoot: workspace })
    const second = registerHtmlPreview({ ownerId: 1, filePath: join(workspace, 'b.html'), workspaceRoot: workspace })
    const host = previewHostFor(workspace)
    expect(first.url).toBe(`montree-html://${host}/docs/page%20one.html?t=${first.token}`)
    expect(new URL(second.url).host).toBe(host)
    expect(previewHostFor(join(process.cwd(), 'other'))).not.toBe(host)
    expect(first.token).not.toBe(second.token)
  })

  it('主文档返回推送的内存文本并注入桥接脚本', async () => {
    const { token, url } = registerHtmlPreview({ ownerId: 7, filePath: pagePath, workspaceRoot: workspace })
    expect((await handleHtmlPreviewRequest(new Request(`${url}&v=1`))).status).toBe(404)

    expect(updateHtmlPreview(7, token, '<!doctype html><html><head><title>T</title></head><body>UNSAVED</body></html>')).toBe(true)
    const response = await handleHtmlPreviewRequest(new Request(`${url}&v=2`), readFrom({}))
    const body = await response.text()
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.startsWith('<!doctype html><html><head><script data-montree-bridge>')).toBe(true)
    expect(body).toContain('UNSAVED')
  })

  it('只有登记窗口能更新或释放自己的预览', async () => {
    const { token, url } = registerHtmlPreview({ ownerId: 1, filePath: pagePath, workspaceRoot: workspace })
    expect(updateHtmlPreview(2, token, 'x')).toBe(false)
    releaseHtmlPreview(2, token)
    expect(updateHtmlPreview(1, token, 'mine')).toBe(true)
    releaseHtmlPreviewsFor(1)
    expect(updateHtmlPreview(1, token, 'gone')).toBe(false)
    expect((await handleHtmlPreviewRequest(new Request(url))).status).toBe(404)
  })

  it('相对子资源按真实目录读盘，越界与特殊路径一律拒绝', async () => {
    const { url } = registerHtmlPreview({ ownerId: 1, filePath: pagePath, workspaceRoot: workspace })
    const host = new URL(url).host
    const read = readFrom({
      [join(workspace, 'assets', 'site.css')]: 'body{color:red}',
      [join(workspace, 'docs', 'next.html')]: '<html><body>NEXT</body></html>',
    })
    const css = await handleHtmlPreviewRequest(new Request(`montree-html://${host}/assets/site.css`), read)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
    expect(await css.text()).toBe('body{color:red}')

    const next = await handleHtmlPreviewRequest(new Request(`montree-html://${host}/docs/next.html`), read)
    expect(await next.text()).toContain('data-montree-bridge')

    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${host}/missing.js`), read)).status).toBe(404)
    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${host}/a%2F..%2F..%2Fsecret`), read)).status).toBe(403)
    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${host}/a%5C..%5Csecret`), read)).status).toBe(403)
    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${host}/file.txt%3Astream`), read)).status).toBe(403)
    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${host}/x`, { method: 'POST', body: 'a' }), read)).status).toBe(405)
    expect((await handleHtmlPreviewRequest(new Request(`montree-html://${previewHostFor('nowhere')}/assets/site.css`), read)).status).toBe(404)
  })

  it('resolvePreviewResource 只返回基准目录内的路径', () => {
    expect(resolvePreviewResource(workspace, '/assets/a%20b.png')).toBe(join(workspace, 'assets', 'a b.png'))
    expect(resolvePreviewResource(workspace, '/%E0%A4%A')).toBeNull()
    expect(resolvePreviewResource(workspace, '/..')).toBeNull()
  })

  it('桥接脚本插在 head 开头，缺 head 时不挤到 doctype 前面', () => {
    expect(injectHtmlPreviewBridge('<html><head></head><body></body></html>')).toMatch(/^<html><head><script data-montree-bridge>/)
    expect(injectHtmlPreviewBridge('<!DOCTYPE html><p>x</p>')).toMatch(/^<!DOCTYPE html><script data-montree-bridge>/)
    expect(injectHtmlPreviewBridge('<header>不是 head</header>')).toMatch(/^<script data-montree-bridge>/)
    expect(injectHtmlPreviewBridge('<p>x</p>')).not.toContain('</script></script>')
  })
})
