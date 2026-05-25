let debugEnabled = false

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

export function debug(...args: any[]): void {
  if (!debugEnabled) return

  console.debug(...args)
}