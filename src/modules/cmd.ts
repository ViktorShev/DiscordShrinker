import { exec } from 'child_process'

export function cmd(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

export function quoteShellPath(filePath: string): string {
  return `"${filePath.replaceAll('"', '\\"')}"`
}
