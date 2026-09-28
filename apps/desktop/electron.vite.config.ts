import { resolve } from 'path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { copyPdfjsAssetsPlugin } from './electron/vite-plugins/copy-pdfjs-assets'

const appDir = fileURLToPath(new URL('.', import.meta.url))

const foliateAlias = {
  '@foliate': resolve(appDir, '../../third-party/foliate-js'),
}

const workspaceAlias = {
  '@inkdown/contracts': resolve(appDir, '../../packages/contracts/src/index.ts'),
  '@inkdown/reader-core': resolve(appDir, '../../packages/reader-core/src/index.ts'),
  '@inkdown/pdf': resolve(appDir, '../../packages/pdf/src/index.ts'),
  '@inkdown/ocr-core': resolve(appDir, '../../packages/ocr-core/src/index.ts'),
  '@inkdown/acp': resolve(appDir, '../../packages/acp/src/index.ts'),
  '@yitom/acp-client': resolve(appDir, '../../packages/acp/src/index.ts'),
  '@inkdown/annotations': resolve(appDir, '../../packages/annotations/src/index.ts'),
  '@inkdown/web-doc': resolve(appDir, '../../packages/web-doc/src/index.ts'),
}

/** file:// 协议下 crossorigin 会导致 JS/CSS 静默加载失败（生产黑屏） */
function removeCrossOriginPlugin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { ...workspaceAlias },
    },
    build: {
      lib: {
        entry: resolve(appDir, 'electron/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { ...workspaceAlias },
    },
    build: {
      lib: {
        entry: resolve(appDir, 'electron/preload.ts'),
        // 沙盒渲染器只能加载 CJS preload（ESM import 会报 Cannot use import statement）
        formats: ['cjs'],
      },
      rollupOptions: {
        // 沙盒 preload 只能 require 沙盒暴露的模块：electron 与 node 内建保持外部，
        // 其余一律打进包（CJS 下 externalize 插件曾把 electron/index.js 内联进来，
        // 导致 child_process 在沙盒里炸掉）。
        external: ['electron', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
        output: {
          entryFileNames: 'preload.cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(appDir, 'src'),
    base: './',
    build: {
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: resolve(appDir, 'src/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(appDir, 'src'),
        ...foliateAlias,
        ...workspaceAlias,
      },
    },
    plugins: [react(), tailwindcss(), removeCrossOriginPlugin(), copyPdfjsAssetsPlugin()],
  },
})
