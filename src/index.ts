import { getCLIArgs } from "./modules/cli"
import { setDebugEnabled } from "./modules/log"

import { BYTES_PER_MB, MAX_FILE_SIZE_IN_BYTES_FREE, MAX_FILE_SIZE_IN_MB_FREE } from "./constants"

import { isFileUnderLimit } from "./modules/ffmpeg/probe"
import { validateFFmpegSetup, shrinkVideo } from "./modules/ffmpeg"
import { reportError, reportStage, reportSuccess, setProgressFile } from "./modules/progress"

async function main(): Promise<void> {
  const { filepath, targetMb, guiProgressFile } = getCLIArgs()

  setDebugEnabled(!guiProgressFile)
  setProgressFile(guiProgressFile)

  const maxFileSizeInBytes = targetMb === MAX_FILE_SIZE_IN_MB_FREE
    ? MAX_FILE_SIZE_IN_BYTES_FREE
    : targetMb * BYTES_PER_MB
  const maxFileSizeStr = `${targetMb} MB`

  reportStage('Checking FFmpeg setup...')
  await validateFFmpegSetup()

  if (await isFileUnderLimit(filepath, maxFileSizeInBytes)) {
    const message = `File is already within the ${maxFileSizeStr} limit.`
    reportSuccess(message)
    return
  }

  reportStage('Analyzing video...')
  await shrinkVideo(filepath, maxFileSizeInBytes)
  reportSuccess('Video compressed successfully!')
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  reportError(message)

  process.exitCode = 1
})

