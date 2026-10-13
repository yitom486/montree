/** 服务端日志：只走 stderr，只记录脱敏字段（见 workspace-core redact）。 */
import { redactWorkspaceLogFields } from "@montree/workspace-core";

export type RemoteServerLogLevel = "info" | "warn" | "error";

export function logRemoteServer(
  level: RemoteServerLogLevel,
  fields: Record<string, unknown>,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): void {
  const record = {
    scope: "remote-server",
    level,
    time: new Date().toISOString(),
    ...redactWorkspaceLogFields(fields),
  };
  try {
    write(JSON.stringify(record));
  } catch {
    // 日志永不干扰协议：stderr 写入失败直接丢弃
  }
}
