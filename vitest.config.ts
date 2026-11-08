import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 单测依赖 Node 内置能力（node:sqlite、Object.groupBy、Iterator、WebSocket、stripTypeScriptTypes），
// 低版本 Node 下约 29 个文件会以“原生模块”形式误报失败。直接给出可执行的提示。
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  throw new Error(`单测需要 Node >= 22.13（推荐 24，见 .node-version），当前为 ${process.versions.node}`)
}

export default defineConfig({
  resolve: {
    // 只为仍在本仓的 workspace 包配置源码别名；@yitom/* 使用已发布包的 exports。
    alias: [
      { find: '@', replacement: resolve('apps/desktop/src') },
      { find: '@foliate', replacement: resolve('third-party/foliate-js') },
      { find: '@montree/pdf', replacement: resolve('packages/pdf/src/index') },
      { find: '@montree/ocr-core', replacement: resolve('packages/ocr-core/src/index') },
      { find: '@montree/web-doc', replacement: resolve('packages/web-doc/src/index') },
      { find: '@montree/workspace-core', replacement: resolve('packages/workspace-core/src/index') },
      { find: '@montree/remote-server', replacement: resolve('packages/remote-server/src/index') },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/electron/**/*.test.ts',
      'scripts/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
  },
})
