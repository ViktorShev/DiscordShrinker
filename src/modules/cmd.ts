import { spawn } from 'child_process'
import { debug, isDebugEnabled } from './log'

type CommandOptions = {
  streamStdout?: boolean
  streamStderr?: boolean
  onStdoutChunk?: (chunk: string) => void
}

export function cmd(command: string, args: string[], options: CommandOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: !isDebugEnabled() })

    debug(`Spawned process: ${command} ${args.join(' ')}`)
    
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      options.onStdoutChunk?.(text)

      if (options.streamStdout) {
        process.stdout.write(text)
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text

      if (options.streamStderr) {
        process.stderr.write(text)
      }
    })

    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code === 0) {
        debug(`Process completed successfully: ${command} ${args.join(' ')}`)
        resolve({ stdout, stderr })
      } else {
        debug(`Process failed: ${command} ${args.join(' ')} with code ${code}`)
        reject(new Error(stderr ?? `Process exited with code ${code}`))
      }
    })
  })
}

type FFmpegProgressOptions = {
  videoDurationSeconds: number
  onProgress: (progress: number) => void
}

function createFFmpegProgressParser(videoDurationSeconds: number, onProgress: (progress: number) => void): (chunk: string) => void {
  let bufferedText = ''

  return (chunk: string): void => {
    bufferedText += chunk
    const lines = bufferedText.split(/\r?\n/)
    bufferedText = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('out_time_us=')) continue

      const elapsedMicroseconds = Number(line.slice('out_time_us='.length))
      if (!Number.isFinite(elapsedMicroseconds)) continue

      const progress = elapsedMicroseconds / 1_000_000 / videoDurationSeconds
      onProgress(Math.max(0, Math.min(progress, 1)))
    }
  }
}

export async function ffmpeg(args: string[], progressOptions?: FFmpegProgressOptions): Promise<{ stdout: string; stderr: string }> {
  if (!progressOptions) {
    return cmd('ffmpeg', args)
  }

  if (isDebugEnabled()) {
    return cmd('ffmpeg', args, {
      streamStdout: true,
      streamStderr: true,
    })
  }

  // GUI mode (writes ffmpeg machine-friendly progress to a file)
  const progressArgs = [
    '-progress', 'pipe:1',
    '-stats_period', '0.25',
    '-nostats',
    ...args,
  ]

  const parseProgress = createFFmpegProgressParser(progressOptions.videoDurationSeconds, progressOptions.onProgress)
  progressOptions.onProgress(0)
  const result = await cmd('ffmpeg', progressArgs, {
    onStdoutChunk: parseProgress,
  })
  progressOptions.onProgress(1)
  return result
}

export function ffprobe(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return cmd('ffprobe', args)
}
