import { BrowserWindow, session, shell } from 'electron'
import { feedAuthPartition, FEED_BROWSER_UA, type FeedAuthStatus, type FeedSourceId } from '../../contracts/feed'

function authSession(source: FeedSourceId): Electron.Session {
  const ses = session.fromPartition(feedAuthPartition(source))
  ses.setUserAgent(FEED_BROWSER_UA)
  return ses
}

interface AuthSourceConfig {
  label: string
  loginUrl: string
  /** 登录窗口允许停留的站点（含 OAuth 提供方） */
  origins: string[]
  /** 登录态探测接口；返回用户名才算已登录 */
  probeUrl: string
  probeUser: (json: unknown) => string | null
}

const AUTH_SOURCES: Partial<Record<FeedSourceId, AuthSourceConfig>> = {
  'linux-do': {
    label: 'Linux.do',
    loginUrl: 'https://linux.do/login',
    origins: [
      'https://linux.do',
      'https://www.linux.do',
      'https://github.com',
      'https://accounts.google.com',
      'https://appleid.apple.com',
    ],
    probeUrl: 'https://linux.do/session/current.json',
    probeUser: (json) => {
      const value = json as { current_user?: { username?: unknown } } | null
      const username = value?.current_user?.username
      return typeof username === 'string' && username.trim() ? username : null
    },
  },
}

function probeTimeoutMs(): number {
  return 8_000
}

async function fetchWithTimeout(
  ses: Electron.Session,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs())
  try {
    return await ses.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function getFeedAuthStatus(source: FeedSourceId): Promise<FeedAuthStatus> {
  const config = AUTH_SOURCES[source]
  if (!config) return { authenticated: false }
  const ses = authSession(source)
  try {
    const response = await fetchWithTimeout(ses, config.probeUrl, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return {
        authenticated: false,
        blocked: response.status === 401 || response.status === 403 || response.status === 503,
      }
    }
    const json = (await response.json()) as unknown
    const user = config.probeUser(json)
    return user ? { authenticated: true, user } : { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}

const loginWindows = new Map<FeedSourceId, BrowserWindow>()
const loginPromises = new Map<FeedSourceId, Promise<FeedAuthStatus>>()

function isAllowedOrigin(url: string, origins: string[]): boolean {
  return origins.some((origin) => url === origin || url.startsWith(`${origin}/`))
}

function openExternalSafe(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

/**
 * 打开真实浏览器窗口完成登录。应用本身不接触账号密码；
 * Cookie 保存在该来源独立的 persist 分区，登录成功后窗口自动关闭。
 */
export async function loginFeed(
  source: FeedSourceId,
  parent?: BrowserWindow,
): Promise<FeedAuthStatus> {
  const config = AUTH_SOURCES[source]
  if (!config) return { authenticated: false }

  const existingPromise = loginPromises.get(source)
  if (existingPromise) {
    loginWindows.get(source)?.focus()
    return existingPromise
  }

  const partition = feedAuthPartition(source)
  const win = new BrowserWindow({
    width: 1080,
    height: 820,
    parent,
    modal: false,
    show: true,
    title: `登录 ${config.label}`,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  win.removeMenu()
  win.center()
  win.webContents.setUserAgent(FEED_BROWSER_UA)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedOrigin(url, config.origins)) {
      openExternalSafe(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          partition,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      },
    }
  })

  const guardNavigation = (event: Electron.Event, url: string) => {
    if (isAllowedOrigin(url, config.origins)) return
    event.preventDefault()
    openExternalSafe(url)
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)

  let timer: ReturnType<typeof setInterval> | undefined
  let settled = false
  const promise = new Promise<FeedAuthStatus>((resolve) => {
    const finish = (status: FeedAuthStatus) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      try {
        win.close()
      } catch {
        // 窗口可能已被用户关闭
      }
      resolve(status)
    }

    timer = setInterval(() => {
      void (async () => {
        if (win.isDestroyed()) {
          finish({ authenticated: false })
          return
        }
        const status = await getFeedAuthStatus(source)
        if (status.authenticated) finish(status)
      })()
    }, 1_500)

    win.on('closed', () => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      resolve({ authenticated: false })
    })
  })

  loginWindows.set(source, win)
  loginPromises.set(source, promise)
  void promise.finally(() => {
    loginWindows.delete(source)
    loginPromises.delete(source)
  })

  void win.loadURL(config.loginUrl).catch(() => {
    // 页面加载失败时保留窗口，让用户重试或自行关闭
  })

  return promise
}

export async function logoutFeed(source: FeedSourceId): Promise<void> {
  const config = AUTH_SOURCES[source]
  if (!config) return
  const ses = authSession(source)
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
  })
}
