import type { SlideAnimation, SlideAnimationEffect, SlideTransition } from '@yitom/contracts'
import { P, P14, child, children, descendants, object, number, shapeTree, shapeId, insertOrdered } from './presentation-xml'

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const timingNames = ['timing', 'tnLst', 'par', 'seq', 'cTn', 'childTnLst', 'stCondLst', 'cond', 'cBhvr', 'tgtEl', 'spTgt', 'attrNameLst', 'attrName', 'animEffect', 'set', 'to', 'strVal', 'prevCondLst', 'nextCondLst', 'sldTgt']
const triggers = { clickEffect: 'onClick', withEffect: 'withPrevious', afterEffect: 'afterPrevious' } as const
export function readAnimation(doc: Document): SlideAnimation {
  const root = doc.documentElement; const transition = child(root, P, 'transition'); const unsupported: string[] = []
  const effect = transition && Array.from(transition.children).find((node) => ['fade', 'push'].includes(node.localName))
  if (descendants(doc, P, 'transition').length > (transition ? 1 : 0) || transition && (Array.from(transition.children).some((node) => node.namespaceURI !== P || !['fade', 'push'].includes(node.localName)) || Array.from(transition.attributes).some((attr) => !['advClick', 'advTm', 'spd'].includes(attr.name) && !(attr.namespaceURI === P14 && attr.localName === 'dur')) || effect && Array.from(effect.attributes).some((attr) => effect.localName !== 'push' || attr.name !== 'dir'))) unsupported.push('transition:复杂转场/音频/AlternateContent 暂不支持修改与播放')
  const timing = child(root, P, 'timing'); const effects: SlideAnimationEffect[] = []
  if (timing) {
    if (Array.from(timing.getElementsByTagName('*')).some((node) => node.namespaceURI !== P || !timingNames.includes(node.localName))) unsupported.push('effects:只支持整体元素的出现/淡入简单时间线')
    const times = descendants(timing, P, 'cTn')
    const timeAttributes = ['id', 'dur', 'restart', 'nodeType', 'fill', 'presetID', 'presetClass', 'presetSubtype']
    if (times.some((node) => !/^\d+$/.test(node.getAttribute('id') ?? '') || Array.from(node.attributes).some((attr) => !timeAttributes.includes(attr.name))) || new Set(times.map((node) => node.getAttribute('id'))).size !== times.length) unsupported.push('effects:重复时间节点或循环/速率等复杂时间属性，保留原时间线')
    if (times.some((node) => !node.hasAttribute('presetClass') && !['tmRoot', 'mainSeq'].includes(node.getAttribute('nodeType') ?? '') && children(child(node, P, 'stCondLst') ?? node, P, 'cond').some((cond) => !['0', 'indefinite'].includes(cond.getAttribute('delay') ?? '')))) unsupported.push('effects:额外时间组延迟暂不支持')
    if (descendants(timing, P, 'animEffect').some((node) => Array.from(node.attributes).some((attr) => !['transition', 'filter'].includes(attr.name))) || descendants(timing, P, 'cBhvr').some((node) => node.attributes.length > 0)) unsupported.push('effects:附加动画行为暂不支持')
    if (descendants(timing, P, 'cond').some((node) => {
      const parent = node.parentElement?.localName
      if (parent === 'prevCondLst' || parent === 'nextCondLst') return !['onPrev', 'onNext'].includes(node.getAttribute('evt') ?? '') || node.getAttribute('delay') !== '0'
      return node.children.length > 0 || Array.from(node.attributes).some((attr) => attr.name !== 'delay') || !node.parentElement || children(node.parentElement, P, 'cond').length !== 1
    })) unsupported.push('effects:交互触发条件暂不支持')
    const owners = descendants(timing, P, 'cTn').filter((node) => node.hasAttribute('presetClass'))
    let previousStart = 0; let previousDuration = 0
    for (const owner of owners) {
      const names = owner.getAttribute('nodeType') as keyof typeof triggers
      const behavior = descendants(owner, P, 'animEffect')[0] ?? descendants(owner, P, 'set')[0]
      const target = behavior && descendants(behavior, P, 'spTgt')[0]
      const duration = Number(behavior && descendants(behavior, P, 'cTn')[0]?.getAttribute('dur'))
      const start = Number(child(child(owner, P, 'stCondLst'), P, 'cond')?.getAttribute('delay') ?? 0)
      const validBehavior = behavior?.localName === 'animEffect' ? behavior.getAttribute('filter') === 'fade' && behavior.getAttribute('transition') === 'in' : behavior?.localName === 'set' && descendants(behavior, P, 'strVal')[0]?.getAttribute('val') === 'visible' && descendants(behavior, P, 'attrName')[0]?.textContent === 'style.visibility'
      if (owner.getAttribute('presetClass') !== 'entr' || !triggers[names] || !validBehavior || !target || target.children.length || !Number.isFinite(duration) || duration < 1 || duration > 60000 || !Number.isFinite(start) || start < 0) { unsupported.push('effects:复杂效果、触发器或段落动画暂不支持'); continue }
      if (names === 'clickEffect') { previousStart = 0; previousDuration = 0 }
      const delay = names === 'withEffect' ? start - previousStart : names === 'afterEffect' ? start - previousStart - previousDuration : start
      if (delay < 0) { unsupported.push('effects:时间线依赖关系暂不支持'); continue }
      effects.push({ id: owner.getAttribute('id') ?? '', elementId: target.getAttribute('spid') ?? '', effect: behavior!.localName === 'set' ? 'appear' : 'fade', trigger: triggers[names], durationMs: duration, delayMs: delay })
      previousStart = start; previousDuration = duration
    }
    if (!owners.length || descendants(timing, P, 'spTgt').length !== owners.length || new Set(effects.map((item) => item.id)).size !== effects.length || new Set(effects.map((item) => item.elementId)).size !== effects.length) unsupported.push('effects:存在未识别或重复的效果，保留原时间线')
    const knownIds = new Set(shapeTree(doc, true).map(shapeId))
    if (effects.some((item) => !knownIds.has(item.elementId))) unsupported.push('effects:动画引用了缺失的元素')
  }
  const transitionData: SlideTransition = { effect: effect?.localName === 'fade' ? 'fade' : effect?.localName === 'push' ? 'push' : 'none',
    durationMs: effect ? Number(transition?.getAttributeNS(P14, 'dur') || ({ fast: 500, med: 1000, slow: 2000 }[transition?.getAttribute('spd') as 'fast' | 'med' | 'slow'] ?? 500)) : 0,
    advanceOnClick: transition?.getAttribute('advClick') !== '0', ...(transition?.hasAttribute('advTm') ? { advanceAfterMs: Number(transition.getAttribute('advTm')) } : {}),
    ...(effect?.localName === 'push' ? { direction: ({ l: 'left', r: 'right', u: 'up', d: 'down' } as const)[effect.getAttribute('dir') as 'l' | 'r' | 'u' | 'd'] ?? 'left' } : {}) }
  if (!Number.isFinite(transitionData.durationMs) || transitionData.durationMs < 0 || transitionData.advanceAfterMs !== undefined && (!Number.isFinite(transitionData.advanceAfterMs) || transitionData.advanceAfterMs < 0)) unsupported.push('transition:时长无效')
  return { transition: transitionData, effects, editable: !unsupported.length, unsupported: [...new Set(unsupported)] }
}
export function validateTransition(value: unknown): SlideTransition {
  const patch = object(value, ['effect', 'direction', 'durationMs', 'advanceOnClick', 'advanceAfterMs'], ['effect', 'durationMs', 'advanceOnClick'])
  if (!['none', 'fade', 'push'].includes(String(patch.effect)) || typeof patch.advanceOnClick !== 'boolean') throw new Error('transition effect/advanceOnClick 无效')
  if (patch.direction !== undefined && (patch.effect !== 'push' || !['left', 'right', 'up', 'down'].includes(String(patch.direction)))) throw new Error('direction 仅用于 push 转场')
  if (patch.effect === 'none' && patch.durationMs !== 0) throw new Error('none 转场的 durationMs 必须为 0')
  number(patch.durationMs, patch.effect === 'none' ? 0 : 1, 10000)
  if (patch.advanceAfterMs !== undefined) number(patch.advanceAfterMs, 100, 3600000)
  return patch as unknown as SlideTransition
}
function validateEffects(doc: Document, value: unknown, before: SlideAnimation, ids: unknown): SlideAnimationEffect[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.length !== before.effects.length || ids.some((id, index) => id !== before.effects[index].id)) throw new Error('expectedEffectIds 必须与读取的动画 ID 和顺序完全一致')
  if (!Array.isArray(value) || value.length > 100) throw new Error('effects 最多100个效果，空数组用于删除全部基础效果')
  const elements = shapeTree(doc, true); const seen = new Set<string>(); const oldIds = new Set<string>()
  const result = value.map((value): SlideAnimationEffect => {
    const effect = object(value, ['id', 'elementId', 'effect', 'trigger', 'durationMs', 'delayMs'], ['elementId', 'effect', 'trigger', 'durationMs', 'delayMs'])
    if (effect.id !== undefined) { if (!before.effects.some((item) => item.id === effect.id) || oldIds.has(String(effect.id))) throw new Error('动画 ID 过期或重复'); oldIds.add(String(effect.id)) }
    const matches = elements.filter((node) => shapeId(node) === effect.elementId)
    if (matches.length !== 1 || seen.has(String(effect.elementId))) throw new Error('动画目标未唯一匹配；每个元素仅支持一个入场效果')
    if (!['appear', 'fade'].includes(String(effect.effect)) || !['onClick', 'withPrevious', 'afterPrevious'].includes(String(effect.trigger))) throw new Error('仅支持出现/淡入及基础触发方式')
    number(effect.durationMs, 1, 60000); number(effect.delayMs, 0, 60000); seen.add(String(effect.elementId))
    return effect as unknown as SlideAnimationEffect
  })
  const targets = elements.filter((node) => seen.has(shapeId(node)))
  if (targets.some((node) => targets.some((other) => node !== other && node.contains(other)))) throw new Error('组合及子元素的动画目标不能重叠')
  return result
}
export interface AnimationGroup { automatic: boolean; effects: Array<SlideAnimationEffect & { startMs: number }> }
export function animationGroups(effects: SlideAnimationEffect[]): AnimationGroup[] {
  const groups: AnimationGroup[] = []; let previousStart = 0; let previousDuration = 0
  for (const effect of effects) {
    if (!groups.length || effect.trigger === 'onClick') { groups.push({ automatic: effect.trigger !== 'onClick', effects: [] }); previousStart = 0; previousDuration = 0 }
    const startMs = effect.delayMs + (effect.trigger === 'withPrevious' ? previousStart : effect.trigger === 'afterPrevious' ? previousStart + previousDuration : 0)
    groups.at(-1)!.effects.push({ ...effect, startMs }); previousStart = startMs; previousDuration = effect.durationMs
  }
  return groups
}
export function editAnimation(doc: Document, input: unknown): void {
  const edit = object(input, ['slide', 'transition', 'effects', 'expectedEffectIds'], ['slide'])
  if (edit.transition === undefined && edit.effects === undefined || edit.effects === undefined && edit.expectedEffectIds !== undefined) throw new Error('需要 transition 或 effects，expectedEffectIds 仅用于 effects')
  const before = readAnimation(doc); const root = doc.documentElement
  if (edit.transition !== undefined) {
    if (before.unsupported.some((value) => value.startsWith('transition:'))) throw new Error('不支持覆盖原有复杂转场')
    const config = validateTransition(edit.transition)
    child(root, P, 'transition')?.remove()
    const transition = doc.createElementNS(P, 'p:transition'); transition.setAttribute('advClick', config.advanceOnClick ? '1' : '0')
    if (config.advanceAfterMs !== undefined) transition.setAttribute('advTm', String(Math.round(config.advanceAfterMs)))
    if (config.effect !== 'none') {
      root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:p14', P14); root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', MC)
      const ignored = new Set((root.getAttributeNS(MC, 'Ignorable') ?? '').split(/\s+/).filter(Boolean)); ignored.add('p14'); root.setAttributeNS(MC, 'mc:Ignorable', [...ignored].join(' '))
      transition.setAttributeNS(P14, 'p14:dur', String(Math.round(config.durationMs))); transition.setAttribute('spd', config.durationMs <= 500 ? 'fast' : config.durationMs <= 1000 ? 'med' : 'slow')
      const effect = doc.createElementNS(P, `p:${config.effect}`)
      if (config.effect === 'push') effect.setAttribute('dir', { left: 'l', right: 'r', up: 'u', down: 'd' }[config.direction ?? 'left'])
      transition.append(effect)
    }
    insertOrdered(root, transition, ['cSld', 'clrMapOvr', 'transition', 'timing', 'extLst'])
  }
  if (edit.effects !== undefined) {
    if (before.unsupported.some((value) => value.startsWith('effects:'))) throw new Error('不支持覆盖原有复杂动画时间线')
    const effects = validateEffects(doc, edit.effects, before, edit.expectedEffectIds)
    child(root, P, 'timing')?.remove()
    if (!effects.length) return
    let nextId = 1
    const node = (name: string, attrs: Record<string, string> = {}, kids: Element[] = []): Element => { const value = doc.createElementNS(P, `p:${name}`); for (const [key, attr] of Object.entries(attrs)) value.setAttribute(key, attr); value.append(...kids); return value }
    const time = (attrs: Record<string, string>, kids: Element[]): Element => node('cTn', { id: String(nextId++), ...attrs }, kids)
    const rootTime = time({ dur: 'indefinite', restart: 'never', nodeType: 'tmRoot' }, [])
    const sequenceTime = time({ dur: 'indefinite', nodeType: 'mainSeq' }, [])
    const groups = animationGroups(effects).map((group) => {
      const groupTime = time({ fill: 'hold' }, [node('stCondLst', {}, [node('cond', { delay: group.automatic ? '0' : 'indefinite' })])])
      const animations = group.effects.map((effect) => {
        const effectTime = time({ presetID: effect.effect === 'fade' ? '10' : '1', presetClass: 'entr', presetSubtype: '0', fill: 'hold', nodeType: effect.trigger === 'onClick' ? 'clickEffect' : effect.trigger === 'withPrevious' ? 'withEffect' : 'afterEffect' }, [node('stCondLst', {}, [node('cond', { delay: String(Math.round(effect.startMs)) })])])
        const behavior = node('cBhvr', {}, [time({ dur: String(Math.round(effect.durationMs)), fill: 'hold' }, []), node('tgtEl', {}, [node('spTgt', { spid: effect.elementId })])])
        let animation: Element
        if (effect.effect === 'fade') animation = node('animEffect', { transition: 'in', filter: 'fade' }, [behavior])
        else { const name = node('attrName'); name.textContent = 'style.visibility'; behavior.append(node('attrNameLst', {}, [name])); animation = node('set', {}, [behavior, node('to', {}, [node('strVal', { val: 'visible' })])]) }
        effectTime.append(node('childTnLst', {}, [animation])); return node('par', {}, [effectTime])
      })
      groupTime.append(node('childTnLst', {}, animations)); return node('par', {}, [groupTime])
    })
    sequenceTime.append(node('childTnLst', {}, groups))
    const sequence = node('seq', { concurrent: '1', nextAc: 'seek' }, [sequenceTime,
      node('prevCondLst', {}, [node('cond', { evt: 'onPrev', delay: '0' }, [node('tgtEl', {}, [node('sldTgt')])])]),
      node('nextCondLst', {}, [node('cond', { evt: 'onNext', delay: '0' }, [node('tgtEl', {}, [node('sldTgt')])])])])
    rootTime.append(node('childTnLst', {}, [sequence]))
    const timing = node('timing', {}, [node('tnLst', {}, [node('par', {}, [rootTime])])])
    insertOrdered(root, timing, ['cSld', 'clrMapOvr', 'transition', 'timing', 'extLst'])
  }
}
