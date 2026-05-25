import { getCLIArgs } from "./modules/cli"
import { setDebugEnabled } from "./modules/log"

import { MAX_FILE_SIZE_STR } from "./constants"

import { isFileUnderLimit } from "./modules/ffmpeg/probe"
import { validateFFmpegSetup, shrinkVideo } from "./modules/ffmpeg"

async function main(): Promise<void> {
  const { filepath, debugEnabled } = getCLIArgs()
  setDebugEnabled(debugEnabled)

  await validateFFmpegSetup()

  if (await isFileUnderLimit(filepath)) {
    console.info(`File is already within the ${MAX_FILE_SIZE_STR} limit.`)
    return
  }

  await shrinkVideo(filepath)
}

main().catch(error => {
	const message = error instanceof Error ? error.message : String(error)
	console.error(message)
	process.exitCode = 1
})

