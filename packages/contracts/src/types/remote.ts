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
