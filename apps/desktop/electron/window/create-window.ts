import { BrowserWindow, app, dialog, nativeImage, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'path'
import { IPC } from '@yitom/contracts'
import { APP_TITLE } from '@yitom/contracts'
import { resolveAppIconPath } from '../services/app-paths'
import { shouldLogRendererConsole } from '../services/runtime-state'
import { createWindowCloseController } from './window-close'
import { createArtifactFrameGuard } from './artifact-navigation-guard'
import { resolveWindowShortcut } from './window-shortcuts'
import { withAcpWindow } from '../ipc/acp-window-handlers'
import {
  getWindowSessionByWebContents,
  registerWindowSession,
  unregisterWindowSession,
  type WindowSession,
} from './window-session'

function createWindowCloseHandlers(session: WindowSession) {
  return createWindowCloseController({
    getMainWindow: () => (session.window.isDestroyed() ? null : session.window),
    getAllowClose: () => session.allowClose,
    setAllowClose: (value) => {
      session.allowClose = value
    },
    getDocumentDirty: () => session.documentDirty,
    getRendererHealth: () => session.rendererHealth,
    onRequestRendererClose: (win) => {
      win.webContents.send(IPC.APP_REQUEST_CLOSE)
    },
  })
}

function watchDevAppIcon(window: BrowserWindow, iconPath: string | undefined): () => void {
  if (app.isPackaged || !iconPath) return () => undefined

  let watcher: FSWatcher | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const iconFileName = basename(iconPath).toLowerCase()

  const refreshIcon = () => {
    refreshTimer = undefined
    if (window.isDestroyed()) return

    const nextIcon = nativeImage.createFromPath(iconPath)
    if (nextIcon.isEmpty()) {
      console.warn('[window-icon] 图标文件尚未准备好，跳过本次热更新', iconPath)
      return
    }

    window.setIcon(nextIcon)
    console.info('[window-icon] 开发态图标已热更新', iconPath)
  }

  try {
    watcher = watch(dirname(iconPath), { persistent: false }, (_eventType, fileName) => {
      const changedFileName = fileName?.toString().toLowerCase()
      if (changedFileName && changedFileName !== iconFileName) return

      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refreshIcon, 180)
    })
  } catch (error) {
    console.warn('[window-icon] 无法监听开发态图标', iconPath, error)
  }

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    watcher?.close()
  }
}

export function createWindow(options: { fresh?: boolean } = {}): void {
  const iconPath = resolveAppIconPath()
  const windowIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    title: APP_TITLE,
    icon: windowIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  withAcpWindow(window.webContents, () => undefined)
  const session: WindowSession = {
    window,
    allowClose: false,
    documentDirty: false,
    rendererHealth: 'ok',
    closeController: null as unknown as WindowSession['closeController'],
    isFresh: options.fresh ?? false,
    windowScopeId: options.fresh ? randomUUID() : 'main',
  }
  session.closeController = createWindowCloseHandlers(session)
  registerWindowSession(session)
  const disposeDevIconWatcher = watchDevAppIcon(window, iconPath)

  window.on('maximize', () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.APP_WINDOW_MAXIMIZE_CHANGED, true)
    }
  })

  window.on('unmaximize', () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.APP_WINDOW_MAXIMIZE_CHANGED, false)
    }
  })

  window.on('ready-to-show', () => {
    // 保留 Application Menu 的 editMenu 角色（Ctrl+C/V）；仅隐藏菜单栏
    window.setMenuBarVisibility(false)
    window.show()
    if (options.fresh) {
      window.focus()
    }
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', details.reason, details.exitCode)
    session.rendererHealth = 'crashed'
    session.closeController.clearPendingCloseTimeout()

    if (window.isDestroyed()) return

    void dialog
      .showMessageBox(window, {
        type: 'error',
        title: '界面进程异常',
        message: '编辑器渲染进程已崩溃或异常退出',
        detail: `原因：${details.reason}（exitCode ${details.exitCode}）\n\n可尝试重新加载；若反复出现，请用 Ctrl+Shift+I 查看 Console，或在 帮助 → 错误日志 中查看记录。`,
        buttons: ['重新加载', '关闭窗口'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (window.isDestroyed()) return
        if (response === 0) {
          session.rendererHealth = 'ok'
          window.reload()
          return
        }
        session.closeController.forceCloseWindow(window)
      })
  })

  window.webContents.on('did-finish-load', () => {
    session.rendererHealth = 'ok'
  })

  window.webContents.on('responsive', () => {
    session.rendererHealth = 'ok'
    console.info('[renderer-responsive] 渲染进程已恢复响应')
  })

  window.webContents.on('unresponsive', () => {
    session.rendererHealth = 'unresponsive'
    console.error('[renderer-unresponsive] 渲染进程无响应，可能正在处理大文件或发生死循环')
  })

  window.webContents.on('before-input-event', (event, input) => {
    const action = resolveWindowShortcut(input)
    if (!action) return
    event.preventDefault()
    if (input.isAutoRepeat) return
    if (action === 'devtools') {
      window.webContents.toggleDevTools()
    } else if (action === 'new-window') {
      createWindow({ fresh: true })
    } else {
      window.webContents.send(IPC.APP_GLOBAL_ACTION, action)
    }
  })

  window.on('close', (event) => {
    session.closeController.handleWindowClose(event)
  })

  window.on('closed', () => {
    disposeDevIconWatcher()
    session.closeController.clearPendingCloseTimeout()
    unregisterWindowSession(window)
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error)
  })

  // 导航兜底：渲染器内非应用 origin 的跳转一律转系统浏览器，禁止远端内容
  // 占用应用窗口（preload 桥接只应服务本地 file:// 页面）。window.open 同理。
  const isAppNavigation = (target: string): boolean => {
    if (target.startsWith('file://') || target.startsWith('devtools://')) return true
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && target.startsWith(new URL(devUrl).origin)) return true
    return false
  }
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url)) return
    event.preventDefault()
    void shell.openExternal(url).catch((cause) => {
      console.error('[open-external-failed]', url, cause)
    })
  })
  // Artifact 预览框自身导航拦截（P1）：不信任运行时可改的 frame.name，
  // 以 frame-created 时登记的不可变 frameTreeNodeId 判定归属（改名不解除限制）。
  // 除初始 about:srcdoc/about:blank 提交外一律阻止（脚本/链接/meta refresh 自导航）。
  // will-navigate 不覆盖子 frame；主框架与阅读器子 frame 不受影响。
  // NOTE: 名称前缀（渲染端 name=`montree-artifact-*`）仅作登记时识别与极早期回退，
  // 拦截以登记身份为准，见 artifact-navigation-guard.ts。
  // 存活枚举用于已销毁帧清理（活帧永不淘汰）；枚举失败只增不减，不影响拦截。
  const artifactGuard = createArtifactFrameGuard({
    listLiveFrameTreeNodeIds: () => {
      try {
        return window.webContents.mainFrame.framesInSubtree.map((frame) => frame.frameTreeNodeId)
      } catch {
        return []
      }
    },
  })
  window.webContents.on('frame-created', (_event, { frame }) => {
    try {
      if (!frame) return
      artifactGuard.handleFrameCreated({
        name: frame.name ?? '',
        url: frame.url ?? '',
        frameTreeNodeId: frame.frameTreeNodeId,
        detached: frame.detached,
      })
    } catch {
      // 登记失败不阻断页面加载；拦截退化为名称回退（等价旧行为）
    }
  })
  window.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return
    const navigated = details.frame
    try {
      if (
        artifactGuard.shouldBlockSubframeNavigation(
          navigated
            ? {
                name: navigated.name ?? '',
                url: navigated.url ?? '',
                frameTreeNodeId: navigated.frameTreeNodeId,
                detached: navigated.detached,
              }
            : null,
          details.url,
        )
      ) {
        details.preventDefault()
      }
    } catch {
      // 判定异常时 fail-open，避免误伤阅读器正常导航
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppNavigation(url)) {
      void shell.openExternal(url).catch((cause) => {
        console.error('[open-external-failed]', url, cause)
      })
    }
    return { action: 'deny' }
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[did-fail-load]', errorCode, errorDescription, validatedURL)
  })

  window.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event
    if (shouldLogRendererConsole(level, message)) {
      console.error('[renderer]', message, `(${sourceId}:${lineNumber})`)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function getWindowInitByWebContents(sender: Electron.WebContents): {
  windowScopeId: string
  isFreshWindow: boolean
  e2eFoliateReader: boolean
  e2ePdfStructure: boolean
} {
  const session = getWindowSessionByWebContents(sender)
  return {
    windowScopeId: session?.windowScopeId ?? `window-${sender.id}`,
    isFreshWindow: session?.isFresh ?? false,
    e2eFoliateReader: process.env['E2E_FOLIATE_READER'] === '1',
    e2ePdfStructure: process.env['E2E_PDF_STRUCTURE'] === '1',
  }
}
