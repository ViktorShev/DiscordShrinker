import { appendFileSync, writeFileSync } from "fs"
import { debug } from "./log"

type ProgressEvent =
  | { type: 'stage', message: string, determinate: boolean }
  | { type: 'progress', value: number }
  | { type: 'success', message: string }
  | { type: 'error', message: string }

let progressFilePath: string | undefined

export function setProgressFile(filePath?: string): void {
  progressFilePath = filePath

  if (progressFilePath) {
    writeFileSync(progressFilePath, '', 'utf8')
  }
}

function emitProgress(event: ProgressEvent): void {
  if (!progressFilePath) return

  appendFileSync(progressFilePath, `${JSON.stringify(event)}\n`, 'utf8')
}

export function reportStage(message: string, determinate = false): void {
  emitProgress({ type: 'stage', message, determinate })
  debug(message)
}

export function reportProgress(value: number): void {
  emitProgress({ type: 'progress', value: Math.max(0, Math.min(value, 1)) })
}

export function reportSuccess(message: string): void {
  emitProgress({ type: 'success', message })
  debug(message)
}

export function reportError(message: string): void {
  emitProgress({ type: 'error', message })
  debug(message)
}
