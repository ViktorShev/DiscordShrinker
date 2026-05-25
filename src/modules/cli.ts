type CLIArgs = {
  filepath: string // Filepath
  debugEnabled: boolean // Log debug info and FFmpeg output
}

export function getCLIArgs(): CLIArgs {
  const args = process.argv.slice(2)
  const filepath = args[0]

  if (args.length === 0 || !filepath) {
    throw new Error('No file path provided. Usage: bun src/index.ts <file-path> [flags]')
  }

  const flags = args.slice(1)

  const debugEnabled = flags.includes('--debug')

  return { filepath, debugEnabled }
}
