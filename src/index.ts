import { getCLIArgs } from "./modules/cli"
import { debug, setDebugEnabled } from "./modules/log"
import { setSpinnerEnabled, spin, spinSuccess, spinError, isSpinnerEnabled } from "./modules/spinner"

import { MAX_FILE_SIZE_STR } from "./constants"

import { isFileUnderLimit } from "./modules/ffmpeg/probe"
import { validateFFmpegSetup, shrinkVideo } from "./modules/ffmpeg"
import { pause } from "./modules/misc";

async function main(): Promise<void> {
  const { filepath, debugEnabled } = getCLIArgs()
  setDebugEnabled(debugEnabled)
  setSpinnerEnabled(!debugEnabled)

  spin('Checking FFmpeg setup...')
  await validateFFmpegSetup()

  if (await isFileUnderLimit(filepath)) {
    spinSuccess(`File is already within the ${MAX_FILE_SIZE_STR} limit.`)
    debug(`File is already within the ${MAX_FILE_SIZE_STR} limit.`)
    return
  }

  await shrinkVideo(filepath)
  spinSuccess('Video compressed successfully!')
  await pause(1000)
}

main().catch(async error => {
	const message = error instanceof Error ? error.message : String(error)
	spinError(message)
	if (!isSpinnerEnabled()) console.error(message)
	process.exitCode = 1

  await pause(10000)
})

