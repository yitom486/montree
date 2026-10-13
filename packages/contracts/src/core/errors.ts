export type AppErrorCode =
  | 'CANCELLED'
  | 'API_UNAVAILABLE'
  | 'FILE_READ_ERROR'
  | 'FILE_WRITE_ERROR'
  | 'FILE_NOT_FOUND'
  | 'WORKSPACE_SCAN_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'ACP_SPAWN_ERROR'
  | 'ACP_PROTOCOL_ERROR'
  | 'ACP_NOT_CONNECTED'
  | 'ACP_TIMEOUT'
  | 'BUN_NOT_INSTALLED'
  | 'OCR_TOC_EMPTY'
  | 'OCR_PAGE_EMPTY'
  | 'OCR_FAILED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'SYNC_ERROR'
  | 'GIT_ERROR'
  | 'GIT_PUSH_FAILED'
  | 'GIT_COMMIT_FAILED'
  | 'GIT_ADD_FAILED'
  | 'WORKSPACE_ERROR'
  | 'PROTOCOL_ERROR'
  | 'VERSION_MISMATCH'
  | 'LIMIT_EXCEEDED'
  | 'CONNECTION_ERROR'
  | 'REVISION_CONFLICT'
  | 'NOT_SUPPORTED'
  | 'UNSUPPORTED_OPERATION'
  | 'REMOTE_NOT_CONNECTED'
  | 'REMOTE_CONNECTION_FAILED'
  | 'REMOTE_HANDSHAKE_FAILED'
  | 'REMOTE_VERSION_MISMATCH'
  | 'REMOTE_NODE_MISSING'
  | 'REMOTE_NODE_VERSION'
  | 'REMOTE_WINDOWS_NODE'
  | 'REMOTE_INSTALL_FAILED'
  | 'UNKNOWN'

export interface AppError {
  code: AppErrorCode
  message: string
}

export function isCancelled(error: AppError): boolean {
  return error.code === 'CANCELLED'
}

export function isAppError(value: unknown): value is AppError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    'message' in value &&
    typeof (value as AppError).message === 'string'
  )
}

export function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as AppError
  }

  const message = error instanceof Error ? error.message : fallbackMessage
  const code: AppErrorCode =
    error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? 'FILE_NOT_FOUND'
      : 'UNKNOWN'

  return { code, message }
}
