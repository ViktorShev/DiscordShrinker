type CLIArgs = {
  filepath: string // Filepath
  logDebugInfo: boolean // Log debug info and FFmpeg output
}

export function getCLIArgs(): CLIArgs {
  const args = process.argv.slice(2)
  const filepath = args[0]

  if (args.length === 0 || !filepath) {
    throw new Error('No file path provided. Usage: node dist/index.js <file-path> [flags]')
  }

  const flags = args.slice(1)

  const logDebugInfo = flags.includes('--debug')

  return { filepath, logDebugInfo }
}
