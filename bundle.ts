import { copyFile, mkdir, rm } from "fs/promises"
import { dirname, join } from "path"

const projectDirectory = import.meta.dir
const releaseDirectory = join(projectDirectory, 'release')

const releaseFiles = [
  ['dist/DiscordShrinker.exe', 'DiscordShrinker.exe'],
  ['README.md', 'README.md'],
  ['assets/icon.ico', 'assets/icon.ico'],
  ['scripts/proxies/install.bat', 'install.bat'],
  ['scripts/proxies/uninstall.bat', 'uninstall.bat'],
  ['scripts/proxies/filesize-options-manager.bat', 'filesize-options-manager.bat'],
  ['scripts/install.ps1', 'scripts/install.ps1'],
  ['scripts/uninstall.ps1', 'scripts/uninstall.ps1'],
  ['scripts/filesize-options-manager.ps1', 'scripts/filesize-options-manager.ps1'],
  ['scripts/gui.ps1', 'scripts/gui.ps1'],
] as const

await rm(releaseDirectory, { recursive: true, force: true })

for (const [sourcePath, releasePath] of releaseFiles) {
  const destinationPath = join(releaseDirectory, releasePath)
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(join(projectDirectory, sourcePath), destinationPath)
}

console.log(`Release bundle created at ${releaseDirectory}`)
