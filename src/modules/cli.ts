import { parseArgs } from "util"
import { BYTES_PER_MB, MAX_FILE_SIZE_IN_MB_FREE, METADATA_OVERHEAD_IN_BYTES } from "../constants"

type CLIArgs = {
  filepath: string // Filepath
  targetMb: number // Maximum output file size in MiB
  guiProgressFile?: string // JSON-lines progress channel used by the native Windows UI
}

export function getCLIArgs(args: string[] = process.argv.slice(2)): CLIArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      targetMb: {
        type: 'string',
      },
      gui: {
        type: 'string',
      },
    },
    strict: true,
    allowPositionals: true,
  })

  const filepath = positionals[0]

  if (!filepath) {
    throw new Error('No file path provided. Usage: bun src/index.ts <file-path> [--targetMb <megabytes>] [--gui <progress-file>]')
  }

  if (positionals.length > 1) {
    throw new Error(`Unexpected positional argument: ${positionals[1]}`)
  }

  let targetMb = MAX_FILE_SIZE_IN_MB_FREE

  if (values.targetMb !== undefined) {
    targetMb = Number(values.targetMb)

    const metadataOverheadMb = METADATA_OVERHEAD_IN_BYTES / BYTES_PER_MB
    if (!Number.isFinite(targetMb) || targetMb <= metadataOverheadMb) {
      throw new Error(`--targetMb must be a number greater than ${metadataOverheadMb}.`)
    }
  }

  return {
    filepath,
    targetMb,
    guiProgressFile: values.gui,
  }
}
