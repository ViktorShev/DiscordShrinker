# DiscordShrinker

Compresses video files to a configurable target size. Designed for sharing gaming clips and screen recordings on Discord.

## Features

- Targets just under Discord's 20 MB free upload limit by default while preserving as much quality as possible
- Supports custom target sizes through the `--targetMb` command-line option
- Uses **AV1** video encoding (`libsvtav1`) and **Opus** audio encoding (`libopus`) for best quality at low bitrates
- Automatically picks a compression strategy based on the target size, duration, resolution, and FPS:
  - Videos with enough target bitrate for their pixel rate → two-pass encoding at the original resolution
  - Constrained 4K-or-higher videos → downscales to 1080p before two-pass encoding
  - Other constrained high-res videos → downscales to 720p before two-pass encoding
  - Reduces FPS to 30 as a last resort if the selected strategy still exceeds the target (which will probably never happen)
- Up to 3 retry attempts with adjusted bitrates if the output overshoots the limit
- Skips compression entirely if the file is already under the selected target size
- Shows compression progress in a compact native Windows window for context-menu runs, with verbose logs and live FFmpeg output for terminal runs
- Output file is saved as `<original name>_shrunk.mp4` next to the original

## Installation (Windows)

1. Download the latest release - it contains:
   - `DiscordShrinker.exe`
   - `install.bat` (proxy to execute the .ps1 script)
   - `uninstall.bat` (also a proxy)
   - `filesize-options-manager.bat` (proxy for managing submenu sizes)
   - `assets/icon.ico`
   - `scripts/install.ps1`
   - `scripts/uninstall.ps1`
   - `scripts/filesize-options-manager.ps1`
   - `scripts/progress-window.ps1`
2. Double-click **`install.bat`**

The installer will:
- Install **FFmpeg** via `winget` if it isn't already on your system
- Copy the app to `%LOCALAPPDATA%\DiscordShrinker\`
- Add a **"Shrink for Discord"** entry targeting 20 MB to the right-click context menu for all files
- Add a **"Shrink For Discord Extra"** submenu with 8, 10, 20, 50, 100, and 500 MB targets plus an **"Add custom..."** manager

> The context menu entry appears under **Show more options** in the Windows 11 right-click menu.

To uninstall, double-click **`uninstall.bat`**.

## Usage

### Right-click menu

Right-click any video file → **Show more options** → **Shrink for Discord**. This uses Discord's 20 MB free upload limit.

For another target, open **Shrink For Discord Extra** and choose 8, 10, 20, 50, 100, or 500 MB.

Choose **Add custom...** at the bottom of that submenu to manage all extra size options. You can add a target at any menu position, remove any target, or restore the default 8, 10, 20, 50, 100, and 500 MB list. New targets are added at the bottom unless you enter another position; **Add custom...** always remains last.

A small native Windows progress window opens while the video is processed and closes shortly after a successful result. Errors remain visible until dismissed. The compressed file appears next to the original.

### Command line

```
DiscordShrinker.exe <file-path> [--targetMb <megabytes>] [--gui <progress-file>]
```

| Flag | Description |
|---|---|
| `--targetMb <megabytes>` | Set the maximum output file size in MiB (defaults to 20) |
| `--gui <progress-file>` | Run as the native window's hidden worker and write JSON-lines progress events to the supplied file |

Command-line runs default to verbose terminal output with live FFmpeg progress. The installed right-click menu launches the native progress window, which supplies `--gui` when starting its hidden worker.

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
