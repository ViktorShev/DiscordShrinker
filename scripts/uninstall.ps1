#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName    = 'DiscordShrinker'
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName

function Write-Step { param($Text) Write-Host "  > $Text" -ForegroundColor Cyan }
function Write-Ok   { param($Text) Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Skip { param($Text) Write-Host "  [--] $Text" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  DiscordShrinker Uninstaller" -ForegroundColor White
Write-Host "  ---------------------------" -ForegroundColor DarkGray
Write-Host ""

# Remove right-click context menu entry

Write-Step "Removing right-click context menu entry..."

$classesKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
$starKey    = $classesKey.OpenSubKey('*\shell', $true)

if ($null -ne $starKey -and $null -ne $starKey.OpenSubKey('ShrinkForDiscord')) {
    $starKey.DeleteSubKeyTree('ShrinkForDiscord')
    Write-Ok "Context menu entry removed."
} else {
    Write-Skip "Context menu entry not found, skipping."
}

if ($null -ne $starKey) { $starKey.Close() }
$classesKey.Close()

# Remove application files

Write-Step "Removing application files from $InstallDir..."

if (Test-Path $InstallDir) {
    Set-Location $env:TEMP
    $CleanupBat = Join-Path $env:TEMP 'discordshrinker_cleanup.bat'
    Set-Content -Path $CleanupBat -Value "@echo off`r`ntimeout /t 2 /nobreak > nul`r`nrd /s /q `"$InstallDir`"`r`ndel `"%~f0`""
    Start-Process -FilePath cmd -ArgumentList '/c', $CleanupBat -WindowStyle Hidden
    Write-Ok "Files will be removed on exit."
} else {
    Write-Skip "Install directory not found, skipping."
}

# Done

Write-Host ""
Write-Host "  DiscordShrinker has been uninstalled." -ForegroundColor White
Write-Host ""
Write-Host "  Note: FFmpeg was not removed, as it might have been previously installed by you or another application." -ForegroundColor DarkGray
Write-Host "  To uninstall FFmpeg, you can run the following command: winget uninstall ffmpeg" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press any key to exit..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
