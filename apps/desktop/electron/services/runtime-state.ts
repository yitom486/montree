let verboseRendererLogs = false

export function setVerboseRendererLogs(enabled: boolean): void {
  verboseRendererLogs = enabled
}

export function shouldLogRendererConsole(level: number, message: string): boolean {
  if (
    message.includes('ResizeObserver loop completed') ||
    message.includes('ResizeObserver loop limit exceeded')
  ) {
    return false
  }
  const isErrorLike = level >= 3 || /error|exception|uncaught/i.test(message)
  return isErrorLike || verboseRendererLogs
}
