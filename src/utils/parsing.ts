export function parsePositiveNumber(value: string | number | undefined, fallback = 0): number {
  if (!value) {
    return fallback
  }

  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback
  }

  return parsedValue
}