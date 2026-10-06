import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = path.join(__dirname, '../../../../out/main/main.js')

export async function launchBuiltApp(
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'montree-e2e-'))
  const electronTestArgs =
    process.platform === 'win32' ? ['--disable-gpu', '--in-process-gpu', '--no-sandbox'] : []
  const app = await electron.launch({
    // E2E exercises DOM/IPC behavior and must also run on Windows hosts without
    // a usable GPU/sandbox runtime; keep the test target deterministic there.
    args: [...electronTestArgs, MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      ...extraEnv,
    },
  })

  app.on('close', () => {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  })

  return app
}
