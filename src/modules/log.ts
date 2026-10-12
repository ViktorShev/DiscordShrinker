let debugEnabled = true

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

export function isDebugEnabled(): boolean {
  return debugEnabled
}

export function debug(...args: any[]): void {
  if (!debugEnabled) return

  console.debug(...args)
}
