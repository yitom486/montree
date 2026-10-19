import type { AppError, Result } from '@yitom/contracts'

/** App-specific IPC; kept separate from the published contracts package. */
export const TERMINAL_IPC = {
  profiles: 'terminal:profiles', list: 'terminal:list', create: 'terminal:create',
  write: 'terminal:write', resize: 'terminal:resize', read: 'terminal:read', close: 'terminal:close', event: 'terminal:event',
} as const
export interface TerminalProfile { id: string; label: string }
export interface TerminalInfo {
  id: string; title: string; cwd: string; profile: string; exitCode?: number
}
export interface TerminalCreate { profile?: string; cols?: number; rows?: number }
export interface TerminalOutput { output: string; cursor: number; truncated: boolean; exitCode?: number }
export type TerminalEvent =
  | { type: 'created'; terminal: TerminalInfo }
  | { type: 'data'; id: string; data: string; cursor: number }
  | { type: 'exit'; id: string; exitCode: number }
  | { type: 'closed'; id: string }
export interface TerminalAPI {
  profiles(): Promise<Result<TerminalProfile[], AppError>>
  list(): Promise<Result<TerminalInfo[], AppError>>
  create(payload: TerminalCreate): Promise<Result<TerminalInfo, AppError>>
  write(id: string, data: string): Promise<Result<void, AppError>>
  resize(id: string, cols: number, rows: number): Promise<Result<void, AppError>>
  read(id: string, cursor?: number): Promise<Result<TerminalOutput, AppError>>
  close(id: string): Promise<Result<void, AppError>>
  onEvent(callback: (event: TerminalEvent) => void): () => void
}
