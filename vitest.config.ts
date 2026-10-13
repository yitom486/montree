import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 数组形式：contracts barrel 精确匹配 + 子路径（core/*、types/*）精确前缀，
    // 避免对象形式前缀改写把深路径拼到 src/index 后（远端 bundle 须直引子模块，
    // 不得经 barrel 拖入 ACP 常量等无关运行时）。
    alias: [
      { find: '@', replacement: resolve('apps/desktop/src') },
      { find: '@foliate', replacement: resolve('third-party/foliate-js') },
      { find: /^@montree\/contracts$/, replacement: resolve('packages/contracts/src/index') },
      { find: /^@montree\/contracts\/(.+)$/, replacement: resolve('packages/contracts/src/$1') },
      { find: '@montree/reader-core', replacement: resolve('packages/reader-core/src/index') },
      { find: '@montree/pdf', replacement: resolve('packages/pdf/src/index') },
      { find: '@montree/ocr-core', replacement: resolve('packages/ocr-core/src/index') },
      { find: '@montree/annotations', replacement: resolve('packages/annotations/src/index') },
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
