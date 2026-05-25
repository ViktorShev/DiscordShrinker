import { mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { basename, dirname, extname, join } from "path"
import {
  MAX_FILE_SIZE_IN_BYTES,
  NULL_DEVICE_PATH,
  REQUIRED_AUDIO_ENCODERS,
  REQUIRED_VIDEO_ENCODERS,
  TARGET_FILE_SIZE_IN_BYTES,
} from "./constants"
import { cmd, quoteShellPath } from "./cmd"
import { log } from "./log"
import { parsePositiveNumber } from "./parsing"


function TARGET_VIDEO_BITRATE(durationSeconds: number, audioBitrate: number): number {
	const maxBitrate = (TARGET_FILE_SIZE_IN_BYTES * 8) / durationSeconds - audioBitrate

  return Math.floor(maxBitrate * 0.95) // Reduce target bitrate by 5% as a safety margin for bitrate fluctuations
}

function RETRY_TARGET_VIDEO_BITRATE(previousBitrate: number, actualSizeBytes: number): number {
  return Math.floor(previousBitrate * (MAX_FILE_SIZE_IN_BYTES / actualSizeBytes) * 0.98) // Scale bitrate proportionally to how far over the limit we landed, then apply an extra 2% safety margin
}

const MAX_AUDIO_BITRATE = 96000

function TARGET_AUDIO_BITRATE(currentBitrate: number): number {
  return Math.min(currentBitrate, MAX_AUDIO_BITRATE)
}

async function ensureFFmpegAvailable(): Promise<void> {
  const { stdout: ffmpegVersion } = await cmd('ffmpeg -version')

  if (!ffmpegVersion.toLowerCase().includes('ffmpeg version')) {
    throw new Error('FFmpeg is not available on the system PATH. Please install FFmpeg and ensure it is accessible via the command line.')
  }

  const { stdout: ffprobeVersion } = await cmd('ffprobe -version')

  if (!ffprobeVersion.toLowerCase().includes('ffprobe version')) {
    throw new Error('FFprobe is not available on the system PATH. Please install FFmpeg (which includes FFprobe) and ensure it is accessible via the command line.')
  }

  log('FFmpeg and FFprobe are available.')
}

async function ensureFFmpegEncoders(encoders: string[]): Promise<void> {
  const { stdout } = await cmd('ffmpeg -hide_banner -encoders')

  const encoderRegex = /^\s*[VAS]\S*\s+([^\s=]+)/gm
  const matches = [...stdout.matchAll(encoderRegex)]

  const availableEncoders = matches.map(match => match[1])

  log('Available encoders:', availableEncoders)

  for (const encoder of encoders) {
    if (!availableEncoders.includes(encoder)) {
      throw new Error(`Required encoder "${encoder}" is not available in FFmpeg.`)
    }
  }

  log('All required encoders are available.')
}

export async function validateFFmpegSetup(): Promise<void> {
  await ensureFFmpegAvailable()
  await ensureFFmpegEncoders([...REQUIRED_VIDEO_ENCODERS, ...REQUIRED_AUDIO_ENCODERS])
}

export async function isFileUnderLimit(filePath: string): Promise<boolean> {
  const fileStats = await stat(filePath)

  return fileStats.size <= MAX_FILE_SIZE_IN_BYTES
}

type ProbeStream = {
  codec_type?: string
  bit_rate?: string
  width?: number
  height?: number
}

type ProbeFormat = {
  filename?: string
  duration?: string
  size?: string
}

type ProbeData = {
  streams?: ProbeStream[]
  format?: ProbeFormat
}

type MediaMetadata = {
  filePath: string
  durationSeconds: number
  fileSizeBytes: number
  videoBitrate: number
  audioBitrate: number
  hasAudio: boolean
}

async function probeMedia(filePath: string): Promise<MediaMetadata> {
  const { stdout } = await cmd(
    `ffprobe -v quiet -print_format json -show_streams -show_format ${quoteShellPath(filePath)}`,
  )

  const data = JSON.parse(stdout) as ProbeData

  log('Probe raw output data:', data)

  const durationSeconds = parsePositiveNumber(data.format?.duration)
  const fileSizeBytes = parsePositiveNumber(data.format?.size)

  if (durationSeconds <= 0) {
    throw new Error('Video duration is zero or could not be parsed. File might be corrupted or in an unsupported format.')
  }

  if (fileSizeBytes <= 0) {
    throw new Error('File size is zero or could not be parsed. File might be corrupted or in an unsupported format.')
  }

  const videoStream = data.streams?.find(stream => stream.codec_type === 'video')

  if (!videoStream) {
    throw new Error('No video stream found in the media file.')
  }

  const videoBitrate = parsePositiveNumber(videoStream.bit_rate)

  const audioStream = data.streams?.find(stream => stream.codec_type === 'audio')
  const hasAudio = Boolean(audioStream)

  const audioBitrate = hasAudio
    ? parsePositiveNumber(audioStream?.bit_rate, MAX_AUDIO_BITRATE)
    : 0

  const metadata: MediaMetadata = {
    filePath,
    durationSeconds,
    fileSizeBytes,
    videoBitrate,
    audioBitrate,
    hasAudio,
  }

  log('Parsed media metadata:', metadata)

  return metadata
}

function buildOutputFilePath(inputFilePath: string): string {
  const inputDirectory = dirname(inputFilePath)
  const inputExtension = extname(inputFilePath)
  const inputBaseName = basename(inputFilePath, inputExtension)

  const outFilePath = join(inputDirectory, `${inputBaseName}_shrunk.mp4`)

  log('Built output file path:', { inputFilePath, outFilePath })

  return outFilePath
}

async function makeTempDirectory(): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'discordshrinker-'))
  log('Created temporary directory:', tempDirectory)

  return tempDirectory
} 

type TwoPassEncodeOptions = {
  inputFilePath: string
  outputFilePath: string
  targetVideoBitrate: number
  targetAudioBitrate: number
  videoFilterArg?: string
  removeAudio: boolean
}

async function twoPassEncode(options: TwoPassEncodeOptions): Promise<void> {
  const tempDirectory = await makeTempDirectory()
  const passLogFile = join(tempDirectory, 'ffmpeg2pass')

  const inputPath = quoteShellPath(options.inputFilePath)
  const outputPath = quoteShellPath(options.outputFilePath)
  const passLogPath = quoteShellPath(passLogFile)

  const targetVideoBitrate = parsePositiveNumber(Math.floor(options.targetVideoBitrate))
  if (targetVideoBitrate <= 0) {
    throw new Error('Target video bitrate is not positive')
  }

  const targetAudioBitrate = parsePositiveNumber(Math.floor(options.targetAudioBitrate))

  const sharedArgs = [
    'ffmpeg -y',
    `-i ${inputPath}`,
    '-c:v libsvtav1',
    `-b:v ${targetVideoBitrate}`,
    options.videoFilterArg ? `-vf ${options.videoFilterArg}` : undefined,
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

function DOWNSCALE_VIDEO_FILTER(targetWidth: number, targetHeight: number, targetFps?: number): string {
  const filters = [
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`
  ]

  if (targetFps) {
    filters.push(`fps=${targetFps}`)
  }

  return filters.join(',')
}

async function downscale(options: DownscaleOptions): Promise<void> {
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

async function twoPassEncodeUntilSizeLimit(options: TwoPassEncodeOptions): Promise<void> {
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

async function handleTwoPassOnlyStrategy(metadata: MediaMetadata): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = buildOutputFilePath(inputFilePath)
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, metadata.audioBitrate)
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)

  await twoPassEncodeUntilSizeLimit({
    inputFilePath,
    outputFilePath,
    targetAudioBitrate,
    targetVideoBitrate,
    removeAudio: !metadata.hasAudio,
  })
}

async function handleDownscaleStrategy(metadata: MediaMetadata): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = buildOutputFilePath(inputFilePath)

  // Best case scenario, we just need to downscale without re-encoding
  await downscale({
    inputFilePath,
    outputFilePath,
    targetWidth: 1280,
    targetHeight: 720,
  })

  if (await isFileUnderLimit(outputFilePath)) {
    log('Successfully compressed video under file size limit without re-encoding after downscaling.')
    return
  }

  // If downscaling alone wasn't enough, we run two pass encoding with retries + downscaling
  log('Only downscaling was not sufficient to get under the file size limit. Starting two-pass encoding with downscaling and bitrate reduction...')
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, metadata.audioBitrate)
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)

  let shouldReduceFps = false

  try {
    await twoPassEncodeUntilSizeLimit({
      inputFilePath,
      outputFilePath,
      targetAudioBitrate,
      targetVideoBitrate,
      videoFilterArg: DOWNSCALE_VIDEO_FILTER(1280, 720),
      removeAudio: !metadata.hasAudio,
    })
  } catch (error) {
    shouldReduceFps = true
  }
  
  // Worst case scenario, we also reduce FPS to 30 in addition to downscaling and bitrate reduction
  if (shouldReduceFps) {
    log('Two-pass encoding with downscaling did not achieve the desired file size. Retrying with reduced FPS...')
    await twoPassEncodeUntilSizeLimit({
      inputFilePath,
      outputFilePath,
      targetAudioBitrate,
      targetVideoBitrate,
      videoFilterArg: DOWNSCALE_VIDEO_FILTER(1280, 720, 30),
      removeAudio: !metadata.hasAudio,
    })
  }
}

enum CompressionStrategy {
  TwoPassOnly = 'two-pass-only',
  Downscale = 'downscale',
}

const ONLY_TWO_PASS_MAX_DURATION_SECONDS = 30

async function determineCompressionStrategy(videoDurationSeconds: number): Promise<CompressionStrategy> {
  if (videoDurationSeconds <= ONLY_TWO_PASS_MAX_DURATION_SECONDS) {
    return CompressionStrategy.TwoPassOnly
  }

  return CompressionStrategy.Downscale
}

const CompressionStrategyToHandler = {
  [CompressionStrategy.TwoPassOnly]: handleTwoPassOnlyStrategy,
  [CompressionStrategy.Downscale]: handleDownscaleStrategy,
}

export async function shrinkVideo(filePath: string): Promise<void> {
  const metadata = await probeMedia(filePath)
  const strategy = await determineCompressionStrategy(metadata.durationSeconds)

  log('Starting compression with strategy:', strategy)
  await CompressionStrategyToHandler[strategy](metadata)
}