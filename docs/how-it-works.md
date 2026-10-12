# How DiscordShrinker Works

This document covers the parts hidden behind the right-click menu: how DiscordShrinker chooses a compression strategy, calculates bitrates, runs FFmpeg, and reports progress.

## What it uses

- **Bun and TypeScript** for the application. Bun compiles the project into the standalone `DiscordShrinker.exe` included in a release.
- **FFprobe** to read the video's duration, file size, resolution, frame rate, and audio information.
- **FFmpeg** to scale and encode the video.
- **SVT-AV1 (`libsvtav1`)** for size-controlled video encoding.
- **Opus (`libopus`)** for size-controlled audio encoding.
- **PowerShell and Windows Forms** for installation, context-menu management, and the progress window.
- **The current user's Windows registry** for the Explorer context-menu entries and Extras Manager settings. Administrator access is not required for those entries.

DiscordShrinker accepts any input format that the installed FFmpeg build can read, but its normal compressed output is an MP4 file.

## Processing flow

When a video is passed to DiscordShrinker, it does the following:

1. Reads the input path and target size. The target defaults to 20 MiB.
2. Checks that `ffmpeg`, `ffprobe`, `libsvtav1`, and `libopus` are available.
3. Checks the input file size. If it already fits, nothing is encoded.
4. Uses FFprobe to inspect the video.
5. Decides whether to keep the original resolution or scale it down.
6. Encodes the video and checks the actual output size.
7. If the output is too large, adjusts the bitrate and tries again, up to three two-pass attempts.
8. Saves the result beside the source as `<original name>_shrunk.mp4`.

The source file is never modified. FFmpeg is run with overwrite enabled, so an existing `_shrunk.mp4` output with the same name is replaced.

## Target size and bitrate budget

The menus use MB in their labels, while the program calculates targets in MiB: one MiB is 1,048,576 bytes.

DiscordShrinker reserves 512 KiB of the selected target for the MP4 container and metadata. It then works out how many bits per second are available over the video's duration:

```text
available bitrate = ((target bytes - 512 KiB) × 8 ÷ duration) - audio bitrate
video bitrate     = available bitrate × 0.95
```

The extra 5% margin accounts for normal bitrate variation. Audio keeps its existing bitrate up to a maximum of 96 kbit/s; videos without an audio stream remain silent.

Targets must be larger than the 512 KiB metadata reserve. The `--targetMb` option therefore rejects values at or below 0.5 MiB.

## Deciding when to scale down

Scaling is based on **compression pressure**. This compares the bitrate available for each pixel and frame against a reference case: a 30-second, 1080p60 video targeting 20 MiB.

- A pressure of `1` matches the reference case.
- A value at or below `1` keeps the original resolution.
- A value above `1` means the video would have less data available per pixel and frame than the reference, so DiscordShrinker scales it down before the final encode.

Because the calculation includes duration, resolution, frame rate, and target size, a large target such as 500 MiB can keep the original resolution of a short video while a smaller target may need scaling for the same video.

Videos that are already 1280×720 or smaller are never scaled down further by this decision.

### Scale targets

- Videos with a long edge of 3840 pixels or more are limited to 1920×1080.
- Other videos selected for scaling are limited to 1280×720.
- Portrait videos use the corresponding portrait dimensions.
- Aspect ratio is preserved, dimensions are kept divisible by two, and smaller videos are never enlarged.

## Encoding paths

### Original-resolution two-pass encoding

When scaling is unnecessary, DiscordShrinker runs a two-pass SVT-AV1 encode at the original resolution:

1. The first pass analyzes the video without producing a media file or encoding audio.
2. The second pass writes the MP4 using `libsvtav1` for video and constrained-variable-bitrate `libopus` for audio.

Pass data is stored in a unique temporary directory and removed when the attempt finishes.

### Scaling and two-pass encoding

When scaling is selected, DiscordShrinker first tries a straightforward FFmpeg downscale and checks its size. If that output already fits, it is kept.

If it is still too large, DiscordShrinker runs the two-pass AV1/Opus process from the original input with the scale filter included. This avoids using the first scaled output as the source for another encode.

If all size-controlled attempts still miss the target and the source is above 30 FPS, it makes one final set of attempts with the frame rate limited to 30 FPS. Sources already at or below 30 FPS are not reduced further.

### Retries

Each two-pass sequence can make up to three attempts. After an oversized result, the next video bitrate is scaled according to how far the output exceeded the limit, with another 2% safety margin:

```text
next bitrate = previous bitrate × (target size ÷ actual size) × 0.98
```

The retry label is only shown after the first attempt fails.

## Progress and debug modes

DiscordShrinker has two output modes.

### Terminal/debug mode

This is the default when the executable or source file is run directly. The terminal shows application debug messages, spawned commands, and FFmpeg output.

The Extras Manager can put all context-menu compression entries into this mode. In that case, Explorer launches `DiscordShrinker.exe` directly without the GUI flag.

### Progress-window mode

The default context-menu setup launches `scripts/gui.ps1`. That script:

1. Creates a temporary JSON-lines progress file.
2. Starts a hidden DiscordShrinker worker with `--gui <progress-file>`.
3. Displays stage and percentage updates in a small Windows Forms window.
4. Shows worker errors in a dialog, or closes the window shortly after success.
5. Removes the temporary progress file when the window closes.

In GUI mode, FFmpeg emits machine-readable progress about four times per second. DiscordShrinker converts FFmpeg's processed timestamp into a value from 0 to 100% using the video's duration.

The `--gui` option is mainly an internal channel between the PowerShell window and the worker executable. Supplying it directly disables terminal debug output and writes progress events to the given file.

## Windows context-menu integration

The installer copies the release into `%LOCALAPPDATA%\DiscordShrinker` and registers two entries under the current user's `Software\Classes\*\shell` registry path:

- **Shrink for Discord** targets 20 MiB.
- **Shrink For Discord Extra** contains the configured size choices and **Customize...**.

The Extras Manager stores each size as an ordered registry subkey. It can add or remove any size, restore 8, 10, 20, 50, 100, and 500 MiB defaults, and switch every compression command between GUI and debug mode. The selected mode is stored in the registry and is preserved if the installer is run again.

Uninstalling removes both context-menu trees and the application directory. FFmpeg is deliberately left installed because it may have existed before DiscordShrinker or may be used by another application.

## Source layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Main processing flow and success/error handling |
| `src/modules/cli.ts` | Command-line parsing and target validation |
| `src/modules/ffmpeg/probe.ts` | File-size checks and FFprobe metadata parsing |
| `src/modules/ffmpeg/index.ts` | FFmpeg validation and compression-strategy selection |
| `src/modules/ffmpeg/encode.ts` | Scaling, bitrate calculations, two-pass encoding, and retries |
| `src/modules/cmd.ts` | Child-process execution and FFmpeg progress parsing |
| `src/modules/progress.ts` | JSON-lines progress events for the GUI |
| `scripts/gui.ps1` | Native Windows progress window and hidden worker launch |
| `scripts/extras-manager.ps1` | Custom size and GUI/debug-mode management |
| `scripts/install.ps1` | File installation, FFmpeg setup, and registry registration |
| `bundle.ts` | Assembly of the distributable `release` directory |
