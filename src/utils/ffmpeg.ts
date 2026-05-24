import { mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import { basename, dirname, extname, join } from "path"
import {
  MAX_AUDIO_BITRATE,
  MAX_FILE_SIZE_IN_BYTES,
  NULL_DEVICE_PATH,
  REQUIRED_AUDIO_ENCODERS,
  REQUIRED_VIDEO_ENCODERS,
} from "./constants"
import { cmd, quoteShellPath } from "./cmd"
import { log } from "./log"
import { parsePositiveNumber } from "./parsing"

async function ensureFFmpegAvailable(): Promise<void> {
  const { stdout: ffmpegVersion } = await cmd('ffmpeg -version')

  if (!ffmpegVersion.toLowerCase().includes('ffmpeg version')) {
    throw new Error('FFmpeg is not available on the system PATH.')
  }

  const { stdout: ffprobeVersion } = await cmd('ffprobe -version')

  if (!ffprobeVersion.toLowerCase().includes('ffprobe version')) {
    throw new Error('FFprobe is not available on the system PATH.')
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
      throw new Error(`Required encoder "${encoder}" is not available in ffmpeg.`)
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

export async function probeMedia(filePath: string): Promise<MediaMetadata> {
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

export function buildOutputFilePath(inputFilePath: string): string {
  const inputDirectory = dirname(inputFilePath)
  const inputExtension = extname(inputFilePath)
  const inputBaseName = basename(inputFilePath, inputExtension)

  const outFilePath = join(inputDirectory, `${inputBaseName}_shrunk.mp4`)

  log('Built output file path:', { inputFilePath, outFilePath })

  return outFilePath
}

type TwoPassEncodeOptions = {
  inputFilePath: string
  outputFilePath: string
  targetVideoBitrate: number
  targetAudioBitrate: number
  removeAudio: boolean
}

async function twoPassEncode(options: TwoPassEncodeOptions): Promise<void> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'discordshrinker-'))
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
    `-passlogfile ${passLogPath}`,
  ].join(' ')

  const firstPassCommand = `${sharedArgs} -pass 1 -an -f null ${NULL_DEVICE_PATH}`

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
    log('Running first pass...')
    await cmd(firstPassCommand)

    log('Running second pass...')
    await cmd(secondPassCommand)
  } finally {
    log('Removing temp directory...')
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

type DownscaleOptions = {
  inputFilePath: string
  outputFilePath: string
  targetWidth: number
  targetHeight: number
  targetFps?: number
}

async function downscale(options: DownscaleOptions): Promise<void> {
  const inputPath = quoteShellPath(options.inputFilePath)
  const outputPath = quoteShellPath(options.outputFilePath)

  const filters = [
    `scale=${options.targetWidth}:${options.targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`
  ]

  if (options.targetFps) {
    filters.push(`fps=${options.targetFps}`)
  }

  const videoFilterArg = filters.join(',')

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

const ONLY_TWO_PASS_MAX_DURATION_SECONDS = 30

export enum CompressionStrategy {
  TwoPassOnly = 'two-pass-only',
  Downscale = 'downscale',
}

export async function determineCompressionStrategy(videoDurationSeconds: number): Promise<CompressionStrategy> {
  if (videoDurationSeconds <= ONLY_TWO_PASS_MAX_DURATION_SECONDS) {
    return CompressionStrategy.TwoPassOnly
  }

  return CompressionStrategy.Downscale
}

export const CompressionStrategyToHandler = {
  [CompressionStrategy.TwoPassOnly]: (_metadata: MediaMetadata) => {}, // handleTwoPassOnlyStrategy,
  [CompressionStrategy.Downscale]: (_metadata: MediaMetadata) => {} // handleDownscaleStrategy,
}

export async function shrinkVideo(filePath: string): Promise<void> {
  const metadata = await probeMedia(filePath)
  const strategy = await determineCompressionStrategy(metadata.durationSeconds)

  log('Starting compression with strategy:', strategy)
  await CompressionStrategyToHandler[strategy](metadata)
}