import { describe, expect, it } from 'vitest'
import {
  COMPONENT_UI_MAX_NODES,
  collectSelectIds,
  validateComponentProps,
  validateComponentUiSpec,
} from './component-ui'
import { parsePresentResult, presentResultId } from './present-result'

const chapters = [
  { key: 'c1', label: '第一章', flatIndex: 0 },
  { key: 'c2', label: '第二章', flatIndex: 1 },
]

const validUi = {
  root: {
    component: 'Column',
    children: [
      { component: 'Text', props: { text: '两章论证方式有何不同？', variant: 'title' } },
      {
        component: 'Select',
        props: {
          id: 'dim',
          label: '对比维度',
          options: [
            { value: 'method', label: '论证方法' },
            { value: 'evidence', label: '证据运用' },
          ],
        },
      },
      {
        component: 'Evidence',
        props: { excerpt: '甲论点原文', chapterKey: 'c1', chapterLabel: '第一章' },
      },
      { component: 'Button', props: { label: '继续分析', action: 'submit-selection' } },
    ],
  },
}

const base = {
  schemaVersion: 1,
  kind: 'component-ui',
  id: 'present-component-ui-abc123',
  title: '两章对比选择',
  documentFingerprint: '/books/a.epub',
  documentLabel: 'a.epub',
  chapters,
  ui: validUi,
}

describe('component-ui 协议', () => {
  it('拒绝未知属性、无效默认值与保留字段名', () => {
    expect(validateComponentProps('Text', { text: 'x', onClick: 'evil' })).not.toBeNull()
    expect(validateComponentProps('Select', { id: '__proto__', options: [{ value: 'a', label: 'A' }] })).not.toBeNull()
    expect(validateComponentProps('Select', { id: 'dim', options: [{ value: 'a', label: 'A' }], defaultValue: 'missing' })).not.toBeNull()
    expect(validateComponentProps('Select', { id: 'dim', options: [{ value: 'a', label: 'A' }], defaultValue: 'a' })).toBeNull()
  })
  it('合法树通过', () => {
    expect(validateComponentUiSpec(validUi)).toBeNull()
    const parsed = parsePresentResult(JSON.stringify(base))
    expect(parsed?.kind).toBe('component-ui')
  })

  it('未知组件/动作拒绝', () => {
    expect(validateComponentProps('Button', { label: 'x', action: 'exec' })).not.toBeNull()
    const badComponent = {
      root: { component: 'Map', props: {} },
    }
    expect(validateComponentUiSpec(badComponent)).not.toBeNull()
    expect(parsePresentResult({ ...base, ui: badComponent })).toBeNull()
    const badAction = {
      root: [
        {
          component: 'Select',
          props: { id: 's', options: [{ value: 'a', label: 'A' }] },
        },
        { component: 'Button', props: { label: 'x', action: 'delete-file' } },
      ],
    }
    expect(parsePresentResult({ ...base, ui: badAction })).toBeNull()
  })

  it('结构超限拒绝：深度/节点/单文本（缺 Select 由 builder 拒绝，parser 只验形状）', () => {
    let deep: unknown = { component: 'Text', props: { text: 'x' } }
    for (let i = 0; i < 14; i += 1) {
      deep = { component: 'Column', children: [deep] }
    }
    expect(validateComponentUiSpec({ root: deep })).not.toBeNull()
    const many = {
      root: {
        component: 'Column',
        children: Array.from({ length: COMPONENT_UI_MAX_NODES + 1 }, () => ({
          component: 'Text',
          props: { text: 'x' },
        })),
      },
    }
    expect(validateComponentUiSpec(many)).not.toBeNull()
    expect(
      validateComponentUiSpec({ root: { component: 'Text', props: { text: 'x'.repeat(4001) } } }),
    ).not.toBeNull()
    const noSelect = { root: { component: 'Text', props: { text: '纯展示' } } }
    expect(validateComponentUiSpec(noSelect)).toBeNull()
    expect(parsePresentResult({ ...base, ui: noSelect })).not.toBeNull()
  })

  it('Select.id 重复拒绝', () => {
    const dup = {
      root: [
        { component: 'Select', props: { id: 's', options: [{ value: 'a', label: 'A' }] } },
        { component: 'Select', props: { id: 's', options: [{ value: 'b', label: 'B' }] } },
      ],
    }
    expect(collectSelectIds((dup as { root: unknown }).root).error).toMatch(/重复/)
  })

  it('稳定 id：同一输入重放一致，旧 kind 仍兼容', () => {
    expect(presentResultId('component-ui', 'a')).toBe(presentResultId('component-ui', 'a'))
    expect(presentResultId('component-ui', 'a')).not.toBe(presentResultId('component-ui', 'b'))
    expect(
      parsePresentResult({
        schemaVersion: 1,
        kind: 'chapter-comparison',
        id: 'x',
        title: 't',
        documentFingerprint: '/a',
        chapters,
        items: [],
      })?.kind,
    ).toBe('chapter-comparison')
    expect(
      parsePresentResult({ schemaVersion: 1, kind: 'html-artifact', id: 'x', title: 't', html: '<p>hi</p>' })?.kind,
    ).toBe('html-artifact')
  })
})
