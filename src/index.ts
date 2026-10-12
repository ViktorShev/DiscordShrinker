import { getCLIArgs } from "./modules/cli"
import { debug, setDebugEnabled } from "./modules/log"
import { setSpinnerEnabled, spin, spinSuccess, spinError, isSpinnerEnabled } from "./modules/spinner"

import { BYTES_PER_MB, MAX_FILE_SIZE_IN_BYTES_FREE, MAX_FILE_SIZE_IN_MB_FREE } from "./constants"

import { isFileUnderLimit } from "./modules/ffmpeg/probe"
import { validateFFmpegSetup, shrinkVideo } from "./modules/ffmpeg"
import { pause } from "./modules/misc";

async function main(): Promise<void> {
  const { filepath, debugEnabled, targetMb } = getCLIArgs()
  const maxFileSizeInBytes = targetMb === MAX_FILE_SIZE_IN_MB_FREE
    ? MAX_FILE_SIZE_IN_BYTES_FREE
    : targetMb * BYTES_PER_MB
  const maxFileSizeStr = `${targetMb} MiB`

  setDebugEnabled(debugEnabled)
  setSpinnerEnabled(!debugEnabled)

  spin('Checking FFmpeg setup...')
  await validateFFmpegSetup()

  if (await isFileUnderLimit(filepath, maxFileSizeInBytes)) {
    spinSuccess(`File is already within the ${maxFileSizeStr} limit.`)
    debug(`File is already within the ${maxFileSizeStr} limit.`)
    await pause(2000)
    return
  }

  await shrinkVideo(filepath, maxFileSizeInBytes)
  spinSuccess('Video compressed successfully!')
  await pause(2000)
}

main().catch(async error => {
	const message = error instanceof Error ? error.message : String(error)
	spinError(message)
	if (!isSpinnerEnabled()) console.error(message)
	process.exitCode = 1

  await pause(10000)
})

