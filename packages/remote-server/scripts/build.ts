/**
 * 远端服务自包含构建：Bun 把 entry + workspace-core 打成单个 CJS，
 * 输出到桌面资源目录（随 electron-builder 分发），并写 manifest
 *（buildId=产物 sha256、协议版本、文件校验、Node 下限）。
 *
 * Run: bun run build:remote-server [--outDir <dir>]
 * 远端运行时不要求 Bun、不依赖桌面 node_modules。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { WORKSPACE_MIN_NODE_MAJOR, WORKSPACE_PROTOCOL_MAJOR, WORKSPACE_PROTOCOL_MINOR } from "@montree/contracts/types/workspace";

const root = resolve(import.meta.dir, "..", "..", "..");
const defaultOut = join(root, "apps", "desktop", "resources", "remote-server");
const outArg = process.argv.indexOf("--outDir");
const outDir = outArg >= 0 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1]!) : defaultOut;

const result = await Bun.build({
  entrypoints: [join(root, "packages", "remote-server", "src", "entry.ts")],
  outdir: outDir,
  target: "node",
  format: "cjs",
  naming: "montree-remote-server.cjs",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const bundlePath = join(outDir, "montree-remote-server.cjs");
const bytes = readFileSync(bundlePath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  name: "montree-remote-server",
  buildId: sha256.slice(0, 16),
  protocolMajor: WORKSPACE_PROTOCOL_MAJOR,
  protocolMinor: WORKSPACE_PROTOCOL_MINOR,
  nodeMin: `${WORKSPACE_MIN_NODE_MAJOR}.0.0`,
  entry: "montree-remote-server.cjs",
  files: [{ path: "montree-remote-server.cjs", sha256, size: statSync(bundlePath).size }],
};

mkdirSync(dirname(bundlePath), { recursive: true });
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`remote-server 构建完成：${bundlePath}（buildId=${manifest.buildId}）`);
