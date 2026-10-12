// File constants
export const MAX_FILE_SIZE_IN_MB_FREE = 20
export const BYTES_PER_MB = 1024 * 1024
export const MAX_FILE_SIZE_IN_BYTES_FREE = MAX_FILE_SIZE_IN_MB_FREE * BYTES_PER_MB
export const METADATA_OVERHEAD_IN_BYTES = 512 * 1024 // 512 KiB flat reserve for metadata and container overhead

// FFmpeg constants
export const REQUIRED_VIDEO_ENCODERS = ['libsvtav1']
export const REQUIRED_AUDIO_ENCODERS = ['libopus']

// OS constants
export const NULL_DEVICE_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null'
