import type { OpenFolderResult } from './file'
import type { WorkspaceDescriptor } from './workspace'
import type { WindowWorkspaceStatus } from './workspace-identity'

export interface WslDistroInfo {
  name: string
  isDefault: boolean
}
export interface RemoteDirectoryEntry {
  name: string
  isDirectory: boolean
  size?: number
  mtimeMs?: number
}

export interface RemoteBrowseResult {
  distro: string
  currentPath: string
  parentPath: string | null
  entries: RemoteDirectoryEntry[]
}

export interface SshConfigHost {
  host: string
  hostname?: string
  user?: string
  port?: number
}

/* ================================================================
 * B1 WSL 远端浏览 UI 层形状（传输协议与握手类型见 workspace.ts 的
 * 正统 A2 定义：WORKSPACE_PROTOCOL_*、WorkspaceServerHandshake、
 * WorkspaceServerManifest、RemoteServerConnectPayload 等，本文件不重复）。
 * Remote 模式浏览/stat 在 Ubuntu 服务执行，不走 Windows UNC。
 * ================================================================ */

/** WSL 连接请求（发行版 + root 选择复用 listWslDistros/getWslHome） */
export interface RemoteWslConnectPayload {
  distro: string
  /** 省略时取该发行版远端 $HOME（动态探测，不写死路径） */
  linuxRoot?: string
}

export interface RemoteWslBrowsePayload {
  /** 省略时浏览连接根 */
  dirPath?: string
}

export interface RemoteWslStatPayload {
  filePath: string
}

/* ================================================================
 * P1 生产打开远端工作区（连接选中根 → 注册远端宿主 → 绑定窗口）：
 * modal 确认目录后经此一次完成接线，不再只验证后关闭。
 * ================================================================ */

/** 打开远端工作区请求（发行版 + Ubuntu 内绝对根；连接归属调用窗口） */
export interface RemoteOpenWslWorkspacePayload {
  distro: string
  linuxPath: string
}

/** 打开远端工作区结果（描述符/代际/状态 + 远端初始文件树） */
export interface RemoteOpenWslWorkspaceResult {
  descriptor: WorkspaceDescriptor
  generation: number
  status: WindowWorkspaceStatus
  folder: OpenFolderResult
}
