// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@yitom/contracts'
import {
  clearWebDocAgentTextCache,
  fetchWebDocPlainText,
  primeWebDocAgentTextCache,
  readWebDocUnitByIndex,
} from './web-doc-agent-content'

vi.mock('@/api/web-doc-api', () => ({
  webDocApi: {
    fetchPage: vi.fn(),
  },
}))

import { webDocApi } from '@/api/web-doc-api'

describe('web-doc-agent-content', () => {
  afterEach(() => {
    clearWebDocAgentTextCache()
    vi.clearAllMocks()
  })

  it('抓取并缓存页面纯文本', async () => {
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({
      ok: true,
      value: {
        url: 'https://react.dev/learn',
        html: '<!DOCTYPE html><html><body><article><h1>Quick Start</h1><p>Hello</p></article></body></html>',
      },
    })

    const first = await fetchWebDocPlainText('https://react.dev/learn')
    const second = await fetchWebDocPlainText('https://react.dev/learn/')
    expect(first).toContain('Hello')
    expect(second).toBe(first)
    expect(webDocApi.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('prime 缓存可避免重复抓取', async () => {
    primeWebDocAgentTextCache('https://react.dev/learn', 'Cached body')
    const text = await fetchWebDocPlainText('https://react.dev/learn')
    expect(text).toBe('Cached body')
    expect(webDocApi.fetchPage).not.toHaveBeenCalled()
  })

  it('按 flatIndex 读取目录页', async () => {
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({
      ok: true,
      value: {
        url: 'https://react.dev/learn/installation',
        html: '<!DOCTYPE html><html><body><article><p>Install guide</p></article></body></html>',
      },
    })

    const unit = await readWebDocUnitByIndex(
      [{ label: 'Installation', href: 'https://react.dev/learn/installation', level: 0 }],
      0,
    )
    expect(unit.label).toBe('Installation')
    expect(unit.text).toContain('Install guide')
    expect(isOk({ ok: true, value: unit })).toBe(true)
  })


  it('跨页读取失败返回 URL 和原因，绝不把引导提示作为正文', async () => {
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({ok:false,error:{code:'NETWORK_ERROR',message:'403 Forbidden'}})
    const pending=readWebDocUnitByIndex([{label:'Clients',href:'https://example.com/docs/clients',level:0}],0)
    await expect(pending).rejects.toThrow(/Clients.*index=0.*https:\/\/example.com\/docs\/clients.*403 Forbidden/)
  })

  it('页内锚点只返回对应小节并包含下级标题，不混入下一节',async()=>{
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({ok:true,value:{url:'https://example.com/docs',html:
      '<article><h1>Guide</h1><h2 id="clients">Clients</h2><p>Client source</p><h3>Details</h3><p>Nested detail</p><h2 id="agents">Agents</h2><p>Other source</p></article>'}})
    const result=await readWebDocUnitByIndex([{label:'Clients',href:'https://example.com/docs#clients',level:0}],0)
    expect(result.text).toContain('Client source')
    expect(result.text).toContain('Nested detail')
    expect(result.text).not.toContain('Other source')
    expect(result.href).toBe('https://example.com/docs#clients')
    await expect(readWebDocUnitByIndex([{label:'Missing',href:'https://example.com/docs#missing',level:0}],0)).rejects.toThrow('找不到目录锚点')
    expect(webDocApi.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('统一目录→索引/标题读取→比较卡链路，跨文章不切换当前页',async()=>{
    const {registerReaderContent}=await import('@/lib/agent/context/reader-content-registry')
    const {resolveMontreeSnapshot}=await import('@/lib/agent/context/virtual-fs-resolver')
    const {readChapterByRef}=await import('@/lib/agent/context/read-chapter-by-ref')
    const {buildPresentResult}=await import('@/lib/agent/context/present-result-builder')
    const {useActiveDocumentStore}=await import('@/stores/active-document-store')
    const {collectActiveDocument}=await import('@/lib/agent/context/collect-turn-context')
    const page='https://example.com/docs/current'
    const before=useActiveDocumentStore.getState().filePath
    useActiveDocumentStore.setState({filePath:page})
    const units=[{label:'Clients',href:'https://example.com/docs/clients',level:0},{label:'Agents',href:'https://example.com/docs/agents',level:0}]
    vi.mocked(webDocApi.fetchPage).mockImplementation(async ({url})=>({ok:true,value:{url,html:'<article><p>'+ (url.endsWith('clients')?'Client original passage':'Agent original passage')+'</p></article>'}}))
    const dispose=registerReaderContent({filePath:collectActiveDocument()!.path,getUnits:()=>units,getCurrentUnitIndex:()=>0,
      getCurrentText:()=> 'Current page text',getUnitByIndex:i=>readWebDocUnitByIndex(units,i)})
    try {
      const toc=JSON.parse(await resolveMontreeSnapshot('toc.json'))
      expect(toc.entries[1]).toMatchObject({index:1,label:'Agents',href:units[1]!.href})
      expect(toc.currentIndex).toBe(0)
      const byIndex=await readChapterByRef({flatIndex:1})
      const byTitle=await readChapterByRef({title:'Agents'})
      expect(byIndex.text).toContain('Agent original passage')
      expect(byTitle.href).toBe(units[1]!.href)
      const card=JSON.parse(await buildPresentResult({kind:'chapter-comparison',title:'Clients vs Agents',chapters:[{key:'c',label:'Clients',flatIndex:0},{key:'a',label:'Agents',flatIndex:1}],items:[{dimension:'Role',chapterKey:'a',excerpt:'Agent original passage',note:'Agent role'}]}))
      expect(card.kind).toBe('chapter-comparison')
      expect(useActiveDocumentStore.getState().filePath).toBe(page)
      expect(webDocApi.fetchPage).toHaveBeenCalledTimes(2)
      clearWebDocAgentTextCache()
      vi.mocked(webDocApi.fetchPage).mockResolvedValue({ok:false,error:{code:'NETWORK_ERROR',message:'403 Forbidden'}})
      await expect(buildPresentResult({kind:'chapter-comparison',title:'Unavailable',chapters:[{key:'c',label:'Clients',flatIndex:0},{key:'a',label:'Agents',flatIndex:1}],items:[]})).rejects.toThrow('403 Forbidden')
    } finally {dispose();useActiveDocumentStore.setState({filePath:before})}
  }, 15_000)
})
