import {
  MAX_FILE_SIZE_IN_BYTES_FREE,
  REQUIRED_AUDIO_ENCODERS,
  REQUIRED_VIDEO_ENCODERS,
} from "../../constants"
import { ffmpeg, ffprobe } from "../cmd"
import { debug } from "../log"
import { isFileUnderLimit, probeMedia, type MediaMetadata } from "./probe"
import { downscale, MAX_AUDIO_BITRATE, MIN_FPS, MIN_HEIGHT, MIN_WIDTH, OUTPUT_FILE_PATH, TARGET_AUDIO_BITRATE, TARGET_VIDEO_BITRATE, twoPassEncodeUntilUnderLimit } from "./encode"

async function ensureFFmpegAvailable(): Promise<void> {
  const { stdout: ffmpegVersion } = await ffmpeg(['-version'])

  if (!ffmpegVersion.toLowerCase().includes('ffmpeg version')) {
    throw new Error('FFmpeg is not available on the system PATH. Please install FFmpeg and ensure it is accessible via the command line.')
  }

  const { stdout: ffprobeVersion } = await ffprobe(['-version'])

  if (!ffprobeVersion.toLowerCase().includes('ffprobe version')) {
    throw new Error('FFprobe is not available on the system PATH. Please install FFmpeg (which includes FFprobe) and ensure it is accessible via the command line.')
  }

  debug('FFmpeg and FFprobe are available.')
}

async function ensureFFmpegEncoders(encoders: string[]): Promise<void> {
  const { stdout } = await ffmpeg(['-hide_banner', '-encoders'])

  const encoderRegex = /^\s*[VAS]\S*\s+([^\s=]+)/gm
  const matches = [...stdout.matchAll(encoderRegex)]

  const availableEncoders = matches.map(match => match[1])

  debug('Available encoders:', availableEncoders)

  for (const encoder of encoders) {
    if (!availableEncoders.includes(encoder)) {
      throw new Error(`Required encoder "${encoder}" is not available in FFmpeg.`)
    }
  }

  debug('All required encoders are available.')
}

export async function validateFFmpegSetup(): Promise<void> {
  await ensureFFmpegAvailable()
  await ensureFFmpegEncoders([...REQUIRED_VIDEO_ENCODERS, ...REQUIRED_AUDIO_ENCODERS])
}

async function handleTwoPassOnlyStrategy(metadata: MediaMetadata, maxFileSizeInBytes: number): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = OUTPUT_FILE_PATH(inputFilePath)
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, targetAudioBitrate, maxFileSizeInBytes)

  await twoPassEncodeUntilUnderLimit({
    inputFilePath,
    outputFilePath,
    maxFileSizeInBytes,
    videoDurationSeconds: metadata.durationSeconds,
    targetAudioBitrate,
    targetVideoBitrate,
    removeAudio: !metadata.hasAudio,
  })
}

async function handleDownscaleTwoPassStrategy(metadata: MediaMetadata, maxFileSizeInBytes: number): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = OUTPUT_FILE_PATH(inputFilePath)

  const { width: targetWidth, height: targetHeight } = getDownscaleResolution(metadata)

  // Best case scenario, we just need to downscale without re-encoding
  await downscale({
    inputFilePath,
    outputFilePath,
    targetWidth,
    targetHeight,
    videoDurationSeconds: metadata.durationSeconds,
  })

  if (await isFileUnderLimit(outputFilePath, maxFileSizeInBytes)) {
    debug('Successfully compressed video under file size limit without re-encoding after downscaling.')
    return
  }

  // If downscaling alone wasn't enough, we run two pass encoding with retries + downscaling
  debug('Downscaling alone was not sufficient to get under the file size limit. Starting two-pass encoding with downscaling and bitrate reduction...')

  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, targetAudioBitrate, maxFileSizeInBytes)

  let shouldReduceFps = false

  try {
    await twoPassEncodeUntilUnderLimit({
      inputFilePath,
      outputFilePath,
      maxFileSizeInBytes,
      videoDurationSeconds: metadata.durationSeconds,
      targetAudioBitrate,
      targetVideoBitrate,
      targetResolution: { width: targetWidth, height: targetHeight },
      removeAudio: !metadata.hasAudio,
    })
  } catch (error) {
    shouldReduceFps = true
  }

  const canReduceFps = metadata.fps > MIN_FPS

  if (!canReduceFps) {
    debug('Video FPS is already below the mininum threshold. Will not proceed with attempt to reduce FPS for further compression.')

    const errorParts = [
      'Failed to compress video under the file size limit after attempting two-pass encoding with downscaling and bitrate reduction.',
      'Video FPS is already below the minimum threshold. Cannot proceed with further compression attempts that involve reducing FPS.',
      'File may be too complex to be feasibly compressed while maintaining reasonable quality.',
      'Consider manually compressing the file using a different tool.'
    ]

    throw new Error(errorParts.join('\n'))
  }
  
  // Worst case scenario, we also reduce FPS to 30 in addition to downscaling and bitrate reduction
  if (shouldReduceFps) {
    debug('Two-pass encoding with downscaling did not achieve the desired file size. Retrying with reduced FPS...')
    await twoPassEncodeUntilUnderLimit({
      inputFilePath,
      outputFilePath,
      maxFileSizeInBytes,
      videoDurationSeconds: metadata.durationSeconds,
      targetAudioBitrate,
      targetVideoBitrate,
      targetResolution: { width: targetWidth, height: targetHeight },
      targetFps: MIN_FPS,
      removeAudio: !metadata.hasAudio,
    })
  }
}

enum CompressionStrategy {
  TwoPassOnly = 'two-pass-only',
  DownscaleTwoPass = 'downscale-two-pass',
}


const FOUR_K_LONG_EDGE = 3840
const FULL_HD_WIDTH = 1920
const FULL_HD_HEIGHT = 1080

// A pressure of 1 recreates the old 20 MiB / 30 second cutoff for a 1080p60 video.
// Other targets, durations, resolutions, and frame rates scale continuously from that baseline.
const DOWNSCALE_COMPRESSION_PRESSURE_THRESHOLD = 1

export function getCompressionPressure(metadata: MediaMetadata, maxFileSizeInBytes: number): number {
  const refDurationSeconds = 30
  const refWidth = 1920
  const refHeight = 1080
  const refFps = 60
  
  // Reference video values
  const refVideoBitrate = TARGET_VIDEO_BITRATE(
    refDurationSeconds,
    MAX_AUDIO_BITRATE,
    MAX_FILE_SIZE_IN_BYTES_FREE,
  )
  const refBitsPerPixelPerFrame = refVideoBitrate / (refWidth * refHeight * refFps)

  // Actual video values
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, targetAudioBitrate, maxFileSizeInBytes)

  if (targetVideoBitrate <= 0) {
    return Number.POSITIVE_INFINITY
  }

  const targetBitsPerPixelPerFrame = targetVideoBitrate / (metadata.width * metadata.height * metadata.fps)

  return refBitsPerPixelPerFrame / targetBitsPerPixelPerFrame
}

function getDownscaleResolution(metadata: MediaMetadata): { width: number, height: number } {
  const isPortrait = metadata.height > metadata.width
  const isFourKOrHigher = Math.max(metadata.width, metadata.height) >= FOUR_K_LONG_EDGE

  const landscapeTarget = isFourKOrHigher
    ? { width: FULL_HD_WIDTH, height: FULL_HD_HEIGHT }
    : { width: MIN_WIDTH, height: MIN_HEIGHT }

  const orientedTarget = isPortrait
    ? { width: landscapeTarget.height, height: landscapeTarget.width }
    : landscapeTarget

  return {
    width: Math.min(metadata.width, orientedTarget.width),
    height: Math.min(metadata.height, orientedTarget.height),
  }
}

function determineCompressionStrategy(metadata: MediaMetadata, maxFileSizeInBytes: number): CompressionStrategy {
  const shortEdge = Math.min(metadata.width, metadata.height)
  const longEdge = Math.max(metadata.width, metadata.height)

  if (shortEdge <= MIN_HEIGHT && longEdge <= MIN_WIDTH) {
    return CompressionStrategy.TwoPassOnly
  }

  const compressionPressure = getCompressionPressure(metadata, maxFileSizeInBytes)

  debug('Calculated compression pressure:', {
    compressionPressure,
    threshold: DOWNSCALE_COMPRESSION_PRESSURE_THRESHOLD,
  })

  return compressionPressure > DOWNSCALE_COMPRESSION_PRESSURE_THRESHOLD
    ? CompressionStrategy.DownscaleTwoPass
    : CompressionStrategy.TwoPassOnly
}

const CompressionStrategyToHandler = {
  [CompressionStrategy.TwoPassOnly]: handleTwoPassOnlyStrategy,
  [CompressionStrategy.DownscaleTwoPass]: handleDownscaleTwoPassStrategy,
}

export async function shrinkVideo(filePath: string, maxFileSizeInBytes: number): Promise<void> {
  const metadata = await probeMedia(filePath)
  const strategy = determineCompressionStrategy(metadata, maxFileSizeInBytes)

  debug('Starting compression with strategy:', strategy)
  await CompressionStrategyToHandler[strategy](metadata, maxFileSizeInBytes)
}
