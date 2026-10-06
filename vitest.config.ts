import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('apps/desktop/src'),
      '@foliate': resolve('third-party/foliate-js'),
      '@montree/contracts': resolve('packages/contracts/src/index'),
      '@montree/reader-core': resolve('packages/reader-core/src/index'),
      '@montree/pdf': resolve('packages/pdf/src/index'),
      '@montree/ocr-core': resolve('packages/ocr-core/src/index'),
      '@montree/annotations': resolve('packages/annotations/src/index'),
      '@montree/web-doc': resolve('packages/web-doc/src/index'),
    },
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
