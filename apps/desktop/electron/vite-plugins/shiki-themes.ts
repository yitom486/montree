import type { Plugin } from 'vite'

/** Streamdown 只使用 GitHub 亮暗主题，构建时缩减 Shiki 的动态主题注册表。 */
export function shikiThemesPlugin(): Plugin {
  let trimmed = false
  return {
    name: 'shiki-themes',
    apply: 'build',
    buildStart() {
      trimmed = false
    },
    transform(_code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/shiki/dist/themes.mjs')) return null
      trimmed = true
      return {
        code: `
export const bundledThemesInfo = [
  { id: 'github-light', displayName: 'GitHub Light', type: 'light', import: () => import('@shikijs/themes/github-light') },
  { id: 'github-dark', displayName: 'GitHub Dark', type: 'dark', import: () => import('@shikijs/themes/github-dark') },
];
export const bundledThemes = Object.fromEntries(bundledThemesInfo.map(theme => [theme.id, theme.import]));
`,
        map: null,
      }
    },
    buildEnd(error) {
      // 上游改入口后显式失败，避免升级依赖悄悄恢复全部主题。
      if (!error && !trimmed) this.error('Shiki 主题入口未命中，请核对 shiki/dist/themes.mjs')
    },
  }
}
