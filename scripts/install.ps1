#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName   = 'DiscordShrinker'
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExeSource  = Join-Path $ScriptDir 'DiscordShrinker.exe'
$IconSource = Join-Path $ScriptDir 'assets\icon.ico'

function Write-Step  { param($Text) Write-Host "  > $Text" -ForegroundColor Cyan }
function Write-Ok    { param($Text) Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Skip  { param($Text) Write-Host "  [--] $Text" -ForegroundColor DarkGray }
function Write-Fail  { param($Text) Write-Host "  [!!] $Text" -ForegroundColor Red }

Write-Host ""
Write-Host "  DiscordShrinker Installer" -ForegroundColor White
Write-Host "  -------------------------" -ForegroundColor DarkGray
Write-Host ""

# Validate bundled files

if (-not (Test-Path $ExeSource)) {
    Write-Fail "DiscordShrinker.exe not found next to the install script."
    exit 1
}

if (-not (Test-Path $IconSource)) {
    Write-Fail "assets\icon.ico not found next to the install script."
    exit 1
}

# Install FFmpeg via winget

Write-Step "Checking for FFmpeg..."

$ffmpegInstalled = $null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)

if ($ffmpegInstalled) {
    Write-Skip "FFmpeg is already installed, skipping."
} else {
    if ($null -eq (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Fail "winget is not available. Please install FFmpeg manually from https://ffmpeg.org and ensure it is on your PATH."
        exit 1
    }

    Write-Step "Installing FFmpeg via winget..."
    winget install ffmpeg --accept-source-agreements --accept-package-agreements

    if ($LASTEXITCODE -ne 0) {
        Write-Fail "FFmpeg installation failed. Please install it manually from https://ffmpeg.org."
        exit 1
    }

    Write-Ok "FFmpeg installed."
}

# Copy application files

Write-Step "Installing to $InstallDir..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $ExeSource  -Destination $InstallDir -Force
Copy-Item -Path $IconSource -Destination $InstallDir -Force

$ExePath  = Join-Path $InstallDir 'DiscordShrinker.exe'
$IconPath = Join-Path $InstallDir 'icon.ico'

Write-Ok "Files copied."

# Register right-click context menu

Write-Step "Adding 'Shrink for Discord' to the right-click menu..."

$classesKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
$shellKey    = $classesKey.CreateSubKey('*\shell\ShrinkForDiscord')
$shellKey.SetValue('', 'Shrink for Discord')
$shellKey.SetValue('Icon', $IconPath)
$cmdKey = $shellKey.CreateSubKey('command')
$cmdKey.SetValue('', "`"$ExePath`" `"%1`"")
$cmdKey.Close()
$shellKey.Close()
$classesKey.Close()

Write-Ok "Context menu entry registered."

# Done

Write-Host ""
Write-Host "  All done! Right-click any video file and choose" -ForegroundColor White
Write-Host "  'Shrink for Discord' to compress it." -ForegroundColor White
Write-Host ""
Write-Host "  Note: You can now delete these installation files if you wish." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press any key to exit..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
