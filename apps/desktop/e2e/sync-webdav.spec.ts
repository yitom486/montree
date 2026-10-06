import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { test, expect } from '@playwright/test'
import { launchBuiltApp } from './helpers/launch-app'

/** 内存 WebDAV stub：PROPFIND / MKCOL / GET / PUT，不依赖外网 */
async function startWebDavStub(): Promise<{
  server: Server
  baseUrl: string
  store: Map<string, Buffer>
  calls: string[]
}> {
  const store = new Map<string, Buffer>()
  const calls: string[] = []

  const xml = (href: string) =>
    `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response>` +
    `<d:href>${href}</d:href><d:propstat><d:prop>` +
    `<d:getlastmodified>Wed, 03 Sep 2026 12:00:00 GMT</d:getlastmodified>` +
    `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`

  const readBody = async (req: IncomingMessage): Promise<Buffer> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url ?? '/').split('?')[0]!
    calls.push(`${req.method} ${urlPath}`)

    if (req.method === 'PROPFIND') {
      if (urlPath.endsWith('/') || store.has(urlPath)) {
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(xml(urlPath))
      } else {
        res.writeHead(404)
        res.end()
      }
      return
    }
    if (req.method === 'MKCOL') {
      res.writeHead(201)
      res.end()
      return
    }
    if (req.method === 'GET') {
      const body = store.get(urlPath)
      if (!body) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
      return
    }
    if (req.method === 'PUT') {
      store.set(urlPath, await readBody(req))
      res.writeHead(201)
      res.end()
      return
    }
    res.writeHead(405)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, baseUrl: `http://127.0.0.1:${port}/dav/`, store, calls }
}

test.describe('WebDAV 同步（本地 stub）', () => {
  test('测试连接成功并可执行一次同步', async () => {
    const stub = await startWebDavStub()
    const app = await launchBuiltApp()

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('button',   { name: '更多操作', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      // 打开设置
      await window.getByRole('button',   { name: '更多操作', exact: true }).click()
      await window.getByRole('menuitem', { name: /设置/ }).click()
      const dialog = window.getByRole('dialog', { name: '设置' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })

      // 启用同步并选通用 WebDAV
      await dialog.getByRole('switch', { name: '启用云端同步' }).click()
      await dialog.getByRole('button', { name: '通用 WebDAV', exact: true }).click()

      // 填 stub 服务信息
      await dialog.getByPlaceholder('https://dav.jianguoyun.com/dav/').fill(stub.baseUrl)
      await dialog.getByPlaceholder('坚果云注册邮箱').fill('e2e@test.local')
      await dialog.getByPlaceholder('WebDAV 密码').fill('secret')

      // 测试连接
      await dialog.getByRole('button', { name: '测试连接' }).click()
      await expect(window.getByText(/连接成功/)).toBeVisible({ timeout: 20_000 })

      // 立即同步：远端落下三份数据
      await dialog.getByRole('button', { name: '立即同步' }).click()
      await expect(window.getByText(/同步完成/)).toBeVisible({ timeout: 30_000 })
      expect(stub.store.has('/dav/MontreeSync/reading-marks.json')).toBe(true)
      expect(stub.store.has('/dav/MontreeSync/reading-progress.json')).toBe(true)
      expect(stub.store.has('/dav/MontreeSync/quiz-records.jsonl')).toBe(true)
    } finally {
      await app.close()
      stub.server.close()
    }
  })
})
