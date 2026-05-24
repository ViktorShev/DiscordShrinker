let loggingEnabled = false

export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled
}

export function log(...args: any[]): void {
  if (!loggingEnabled) return

  console.log(...args)
}