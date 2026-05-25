import {
  REQUIRED_AUDIO_ENCODERS,
  REQUIRED_VIDEO_ENCODERS,
} from "../../constants"
import { cmd } from "../cmd"
import { log } from "../log"
import { isFileUnderLimit, probeMedia, type MediaMetadata } from "./probe";
import { downscale, MIN_FPS, MIN_HEIGHT, MIN_WIDTH, OUTPUT_FILE_PATH, TARGET_AUDIO_BITRATE, TARGET_VIDEO_BITRATE, twoPassEncodeUntilUnderLimit } from "./encode";

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

async function handleTwoPassOnlyStrategy(metadata: MediaMetadata): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = OUTPUT_FILE_PATH(inputFilePath)
  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, metadata.audioBitrate)
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)

  await twoPassEncodeUntilUnderLimit({
    inputFilePath,
    outputFilePath,
    targetAudioBitrate,
    targetVideoBitrate,
    removeAudio: !metadata.hasAudio,
  })
}

async function handleDownscaleStrategy(metadata: MediaMetadata): Promise<void> {
  const inputFilePath = metadata.filePath
  const outputFilePath = OUTPUT_FILE_PATH(inputFilePath)

  const targetWidth = Math.min(metadata.width, MIN_WIDTH)
  const targetHeight = Math.min(metadata.height, MIN_HEIGHT)

  // Best case scenario, we just need to downscale without re-encoding
  await downscale({
    inputFilePath,
    outputFilePath,
    targetWidth,
    targetHeight,
  })

  if (await isFileUnderLimit(outputFilePath)) {
    log('Successfully compressed video under file size limit without re-encoding after downscaling.')
    return
  }

  // If downscaling alone wasn't enough, we run two pass encoding with retries + downscaling
  log('Downscaling alone was not sufficient to get under the file size limit. Starting two-pass encoding with downscaling and bitrate reduction...')

  const targetVideoBitrate = TARGET_VIDEO_BITRATE(metadata.durationSeconds, metadata.audioBitrate)
  const targetAudioBitrate = TARGET_AUDIO_BITRATE(metadata.audioBitrate)

  let shouldReduceFps = false

  try {
    await twoPassEncodeUntilUnderLimit({
      inputFilePath,
      outputFilePath,
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
    log('Video FPS is already below the mininum threshold. Will not proceed with attempt to reduce FPS for further compression.')

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
    log('Two-pass encoding with downscaling did not achieve the desired file size. Retrying with reduced FPS...')
    await twoPassEncodeUntilUnderLimit({
      inputFilePath,
      outputFilePath,
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
  Downscale = 'downscale',
}

const TWO_PASS_ONLY_MAX_VIDEO_DURATION = 30

async function determineCompressionStrategy(metadata: MediaMetadata): Promise<CompressionStrategy> {
  if (metadata.durationSeconds <= TWO_PASS_ONLY_MAX_VIDEO_DURATION) {
    return CompressionStrategy.TwoPassOnly
  }

  if (metadata.width <= MIN_WIDTH && metadata.height <= MIN_HEIGHT) {
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
  const strategy = await determineCompressionStrategy(metadata)

  log('Starting compression with strategy:', strategy)
  await CompressionStrategyToHandler[strategy](metadata)
}