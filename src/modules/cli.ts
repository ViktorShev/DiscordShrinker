import { parseArgs } from "util"
import { BYTES_PER_MB, MAX_FILE_SIZE_IN_MB_FREE, METADATA_OVERHEAD_IN_BYTES } from "../constants"

type CLIArgs = {
  filepath: string // Filepath
  debugEnabled: boolean // Log debug info and FFmpeg output
  targetMb: number // Maximum output file size in MiB
}

export function getCLIArgs(args: string[] = process.argv.slice(2)): CLIArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      debug: {
        type: 'boolean',
        default: false,
      },
      targetMb: {
        type: 'string',
      },
    },
    strict: true,
    allowPositionals: true,
  })

  const filepath = positionals[0]

  if (!filepath) {
    throw new Error('No file path provided. Usage: bun src/index.ts <file-path> [--targetMb <megabytes>] [--debug]')
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

  return { filepath, debugEnabled: values.debug, targetMb }
}
