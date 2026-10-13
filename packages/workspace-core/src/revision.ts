/**
 * 不透明 revision token：`size:mtimeMs:hash`。
 * hash 由持 fs 端计算（远端用 sha256 十六进制前缀）；比较只认全等，
 * 不把 mtime 当唯一强校验（见实施计划 §4.1）。
 */
export interface WorkspaceRevisionParts {
  size: number;
  mtimeMs: number;
  hash: string;
}

const REVISION_PATTERN = /^(\d+):(\d+):([0-9a-fA-F]+)$/;

export function formatWorkspaceRevision(parts: WorkspaceRevisionParts): string {
  return `${parts.size}:${parts.mtimeMs}:${parts.hash}`;
}

export function parseWorkspaceRevision(
  revision: string,
): { ok: true; parts: WorkspaceRevisionParts } | { ok: false } {
  if (typeof revision !== "string") return { ok: false };
  const match = REVISION_PATTERN.exec(revision);
  if (!match) return { ok: false };
  return {
    ok: true,
    parts: { size: Number(match[1]), mtimeMs: Number(match[2]), hash: match[3] ?? "" },
  };
}

/** 全等才算同一版本；格式非法一律视为不一致（宁可误报冲突，不盲覆盖）。 */
export function isSameWorkspaceRevision(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!REVISION_PATTERN.test(a) || !REVISION_PATTERN.test(b)) return false;
  return a === b;
}
