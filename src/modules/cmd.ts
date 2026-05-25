import { spawn } from 'child_process'

export function cmd(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args)
    
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(stderr ?? `Process exited with code ${code}`))
      }
    })
  })
}

export function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return cmd('ffmpeg', args)
}

export function ffprobe(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return cmd('ffprobe', args)
}
