import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REACT_ARTIFACT_MOUNT_TOKEN } from '@yitom/contracts'

const SOURCE_LIMIT = 96 * 1024
let runtimePromise: Promise<string> | undefined

/** 仅转换源码，绝不在主进程执行。运行时所有 require 仅能获得预置浏览器库。 */
export async function transpileReactArtifact(source: unknown): Promise<string> {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > SOURCE_LIMIT) throw new Error('React 源码须为非空文本且不超过 96KiB')
  // 独立懒块避免编译器示例注释被 electron-vite 误认作主入口 ESM import。
  const { transform } = await import('sucrase')
  const { code } = transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: 'Artifact.tsx' })
  for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (!['react', 'react/jsx-runtime', 'react-dom/client'].includes(match[1]!)) throw new Error(`不支持依赖 ${match[1]}，仅可导入 react、react/jsx-runtime、react-dom/client`)
  }
  return code
}

export async function compileReactArtifact(payload: unknown): Promise<string> {
  if (!payload || typeof payload !== 'object') throw new Error('React 编译参数非法')
  const { source, css } = payload as { source?: unknown; css?: unknown }
  const compiled = await transpileReactArtifact(source)
  if (css !== undefined && (typeof css !== 'string' || Buffer.byteLength(css) > 16 * 1024)) throw new Error('CSS 须为不超过 16KiB 的文本')
  runtimePromise ??= readFile(join(__dirname, 'react-artifact-runtime.js'), 'utf8')
  const runtime = await runtimePromise.catch(error => { runtimePromise = undefined; throw error })
  return buildReactWrapper({ runtime, compiled, css: typeof css === 'string' ? css : '' })
}

/** 纯包装层（可单测）：运行库 + 编译产物 + 渲染确认信号组装为单文档内联脚本体 */
export function buildReactWrapper(parts: { runtime: string; compiled: string; css: string }): string {
  const { runtime, compiled, css } = parts
  const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script')
  const styles = typeof css === 'string' ? css.replace(/<\/style/gi, '<\\/style') : ''
  // 渲染确认：首次 commit 后（双 rAF 近似绘制完成）上报带挂载 ID 的 react-ready；
  // 宿主只认同 mountId 的确认，未替换占位（离线导出文件）的确认无监听者、无害。
  // 同步抛错走 catch → 文本 + rethrow → 宿主桥接 artifact-error；异步交互错误同理。
  const readySignal = `requestAnimationFrame(function(){requestAnimationFrame(function(){try{parent.postMessage({mountId:"${REACT_ARTIFACT_MOUNT_TOKEN}",type:"artifact-react-ready",value:1},"*")}catch(e){}})});`
  return `<html><head><style>body{margin:0;padding:16px;font:14px system-ui;color:#222;background:#fff}button,input,select{font:inherit}*{box-sizing:border-box}${styles}</style></head><body><div id="root"></div><script>${escapeScript(runtime)}</script><script>(function(){try{var modules=globalThis.__artifactModules;if(!globalThis.montreeArtifact)globalThis.montreeArtifact=Object.freeze({requestAnalysis:function(){return false}});var module={exports:{}};function require(name){if(!Object.hasOwn(modules,name))throw new Error("不支持依赖 "+name);return modules[name]}(function(require,module,exports){${escapeScript(compiled)}\n})(require,module,module.exports);var App=module.exports.default;if(typeof App!=="function")throw new Error("请 export default 一个 React 函数组件");function reportError(error){parent.postMessage({mountId:"${REACT_ARTIFACT_MOUNT_TOKEN}",type:"artifact-error",value:String(error&&error.message||error).slice(0,200)},"*")}function MountedApp(){modules.react.useEffect(function(){${readySignal}},[]);return modules.react.createElement(App)}modules["react-dom/client"].createRoot(document.getElementById("root"),{onUncaughtError:reportError}).render(modules.react.createElement(MountedApp));}catch(error){document.getElementById("root").textContent="运行失败："+error.message;throw error}})();</script></body></html>`
}
