import yoctoSpinner from 'yocto-spinner'

let enabled = false
let instance: ReturnType<typeof yoctoSpinner> | null = null

export function setSpinnerEnabled(value: boolean): void {
  enabled = value
}

export function isSpinnerEnabled(): boolean {
  return enabled
}

export function spin(text: string): void {
  if (!enabled) return

  if (instance?.isSpinning) {
    instance.text = text
  } else {
    instance = yoctoSpinner({ text }).start()
  }
}

export function spinSuccess(text: string): void {
  if (!enabled) return

  instance?.success(text)
  instance = null
}

export function spinError(text: string): void {
  if (!enabled) return

  instance?.error(text)
  instance = null
}
