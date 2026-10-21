import { setProposalExtensionFactory, setProposalReviewModeSource } from '../text-document'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { proposalExtension } from './proposal-extension'

/** 渲染进程启动时注册：编辑器状态自动携带建议可视化；审阅模式读取应用设置。 */
setProposalExtensionFactory((document) => proposalExtension(document.proposals))
setProposalReviewModeSource(() => useAppSettingsStore.getState().aiEditReviewMode)
