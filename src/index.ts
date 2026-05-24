import { getCLIArgs } from "./utils/cli"
import { setLoggingEnabled } from "./utils/log"

import { MAX_FILE_SIZE_STR } from "./utils/constants"

import { 
  validateFFmpegSetup, 
  isFileUnderLimit,
  shrinkVideo,
} from "./utils/ffmpeg"


async function main(): Promise<void> {
  await validateFFmpegSetup()

	const { filepath, logDebugInfo } = getCLIArgs()
	setLoggingEnabled(logDebugInfo)

  if (await isFileUnderLimit(filepath)) {
    console.log(`File is already within the ${MAX_FILE_SIZE_STR} limit.`)
    return
  }

  await shrinkVideo(filepath)
}

main().catch(error => {
	const message = error instanceof Error ? error.message : String(error)
	console.error(message)
	process.exitCode = 1
})

