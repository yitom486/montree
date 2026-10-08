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
  '@montree/contracts': resolve(appDir, '../../packages/contracts/src/index.ts'),
  '@montree/reader-core': resolve(appDir, '../../packages/reader-core/src/index.ts'),
  '@montree/pdf': resolve(appDir, '../../packages/pdf/src/index.ts'),
  '@montree/ocr-core': resolve(appDir, '../../packages/ocr-core/src/index.ts'),
  '@montree/annotations': resolve(appDir, '../../packages/annotations/src/index.ts'),
  '@montree/web-doc': resolve(appDir, '../../packages/web-doc/src/index.ts'),
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

/** 修复 foliate-js paginator 在 iframe 尚未加载完成即触发 ResizeObserver 时读取 null.documentElement 报错 */
function foliatePaginatorGuardPlugin(): Plugin {
  return {
    name: 'foliate-paginator-guard',
    transform(code, id) {
      if (id.includes('paginator.js')) {
        return code
          .replace(
            /const setStylesImportant = \(el, styles\) => \{/,
            'const setStylesImportant = (el, styles) => {\n        if (!el?.style) return',
          )
          .replace(
            /render\(\)\s*\{([\s\S]*?)if \(!this\.#view\) return/,
            'render() {$1if (!this.#view || !this.#view.document?.documentElement) return',
          )
          .replace(
            /scrolled\(\{ gap, columnWidth \}\)\s*\{([\s\S]*?)const doc = this\.document/,
            'scrolled({ gap, columnWidth }) {$1const doc = this.document\n        if (!doc?.documentElement || !doc?.body) return',
          )
          .replace(
            /columnize\(\{ width, height, gap, columnWidth \}\)\s*\{([\s\S]*?)const doc = this\.document/,
            'columnize({ width, height, gap, columnWidth }) {$1const doc = this.document\n        if (!doc?.documentElement || !doc?.body) return',
          )
          .replace(
            /#observer = new ResizeObserver\(\(\) => this\.render\(\)\)/,
            '#observer = new ResizeObserver(() => requestAnimationFrame(() => this.render()))',
          )
      }
      return null
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
    plugins: [
      react(),
      tailwindcss(),
      removeCrossOriginPlugin(),
      foliatePaginatorGuardPlugin(),
      copyPdfjsAssetsPlugin(),
    ],
  },
})
