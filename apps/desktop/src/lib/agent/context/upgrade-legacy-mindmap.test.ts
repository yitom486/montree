import { describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { upgradeLegacyMindmapHtml } from './upgrade-legacy-mindmap'

describe('upgradeLegacyMindmapHtml', () => {
  const legacyHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--paper:#fafaf9;--ink:#292524;--line:#78716c;--accent:#39715b}
  .node rect{fill:var(--paper);stroke:var(--line)}
  </style></head><body>
  <div id="viewport"><svg viewBox="0 0 800 600">
    <path d="M 240,64 C 332,64 332,192 424,192" class="edge"/>
    <path d="M 240,64 C 332,64 332,320 424,320" class="edge"/>
    <g class="node" data-node="root" tabindex="0" role="button" aria-label="根主题"><rect x="48" y="24" width="192" height="80" rx="6"/><text>根主题</text></g>
    <g class="node" data-node="m1" tabindex="0" role="button" aria-label="分支一"><rect x="424" y="152" width="192" height="80" rx="6"/><text>分支一</text></g>
    <g class="node" data-node="m2" tabindex="0" role="button" aria-label="分支二"><rect x="424" y="280" width="192" height="80" rx="6"/><text>分支二</text></g>
  </svg></div>
  <div id="details">点击节点查看详情</div>
  <script>(function(){
    const details={"root":"根","m1":"一","m2":"二"};
    function select(node){}
    window.addEventListener('message', e=>{});
  })();</script></body></html>`

  it('detects and injects toggle buttons and edge attributes for legacy mindmaps', () => {
    const upgraded = upgradeLegacyMindmapHtml(legacyHtml)

    // Contains .mindmap-toggle on root (which is parent of m1 and m2)
    expect(upgraded).toContain('class="mindmap-toggle" data-toggle="root"')
    // Does NOT contain toggle on m1 or m2 (leaves)
    expect(upgraded).not.toContain('data-toggle="m1"')
    expect(upgraded).not.toContain('data-toggle="m2"')

    // Edges have data-from and data-to
    expect(upgraded).toContain('data-from="root" data-to="m1"')
    expect(upgraded).toContain('data-from="root" data-to="m2"')

    // Works when executed in DOM
    const window = new Window({ url: 'http://localhost' })
    window.document.write(upgraded)
    const script = window.document.querySelector('script')
    expect(script).toBeTruthy()
    new Function('window', 'document', script!.textContent!)(window, window.document)

    const rootToggle = window.document.querySelector('.mindmap-toggle[data-toggle="root"]') as unknown as HTMLElement
    expect(rootToggle).toBeTruthy()

    const m1Node = window.document.querySelector('.node[data-node="m1"]') as unknown as HTMLElement
    const m2Node = window.document.querySelector('.node[data-node="m2"]') as unknown as HTMLElement

    expect(m1Node.style.display).not.toBe('none')
    expect(m2Node.style.display).not.toBe('none')

    // Click toggle to collapse root
    rootToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect(m1Node.style.display).toBe('none')
    expect(m2Node.style.display).toBe('none')
  })

  it('leaves non-mindmap or already upgraded html untouched', () => {
    expect(upgradeLegacyMindmapHtml('')).toBe('')
    expect(upgradeLegacyMindmapHtml('<div>no edges</div>')).toBe('<div>no edges</div>')
    expect(upgradeLegacyMindmapHtml('<div class="mindmap-toggle">already</div>')).toBe('<div class="mindmap-toggle">already</div>')
  })
})
