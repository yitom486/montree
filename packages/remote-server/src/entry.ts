/**
 * montree-remote-server 独立入口（Node-only）。
 * 用法：node montree-remote-server.cjs --root <绝对路径> --session <id>
 *   [--generation <id>] [--build <buildId>]
 * stdin/stdout 只走协议帧；日志走 stderr；EOF/信号收尾退出。
 */
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { logRemoteServer } from "./logger";
import { createWorkspaceServer, serveWorkspaceStdio } from "./server";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(message: string): never {
  logRemoteServer("error", { code: "INVALID_ARGUMENT", state: "startup" });
  process.stderr.write(`montree-remote-server: ${message}\n`);
  process.exit(2);
}

const rootRaw = argValue("--root") ?? fail("缺少 --root <绝对路径>");
const session = argValue("--session") ?? fail("缺少 --session <id>");
const generation = argValue("--generation") ?? "gen-1";
const buildId = argValue("--build") ?? "dev";

const root = isAbsolute(rootRaw) ? rootRaw : resolve(process.cwd(), rootRaw);
try {
  if (!statSync(root).isDirectory()) fail(`根不是目录：${root}`);
} catch {
  fail(`根不存在：${root}`);
}

process.on("uncaughtException", (error) => {
  logRemoteServer("error", { code: "UNKNOWN", state: "uncaught" });
  process.stderr.write(`montree-remote-server 崩溃：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
process.on("unhandledRejection", () => {
  logRemoteServer("error", { code: "UNKNOWN", state: "unhandled-rejection" });
  process.exit(1);
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

const server = createWorkspaceServer({ root, session, generation, buildId });
logRemoteServer("info", {
  state: "started",
  build: buildId,
  protocol: `${server.handshake.protocolMajor}.${server.handshake.protocolMinor}`,
  platform: server.handshake.platform,
  arch: server.handshake.arch,
  nodeVersion: server.handshake.nodeVersion,
});
serveWorkspaceStdio(server, { root, session });
