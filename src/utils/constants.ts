// File constants
export const MAX_FILE_SIZE_IN_BYTES = 10485760 // 10 * 1024 * 1024
export const METADATA_OVERHEAD_IN_BYTES = 512 * 1024 // 512 KiB flat reserve for metadata and container overhead
export const TARGET_FILE_SIZE_IN_BYTES = MAX_FILE_SIZE_IN_BYTES - METADATA_OVERHEAD_IN_BYTES
export const MAX_FILE_SIZE_STR = `${(MAX_FILE_SIZE_IN_BYTES / 1024 / 1024)} MiB`

// FFmpeg constants
export const REQUIRED_VIDEO_ENCODERS = ['libsvtav1']
export const REQUIRED_AUDIO_ENCODERS = ['libopus']

// OS constants
export const NULL_DEVICE_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null'