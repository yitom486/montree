import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Persistent user-owned resources; separate from readonly packaged templates. */
export function montreeAgentResourceDir(homeDirectory = homedir()): string {
  return join(homeDirectory, '.montree')
}

/** Fill missing defaults only. Existing files, including empty files, always win. */
export async function initializeAgentResources(templateDir: string, homeDirectory = homedir()): Promise<string> {
  const directory = montreeAgentResourceDir(homeDirectory)
  await mkdir(directory, { recursive: true })

  const copyMissing = async (source: string, target: string): Promise<void> => {
    let existing
    try { existing = await lstat(target) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    // Do not provision through user symlinks or overwrite existing files.
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) return
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) throw new Error('Agent resource templates must not contain symlinks')
    if (stat.isDirectory()) {
      await mkdir(target, { recursive: true })
      for (const entry of await readdir(source)) await copyMissing(join(source, entry), join(target, entry))
    } else if (stat.isFile()) {
      try { await copyFile(source, target, constants.COPYFILE_EXCL) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
  }

  await copyMissing(join(templateDir, 'AGENTS.md'), join(directory, 'AGENTS.md'))
  const skills = join(directory, 'skills')
  await mkdir(skills, { recursive: true })
  try { await copyMissing(join(templateDir, 'skills'), skills) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return directory
}
