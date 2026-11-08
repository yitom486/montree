import { err } from '@yitom/contracts'
import type { AcpElicitationAPI } from '../../contracts/acp-elicitation'

export const acpElicitationApi: AcpElicitationAPI = {
  subscribe: callback => typeof window === 'undefined' ? () => {} : window.montreeAcpElicitation?.subscribe(callback) ?? (() => {}),
  respond: async reply => {
    if (typeof window === 'undefined' || !window.montreeAcpElicitation) return err({ code: 'API_UNAVAILABLE', message: '提问桥接未就绪，请完全重启应用' })
    try { return await window.montreeAcpElicitation.respond(reply) }
    catch { return err({ code: 'API_UNAVAILABLE', message: '答案未能发送，请重试' }) }
  },
}
