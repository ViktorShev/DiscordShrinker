#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName   = 'DiscordShrinker'
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir    = Split-Path -Parent $ScriptDir
$ExeSource          = Join-Path $RootDir 'DiscordShrinker.exe'
$IconSource         = Join-Path $RootDir 'assets\icon.ico'
$UninstallBatSource = Join-Path $RootDir 'uninstall.bat'
$UninstallPs1Source = Join-Path $ScriptDir 'uninstall.ps1'
$ExtrasBatSource = Join-Path $RootDir 'extras.bat'
$ExtrasPs1Source = Join-Path $ScriptDir 'extras.ps1'
$GuiPs1Source = Join-Path $ScriptDir 'gui.ps1'

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

if (-not (Test-Path $UninstallBatSource)) {
    Write-Fail "uninstall.bat not found next to the install script."
    exit 1
}

if (-not (Test-Path $UninstallPs1Source)) {
    Write-Fail "scripts\uninstall.ps1 not found next to the install script."
    exit 1
}

if (-not (Test-Path $ExtrasBatSource)) {
    Write-Fail "extras.bat not found next to the install script."
    exit 1
}

if (-not (Test-Path $ExtrasPs1Source)) {
    Write-Fail "scripts\extras.ps1 not found next to the install script."
    exit 1
}

if (-not (Test-Path $GuiPs1Source)) {
    Write-Fail "scripts\gui.ps1 not found next to the install script."
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
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'scripts') | Out-Null
Copy-Item -Path $ExeSource          -Destination $InstallDir -Force
Copy-Item -Path $IconSource         -Destination $InstallDir -Force
Copy-Item -Path $UninstallBatSource -Destination $InstallDir -Force
Copy-Item -Path $UninstallPs1Source -Destination (Join-Path $InstallDir 'scripts') -Force
Copy-Item -Path $ExtrasBatSource -Destination $InstallDir -Force
Copy-Item -Path $ExtrasPs1Source -Destination (Join-Path $InstallDir 'scripts') -Force
Copy-Item -Path $GuiPs1Source -Destination (Join-Path $InstallDir 'scripts') -Force

$ExePath                            = Join-Path $InstallDir 'DiscordShrinker.exe'
$IconPath                           = Join-Path $InstallDir 'icon.ico'
$ExtrasBatPath                    = Join-Path $InstallDir 'extras.bat'
$GuiPs1Path                        = Join-Path $InstallDir 'scripts\gui.ps1'

function Get-ShrinkCommand {
    param(
        [string]$TargetMb,
        [bool]$GuiEnabled
    )

    if ($GuiEnabled) {
        return "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File `"$GuiPs1Path`" -FilePath `"%1`" -TargetMb $TargetMb"
    }

    return "`"$ExePath`" `"%1`" --targetMb $TargetMb"
}

Write-Ok "Files copied."

# Register right-click context menu

Write-Step "Adding DiscordShrinker options to the right-click menu..."

$classesKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
$extraKey = $classesKey.CreateSubKey('*\shell\ShrinkForDiscordExtra')
$extraKey.SetValue('MUIVerb', 'Shrink For Discord Extra')
$extraKey.SetValue('Icon', $IconPath)
$extraKey.SetValue('SubCommands', '')

$guiEnabledValue = $extraKey.GetValue('GuiEnabled')
$guiEnabled = if ($null -eq $guiEnabledValue) { $true } else { [int]$guiEnabledValue -ne 0 }
$extraKey.SetValue('GuiEnabled', [int]$guiEnabled, [Microsoft.Win32.RegistryValueKind]::DWord)

$defaultTargetMbValue = [string]$extraKey.GetValue('DefaultTargetMb')
$parsedDefaultTargetMb = 0.0
$defaultTargetIsValid = [double]::TryParse(
    $defaultTargetMbValue,
    [System.Globalization.NumberStyles]::Float,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [ref]$parsedDefaultTargetMb
) -and $parsedDefaultTargetMb -gt 0.5
$defaultTargetMb = if ($defaultTargetIsValid) {
    $parsedDefaultTargetMb.ToString('0.###############', [System.Globalization.CultureInfo]::InvariantCulture)
} else {
    '20'
}
$extraKey.SetValue('DefaultTargetMb', $defaultTargetMb, [Microsoft.Win32.RegistryValueKind]::String)

$shellKey = $classesKey.CreateSubKey('*\shell\ShrinkForDiscord')
$shellKey.SetValue('', 'Shrink for Discord')
$shellKey.SetValue('Icon', $IconPath)
$cmdKey = $shellKey.CreateSubKey('command')
$cmdKey.SetValue('', (Get-ShrinkCommand $defaultTargetMb $guiEnabled))
$cmdKey.Close()
$shellKey.Close()

$extraShellKey = $extraKey.CreateSubKey('shell')

$optionsInitialized = $extraKey.GetValue('OptionsInitialized')
$existingOptionKeyNames = @($extraShellKey.GetSubKeyNames() | Where-Object { $_ -ne 'zz_Customize' })

if ($null -eq $optionsInitialized -and $existingOptionKeyNames.Count -eq 0) {
    $targetSizesMb = @(8, 10, 20, 50, 100, 500)

    for ($index = 0; $index -lt $targetSizesMb.Count; $index++) {
        $targetMb = $targetSizesMb[$index]
        $optionKeyName = '{0:D4}_Target' -f ($index + 1)
        $optionKey = $extraShellKey.CreateSubKey($optionKeyName)
        $optionKey.SetValue('MUIVerb', "$targetMb MB")
        $optionKey.SetValue('TargetMb', [string]$targetMb)
        $optionCommandKey = $optionKey.CreateSubKey('command')
        $optionCommandKey.SetValue('', (Get-ShrinkCommand ([string]$targetMb) $guiEnabled))
        $optionCommandKey.Close()
        $optionKey.Close()
    }
}

$extraKey.SetValue('OptionsInitialized', 1, [Microsoft.Win32.RegistryValueKind]::DWord)

$customizeKey = $extraShellKey.CreateSubKey('zz_Customize')
$customizeKey.SetValue('MUIVerb', 'Customize...')
$customizeCommandKey = $customizeKey.CreateSubKey('command')
$customizeCommandKey.SetValue('', "cmd.exe /d /c `"`"$ExtrasBatPath`"`"")
$customizeCommandKey.Close()
$customizeKey.Close()

$extraShellKey.Close()
$extraKey.Close()
$classesKey.Close()

Write-Ok "Context menu entries registered."

# Done

Write-Host ""
Write-Host "  All done! Right-click any video file and choose" -ForegroundColor White
Write-Host "  'Shrink for Discord' to compress it." -ForegroundColor White
Write-Host "  Use 'Shrink For Discord Extra' for another target size." -ForegroundColor White
Write-Host "  Choose 'Customize...' there to manage extra options." -ForegroundColor White
Write-Host ""
Write-Host "  Note: You can now delete these installation files if you wish." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press any key to exit..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
