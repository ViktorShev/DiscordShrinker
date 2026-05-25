# DiscordShrinker

Compresses video files to fit within Discord's 10 MB file size limit. Designed for gaming clips and screen recordings.

## Features

- Targets just under 10 MB while preserving as much quality as possible
- Uses **AV1** video encoding (`libsvtav1`) and **Opus** audio encoding (`libopus`) for best quality at low bitrates
- Automatically picks a compression strategy based on the video:
  - Short clips (≤ 30s) or already small resolution → two-pass bitrate encoding
  - Longer / high-res videos → downscales to 720p, then two-pass encodes, then reduces FPS to 30 as a last resort if needed (which will probably never happen)
- Up to 3 retry attempts with adjusted bitrates if the output overshoots the limit
- Skips compression entirely if the file is already under 10 MB
- Output file is saved as `<original name>_shrunk.mp4` next to the original

## Installation (Windows)

1. Download the latest release - it contains:
   - `DiscordShrinker.exe`
   - `install.bat` (proxy to execute the .ps1 script)
   - `uninstall.bat` (also a proxy)
   - `assets/icon.ico`
   - `scripts/install.ps1`
   - `scripts/uninstall.ps1`
2. Double-click **`install.bat`**

The installer will:
- Install **FFmpeg** via `winget` if it isn't already on your system
- Copy the app to `%LOCALAPPDATA%\DiscordShrinker\`
- Add a **"Shrink for Discord"** entry to the right-click context menu for all files

> The context menu entry appears under **Show more options** in the Windows 11 right-click menu.

To uninstall, double-click **`uninstall.bat`**.

## Usage

### Right-click menu

Right-click any video file → **Show more options** → **Shrink for Discord**.

A terminal window will open, show progress, and close when done. The compressed file appears next to the original.

### Command line

```
DiscordShrinker.exe <file-path> [--debug]
```

| Flag | Description |
|---|---|
| `--debug` | Print verbose FFmpeg output and internal logs |

## Building from source

**Requirements:** [Bun](https://bun.sh), [FFmpeg](https://ffmpeg.org)

```bash
bun install
bun run compile   # produces DiscordShrinker.exe
```

To run without compiling:

```bash
bun run src/index.ts <file-path>
```
