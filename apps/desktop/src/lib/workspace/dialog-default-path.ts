import { dirname } from '@montree/contracts'
import { useAppSettingsStore } from '@/stores/app-settings-store'

/** 打开文件/文件夹对话框的起始目录 */
export function getOpenDialogDefaultPath(): string | undefined {
  const { lastOpenedFolderPath, lastOpenedFilePath } = useAppSettingsStore.getState()

  if (lastOpenedFolderPath) return lastOpenedFolderPath
  if (lastOpenedFilePath) return dirname(lastOpenedFilePath)
  return undefined
}
