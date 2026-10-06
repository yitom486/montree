import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('apps/desktop/src'),
      '@foliate': resolve('third-party/foliate-js'),
      '@inkdown/contracts': resolve('packages/contracts/src/index'),
      '@inkdown/reader-core': resolve('packages/reader-core/src/index'),
      '@inkdown/pdf': resolve('packages/pdf/src/index'),
      '@inkdown/ocr-core': resolve('packages/ocr-core/src/index'),
      '@inkdown/annotations': resolve('packages/annotations/src/index'),
      '@inkdown/web-doc': resolve('packages/web-doc/src/index'),
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
