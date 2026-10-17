/**
 * 服务端根归属与真实路径约束：防穿越与 symlink escape。
 * 每请求必经 confine：纯校验（workspace-core）→ 拼绝对路径 →
 * 最近存在祖先 realpath 还原 → 必须落在 ROOT_REAL 内。
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { AppError } from "@yitom/contracts/core/errors";
import { normalizeWorkspaceRelPath } from "@montree/workspace-core";

export function resolveRootReal(root: string): string {
  return realpathSync(root);
}

/** 最近存在祖先的真实路径 + 词法余部（不存在路径也能判定归属）。 */
export function realpathForMaybeMissing(abs: string): string {
  try {
    return realpathSync(abs);
  } catch {
    let current = abs;
    const rest: string[] = [];
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) break;
      rest.unshift(current.slice(parent.length + sep.length));
      current = parent;
    }
    const realBase = realpathSync(current);
    return rest.length > 0 ? join(realBase, ...rest) : realBase;
  }
}

function insideRoot(rootReal: string, candidate: string): boolean {
  return candidate === rootReal || candidate.startsWith(rootReal + sep);
}

export type ConfineResult =
  | { ok: true; rel: string; abs: string }
  | { ok: false; error: AppError };

/** 将工作区相对路径约束到根内；失败返回 FORBIDDEN/INVALID_ARGUMENT。 */
export function confineWorkspacePath(rootReal: string, input: string): ConfineResult {
  const normalized = normalizeWorkspaceRelPath(input);
  if (!normalized.ok) {
    const code = normalized.error.includes("穿越") ? "FORBIDDEN" : "INVALID_ARGUMENT";
    return { ok: false, error: { code, message: `非法工作区路径：${normalized.error}` } };
  }
  const abs = join(rootReal, normalized.path);
  let real: string;
  try {
    real = realpathForMaybeMissing(abs);
  } catch {
    return { ok: false, error: { code: "FORBIDDEN", message: "路径归属校验失败" } };
  }
  if (!insideRoot(rootReal, real)) {
    return { ok: false, error: { code: "FORBIDDEN", message: "路径越出工作区根（含 symlink）" } };
  }
  return { ok: true, rel: normalized.path, abs };
}
