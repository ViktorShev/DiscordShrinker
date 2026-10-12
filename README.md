# DiscordShrinker

DiscordShrinker compresses videos to a size you can upload to Discord. It adds a right-click menu to Windows and targets the 20mb free limit by default (as of writing).

It keeps the original resolution when it can. For tighter size limits, it scales 4K video to 1080p or 1080p video to 720p. Determined via a relation between bitrate, resolution and FPS.

The compressed copy is saved next to the original as `<name>_shrunk.mp4`.

For a detailed explanation of all the features and technical breakdown, see [How DiscordShrinker works](docs/how-it-works.md).

## Installation

Download and extract the [latest release](https://github.com/ViktorShev/DiscordShrinker/releases), then run `install.bat`.

The installer copies DiscordShrinker to `%LOCALAPPDATA%\DiscordShrinker`, adds the right-click menu, and installs FFmpeg through `winget` if it is missing (uses your local FFmpeg installation instead if present).

On Windows 11, the shrinker's menu is under **Show more options**.

## Usage

Right-click any video and click on **Shrink for Discord** to target the default free limit. Its target limit can be changed through **Customize...**.

If you want to target a different limit, hover over **Shrink For Discord Extra**, it will open a submenu with the default options of 8, 10, 20, 50, 100, and 500mb.

There is also the **Customize...** option, used to add or remove limits, change the default limit, restore the default limits and 20 MB target, or switch context-menu executions between the progress window and debug terminal output.

Files that are already below the limit are not processed.

### Command line

```
DiscordShrinker.exe <file-path> [--targetMb <megabytes>] [--gui <progress-file>]
```

| Flag | Description |
|---|---|
| `--targetMb <megabytes>` | Set the maximum output file size in MB (defaults to 20) |
| `--gui <progress-file>` | Writes JSONL progress events to the supplied file and disables terminal debug output. Used by the Windows Forms progress window when launching its worker process. |

Command-line execution shows FFmpeg progress and debug output in the terminal by default.

Context-menu execution is set up to automatically provide the `--gui` flag.

## Building from source

Requires [Bun](https://bun.sh) and [FFmpeg](https://ffmpeg.org).

```bash
bun install
bun run compile
bun run bundle
```

To run from source without compiling

```bash
bun src/index.ts <file-path> [--targetMb <megabytes>]
```

## Uninstalling

Run `uninstall.bat` found in the installation folder.
