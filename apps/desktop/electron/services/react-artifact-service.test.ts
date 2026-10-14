import { describe, expect, it } from 'vitest'
import { transpileReactArtifact } from './react-artifact-service'

describe('React artifact 离线编译', () => {
  it('转换 JSX/TSX，不执行源码，拒绝缺省依赖和越界输入', async () => {
    const importReact = ['import {useState}', 'from', JSON.stringify('react')].join(' ')
    const code = await transpileReactArtifact(`${importReact}; export default function App(){const [n,setN]=useState<number>(0);return <button onClick={()=>setN(n+1)}>{n}</button>}`)
    expect(code).toContain('react/jsx-runtime')
    expect(code).toContain('exports.default')
    expect(code).not.toContain('useState<number>')
    await expect(transpileReactArtifact('import x from "node:fs"; export default ()=>x')).rejects.toThrow(/不支持依赖/)
    await expect(transpileReactArtifact('export default function(')).rejects.toThrow()
    await expect(transpileReactArtifact('x'.repeat(96 * 1024 + 1))).rejects.toThrow(/96KiB/)
    await expect(transpileReactArtifact('throw new Error("不能在宿主执行"); export default ()=>null')).resolves.toBeTruthy()
  })
})
