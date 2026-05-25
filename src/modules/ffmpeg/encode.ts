import { basename, dirname, extname, join } from "path"
import { MAX_FILE_SIZE_IN_BYTES, NULL_DEVICE_PATH, TARGET_FILE_SIZE_IN_BYTES } from "../../constants"
import { log } from "../log"
import { mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { cmd, quoteShellPath } from "../cmd"
import { parsePositiveNumber } from "../parsing"
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

  log('Built output file path:', { inputFilePath, outFilePath })

  return outFilePath
}

async function createTempDirectory(): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'discordshrinker-'))
  log('Created temporary directory:', tempDirectory)

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

  const inputPath = quoteShellPath(options.inputFilePath)
  const outputPath = quoteShellPath(options.outputFilePath)
  const passLogPath = quoteShellPath(passLogFile)

  const targetVideoBitrate = parsePositiveNumber(Math.floor(options.targetVideoBitrate))
  if (targetVideoBitrate <= 0) {
    throw new Error('Target video bitrate is not positive')
  }

  const targetAudioBitrate = parsePositiveNumber(Math.floor(options.targetAudioBitrate))

  const videoFilterArg = options.targetResolution ? DOWNSCALE_VIDEO_FILTER(options.targetResolution.width, options.targetResolution.height, options.targetFps) : undefined

  const sharedArgs = [
    'ffmpeg -y',
    `-i ${inputPath}`,
    '-c:v libsvtav1',
    `-b:v ${targetVideoBitrate}`,
    videoFilterArg ? `-vf ${videoFilterArg}` : undefined,
    `-passlogfile ${passLogPath}`,
  ].filter(Boolean).join(' ')

  const firstPassCommand = `${sharedArgs} -pass 1 -an -f null ${quoteShellPath(NULL_DEVICE_PATH)}`

  const secondPassAudioArgs = options.removeAudio ? '-an' : `-c:a libopus -b:a ${targetAudioBitrate} -vbr constrained`
  const secondPassCommand = `${sharedArgs} -pass 2 ${secondPassAudioArgs} ${outputPath}`

  log('Running two-pass encode with:', {
    tempDirectoryPath: tempDirectory,
    passLogFilePath: passLogFile,
    targetVideoBitrate,
    targetAudioBitrate,
    firstPassCommand,
    secondPassCommand,
  })

  try {
    const { stdout, stderr } = await cmd(firstPassCommand)
    log('Ran first pass', stdout, stderr)

    const { stdout: stdout2, stderr: stderr2 } = await cmd(secondPassCommand)
    log('Ran second pass', stdout2, stderr2)
  } finally {
    try {
      log('Cleaning up temporary files...')
      await rm(tempDirectory, { recursive: true, force: true })
    } catch (cleanupError) {
      log('Failed to clean up temporary files:', cleanupError)
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
  const inputPath = quoteShellPath(options.inputFilePath)
  const outputPath = quoteShellPath(options.outputFilePath)

  const videoFilterArg = DOWNSCALE_VIDEO_FILTER(options.targetWidth, options.targetHeight, options.targetFps)

  const command = [
    'ffmpeg -y',
    `-i ${inputPath}`,
    `-vf ${videoFilterArg}`,
    '-movflags +faststart',
    outputPath,
  ].join(' ')

  log('Running fast downscale encode with command:', command)
  
  await cmd(command)
}

const MAX_TWO_PASS_RETRIES = 3

export async function twoPassEncodeUntilUnderLimit(options: TwoPassEncodeOptions): Promise<void> {
  let targetVideoBitrate = options.targetVideoBitrate

  for (let attempt = 0; attempt < MAX_TWO_PASS_RETRIES; attempt++) {
    const adjustedOptions: TwoPassEncodeOptions = {
      ...options,
      targetVideoBitrate,
    }

    log(`Starting two pass attempt ${attempt} with options:`, adjustedOptions)

    await twoPassEncode(adjustedOptions)

    if (await isFileUnderLimit(adjustedOptions.outputFilePath)) {
      log(`Successfully compressed video under file size limit on two-pass attempt: ${attempt}.`)
      return
    }

    const { size: actualSizeBytes } = await stat(adjustedOptions.outputFilePath)

    targetVideoBitrate = RETRY_TARGET_VIDEO_BITRATE(targetVideoBitrate, actualSizeBytes)

    log(`Two-pass attempt ${attempt} produced ${actualSizeBytes} bytes. Retrying with adjusted video bitrate: ${targetVideoBitrate}.`)
  }

  const errorParts = [
    `Failed to compress video under the file size limit after ${MAX_TWO_PASS_RETRIES} two-pass attempts.`,
    'File may be too complex to be feasibly compressed while maintaining reasonable quality.',
    'Consider manually compressing the file using a different tool.'
  ]

  throw new Error(errorParts.join('\n'))
}