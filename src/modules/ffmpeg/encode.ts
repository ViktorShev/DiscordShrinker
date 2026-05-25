import { basename, dirname, extname, join } from "path"
import { MAX_FILE_SIZE_IN_BYTES, NULL_DEVICE_PATH, TARGET_FILE_SIZE_IN_BYTES } from "../../constants"
import { debug } from "../log"
import { spin } from "../spinner"
import { mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { ffmpeg } from "../cmd"
import { safeNumber } from "../misc"
import { isFileUnderLimit } from "./probe"

export function TARGET_VIDEO_BITRATE(durationSeconds: number, audioBitrate: number): number {
	const maxBitrate = (TARGET_FILE_SIZE_IN_BYTES * 8) / durationSeconds - audioBitrate

  return Math.floor(maxBitrate * 0.95) // Reduce target bitrate by 5% as a safety margin for bitrate fluctuations
}

function RETRY_TARGET_VIDEO_BITRATE(previousBitrate: number, actualSizeBytes: number): number {
  return Math.floor(previousBitrate * (MAX_FILE_SIZE_IN_BYTES / actualSizeBytes) * 0.98) // Scale bitrate proportionally to how far over the limit we landed, then apply an extra 2% safety margin
}

export const MIN_FPS = 30
export const MIN_WIDTH = 1280
export const MIN_HEIGHT = 720

export const MAX_AUDIO_BITRATE = 96000

export function TARGET_AUDIO_BITRATE(currentBitrate: number): number {
  return Math.min(currentBitrate, MAX_AUDIO_BITRATE)
}

function DOWNSCALE_VIDEO_FILTER(targetWidth: number, targetHeight: number, targetFps?: number): string {
  const filters = [
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`
  ]

  if (targetFps) {
    filters.push(`fps=${targetFps}`)
  }

  return filters.join(',')
}

export function OUTPUT_FILE_PATH(inputFilePath: string, extension: string = 'mp4'): string {
  const inputDirectory = dirname(inputFilePath)
  const inputExtension = extname(inputFilePath)
  const inputBaseName = basename(inputFilePath, inputExtension)

  const outFilePath = join(inputDirectory, `${inputBaseName}_shrunk.${extension}`)

  debug('Built output file path:', { inputFilePath, outFilePath })

  return outFilePath
}

async function createTempDirectory(): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'discordshrinker-'))
  debug('Created temporary directory:', tempDirectory)

  return tempDirectory
}

type TwoPassEncodeOptions = {
  inputFilePath: string
  outputFilePath: string
  targetVideoBitrate: number
  targetAudioBitrate: number
  targetResolution?: { width: number, height: number }
  targetFps?: number
  removeAudio: boolean
}

async function twoPassEncode(options: TwoPassEncodeOptions): Promise<void> {
  const tempDirectory = await createTempDirectory()
  const passLogFile = join(tempDirectory, 'ffmpeg2pass')

  const targetVideoBitrate = safeNumber(Math.floor(options.targetVideoBitrate))
  if (targetVideoBitrate <= 0) {
    throw new Error('Target video bitrate is not positive')
  }

  const targetAudioBitrate = safeNumber(Math.floor(options.targetAudioBitrate))

  const videoFilterArg = options.targetResolution ? DOWNSCALE_VIDEO_FILTER(options.targetResolution.width, options.targetResolution.height, options.targetFps) : undefined

  const sharedArgs = [
    '-y',
    '-i', options.inputFilePath,
    '-c:v', 'libsvtav1',
    '-b:v', String(targetVideoBitrate),
    ...(videoFilterArg ? ['-vf', videoFilterArg] : []),
    '-passlogfile', passLogFile,
  ]

  const firstPassArgs = [...sharedArgs, '-pass', '1', '-an', '-f', 'null', NULL_DEVICE_PATH]

  const secondPassAudioArgs: string[] = options.removeAudio
    ? ['-an']
    : ['-c:a', 'libopus', '-b:a', String(targetAudioBitrate), '-vbr', 'constrained']
  const secondPassArgs = [...sharedArgs, '-pass', '2', ...secondPassAudioArgs, options.outputFilePath]

  debug('Starting two-pass encode with the following options:', {
    tempDirectoryPath: tempDirectory,
    passLogFilePath: passLogFile,
    targetVideoBitrate,
    targetAudioBitrate,
    firstPassArgs,
    secondPassArgs,
  })

  try {
    spin('Two-pass encoding (pass 1 of 2)...')
    const { stdout, stderr } = await ffmpeg(firstPassArgs)
    debug('Ran first pass:\n', stdout, stderr)

    spin('Two-pass encoding (pass 2 of 2)...')
    const { stdout: stdout2, stderr: stderr2 } = await ffmpeg(secondPassArgs)
    debug('Ran second pass:\n', stdout2, stderr2)
  } finally {
    try {
      spin('Cleaning up temporary files...')
      debug('Removing temp directory')
      await rm(tempDirectory, { recursive: true, force: true })
    } catch (cleanupError) {
      debug('Failed to remove temp directory:', cleanupError)
    }
  }
}

type DownscaleOptions = {
  inputFilePath: string
  outputFilePath: string
  targetWidth: number
  targetHeight: number
  targetFps?: number
}

export async function downscale(options: DownscaleOptions): Promise<void> {
  const videoFilterArg = DOWNSCALE_VIDEO_FILTER(options.targetWidth, options.targetHeight, options.targetFps)

  const args = [
    '-y',
    '-i', options.inputFilePath,
    '-vf', videoFilterArg,
    '-movflags', '+faststart',
    options.outputFilePath,
  ]

  debug('Starting fast downscale encode with args:', args)

  spin('Downscaling...')
  await ffmpeg(args)
}

const MAX_TWO_PASS_RETRIES = 3

export async function twoPassEncodeUntilUnderLimit(options: TwoPassEncodeOptions): Promise<void> {
  let targetVideoBitrate = options.targetVideoBitrate

  for (let attempt = 0; attempt < MAX_TWO_PASS_RETRIES; attempt++) {
    const adjustedOptions: TwoPassEncodeOptions = {
      ...options,
      targetVideoBitrate,
    }

    debug(`Starting two-pass attempt ${attempt} with options:`, adjustedOptions)

    await twoPassEncode(adjustedOptions)

    if (await isFileUnderLimit(adjustedOptions.outputFilePath)) {
      debug(`Successfully compressed video under file size limit on two-pass attempt: ${attempt}`)
      return
    }

    const { size: actualSizeBytes } = await stat(adjustedOptions.outputFilePath)

    targetVideoBitrate = RETRY_TARGET_VIDEO_BITRATE(targetVideoBitrate, actualSizeBytes)

    debug(`Two-pass attempt ${attempt} produced ${actualSizeBytes} bytes. Retrying with adjusted video bitrate: ${targetVideoBitrate}`)
  }

  const errorParts = [
    `Failed to compress video under the file size limit after ${MAX_TWO_PASS_RETRIES} two-pass attempts.`,
    'File may be too complex to be feasibly compressed while maintaining reasonable quality.',
    'Consider manually compressing the file using a different tool.'
  ]

  throw new Error(errorParts.join('\n'))
}