import { stat } from "fs/promises";
import { MAX_FILE_SIZE_IN_BYTES } from "../../constants";
import { log } from "../log";
import { MAX_AUDIO_BITRATE } from "./encode";
import { parsePositiveNumber } from "../parsing";
import { cmd, quoteShellPath } from "../cmd";

type ProbeStream = {
  codec_type?: string
  bit_rate?: string
  r_frame_rate?: string
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

export type MediaMetadata = {
  filePath: string
  durationSeconds: number
  fileSizeBytes: number
  videoBitrate: number
  audioBitrate: number
  width: number
  height: number
  fps: number
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
  const fps = parsePositiveNumber(videoStream.r_frame_rate, 60)
  const width = parsePositiveNumber(videoStream.width)
  const height = parsePositiveNumber(videoStream.height)

  if (width === 0 || height === 0) {
    throw new Error('Video width or height is zero or could not be parsed. File might be corrupted or in an unsupported format.')
  }

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
    width,
    height,
    fps,
    hasAudio,
  }

  log('Parsed media metadata:', metadata)

  return metadata
}

export async function isFileUnderLimit(filePath: string): Promise<boolean> {
  const fileStats = await stat(filePath)

  return fileStats.size <= MAX_FILE_SIZE_IN_BYTES
}