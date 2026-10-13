/**
 * 工作区相对 POSIX 路径纯校验与归一化（无 fs 依赖，可进远端 bundle）。
 * 真实路径约束（symlink escape）由持 fs 的服务端做二次校验。
 */

/** 归一化相对路径：'' 表根；拒绝绝对路径、盘符、反斜杠、空段、NUL。 */
export function normalizeWorkspaceRelPath(
  input: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "路径不是字符串" };
  if (input.includes("\0")) return { ok: false, error: "路径含非法字符" };
  let rel = input.replace(/\\/g, "/").trim();
  if (rel === "" || rel === ".") return { ok: true, path: "" };
  rel = rel.replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (rel === "" || rel === ".") return { ok: true, path: "" };
  if (rel.startsWith("/") || /^[A-Za-z]:(\/|$)/.test(rel)) {
    return { ok: false, error: "只允许工作区相对路径" };
  }
  const parts = rel.split("/");
  for (const part of parts) {
    if (part === "" || part === ".") return { ok: false, error: "路径含空段" };
    if (part === "..") return { ok: false, error: "路径穿越工作区根" };
  }
  if (rel.length > 4096) return { ok: false, error: "路径过长" };
  return { ok: true, path: rel };
}

/** 拼接展示用 POSIX 子路径（纯字符串，不触 fs）。 */
export function joinWorkspaceRelPath(base: string, name: string): string {
  if (!base) return name;
  return `${base}/${name}`;
}
