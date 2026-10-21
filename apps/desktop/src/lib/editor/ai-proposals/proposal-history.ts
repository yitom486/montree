import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'

/**
 * 接受建议与 CodeMirror 撤销历史的绑定：接受事务携带 accept 效果，
 * invertedEffects 让撤销产生 unaccept（建议回到待审），重做再产生 accept。
 */
export const proposalAcceptEffect = StateEffect.define<readonly string[]>()
export const proposalUnacceptEffect = StateEffect.define<readonly string[]>()

export interface ProposalHistoryEvent { seq: number; kind: 'accept' | 'unaccept'; ids: readonly string[] }
export interface ProposalHistoryLog { seq: number; events: readonly ProposalHistoryEvent[] }

const MAX_EVENTS = 32

/** 按序记录本状态链上出现过的接受/撤销接受事件，供 TextDocument 在 accept(state) 时消费。 */
export const proposalHistoryField = StateField.define<ProposalHistoryLog>({
  create: () => ({ seq: 0, events: [] }),
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      const kind: ProposalHistoryEvent['kind'] | null = effect.is(proposalAcceptEffect) ? 'accept' : effect.is(proposalUnacceptEffect) ? 'unaccept' : null
      if (!kind) continue
      const seq = next.seq + 1
      next = { seq, events: [...next.events, { seq, kind, ids: effect.value as readonly string[] }].slice(-MAX_EVENTS) }
    }
    return next
  },
})

export const proposalStateExtension: Extension = [
  proposalHistoryField,
  invertedEffects.of((tr) => {
    const inverted: StateEffect<unknown>[] = []
    for (const effect of tr.effects) {
      if (effect.is(proposalAcceptEffect)) inverted.push(proposalUnacceptEffect.of(effect.value))
      else if (effect.is(proposalUnacceptEffect)) inverted.push(proposalAcceptEffect.of(effect.value))
    }
    return inverted
  }),
]
