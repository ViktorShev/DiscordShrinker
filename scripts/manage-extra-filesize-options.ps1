#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName = 'DiscordShrinker'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Split-Path -Parent $ScriptDir
$ExePath = Join-Path $InstallDir 'DiscordShrinker.exe'
$IconPath = Join-Path $InstallDir 'icon.ico'
$ManagerBatPath = Join-Path $InstallDir 'manage-extra-filesize-options.bat'
$ExtraMenuRegistryPath = '*\shell\ShrinkForDiscordExtra'
$MinimumTargetMb = 0.5
$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

function Write-Step { param($Text) Write-Host "  > $Text" -ForegroundColor Cyan }
function Write-Ok   { param($Text) Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Fail { param($Text) Write-Host "  [!!] $Text" -ForegroundColor Red }

function New-ActionResult {
    param(
        [string]$Message,
        [bool]$Succeeded
    )

    return [PSCustomObject]@{
        Message = $Message
        Succeeded = $Succeeded
    }
}

function ConvertTo-TargetMb {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $normalizedText = $Text.Trim().Replace(',', '.')
    $targetMb = 0.0
    $parsed = [double]::TryParse(
        $normalizedText,
        [System.Globalization.NumberStyles]::Float,
        $InvariantCulture,
        [ref]$targetMb
    )

    if (-not $parsed -or [double]::IsNaN($targetMb) -or [double]::IsInfinity($targetMb) -or $targetMb -le $MinimumTargetMb) {
        return $null
    }

    return $targetMb.ToString('0.###############', $InvariantCulture)
}

function Get-ExtraFileSizeOptions {
    param([Microsoft.Win32.RegistryKey]$ExtraShellKey)

    $targetSizesMb = @()

    foreach ($subKeyName in ($ExtraShellKey.GetSubKeyNames() | Sort-Object)) {
        if ($subKeyName -eq 'zz_AddCustom') {
            continue
        }

        $optionKey = $ExtraShellKey.OpenSubKey($subKeyName)
        if ($null -eq $optionKey) {
            continue
        }

        try {
            $targetMb = ConvertTo-TargetMb ([string]$optionKey.GetValue('TargetMb'))

            # Support options created by an older installer that did not store TargetMb.
            if ($null -eq $targetMb) {
                $label = [string]$optionKey.GetValue('MUIVerb')
                if ($label -match '^\s*([0-9]+(?:[\.,][0-9]+)?)\s*MB\s*$') {
                    $targetMb = ConvertTo-TargetMb $Matches[1]
                }
            }

            if ($null -ne $targetMb) {
                $targetSizesMb += $targetMb
            }
        } finally {
            $optionKey.Close()
        }
    }

    return $targetSizesMb
}

function Write-ExtraFileSizeOptions {
    param(
        [Microsoft.Win32.RegistryKey]$ExtraShellKey,
        [string[]]$TargetSizesMb
    )

    foreach ($subKeyName in $ExtraShellKey.GetSubKeyNames()) {
        $ExtraShellKey.DeleteSubKeyTree($subKeyName)
    }

    for ($index = 0; $index -lt $TargetSizesMb.Count; $index++) {
        $targetMb = $TargetSizesMb[$index]
        $optionKeyName = '{0:D4}_Target' -f ($index + 1)
        $optionKey = $ExtraShellKey.CreateSubKey($optionKeyName)
        $optionKey.SetValue('MUIVerb', "$targetMb MB")
        $optionKey.SetValue('TargetMb', $targetMb)
        $commandKey = $optionKey.CreateSubKey('command')
        $commandKey.SetValue('', "`"$ExePath`" `"%1`" --targetMb $targetMb")
        $commandKey.Close()
        $optionKey.Close()
    }

    $addCustomKey = $ExtraShellKey.CreateSubKey('zz_AddCustom')
    $addCustomKey.SetValue('MUIVerb', 'Add custom...')
    $addCustomCommandKey = $addCustomKey.CreateSubKey('command')
    $addCustomCommandKey.SetValue('', "cmd.exe /d /c `"`"$ManagerBatPath`"`"")
    $addCustomCommandKey.Close()
    $addCustomKey.Close()
}

function Show-CurrentOptions {
    param([string[]]$TargetSizesMb)

    Write-Host ""
    Write-Host "  Current extra file size options:" -ForegroundColor White

    if ($TargetSizesMb.Count -eq 0) {
        Write-Host "    (none)" -ForegroundColor DarkGray
        return
    }

    for ($index = 0; $index -lt $TargetSizesMb.Count; $index++) {
        Write-Host "    $($index + 1). $($TargetSizesMb[$index]) MB"
    }
}

function Add-ExtraFileSizeOption {
    param(
        [Microsoft.Win32.RegistryKey]$ExtraShellKey,
        [string[]]$TargetSizesMb
    )

    Write-Host ""
    $targetInput = Read-Host '  Target file size in MB'
    $targetMb = ConvertTo-TargetMb $targetInput

    if ($null -eq $targetMb) {
        return New-ActionResult "Target size must be a number greater than $MinimumTargetMb MB." $false
    }

    $targetValue = [double]::Parse($targetMb, $InvariantCulture)
    foreach ($existingTargetMb in $TargetSizesMb) {
        if ([double]::Parse($existingTargetMb, $InvariantCulture) -eq $targetValue) {
            return New-ActionResult "$targetMb MB is already in the menu." $false
        }
    }

    $defaultPosition = $TargetSizesMb.Count + 1
    $positionInput = Read-Host "  Menu position (1-$defaultPosition, press Enter for $defaultPosition)"
    $position = $defaultPosition

    if (-not [string]::IsNullOrWhiteSpace($positionInput)) {
        $parsedPosition = 0
        if (-not [int]::TryParse($positionInput, [ref]$parsedPosition) -or $parsedPosition -lt 1 -or $parsedPosition -gt $defaultPosition) {
            return New-ActionResult "Position must be a whole number from 1 to $defaultPosition." $false
        }

        $position = $parsedPosition
    }

    $updatedOptions = [System.Collections.Generic.List[string]]::new()
    foreach ($existingTargetMb in $TargetSizesMb) {
        $updatedOptions.Add($existingTargetMb)
    }
    $updatedOptions.Insert($position - 1, $targetMb)

    Write-ExtraFileSizeOptions $ExtraShellKey $updatedOptions.ToArray()
    return New-ActionResult "Added $targetMb MB at position $position." $true
}

function Remove-ExtraFileSizeOption {
    param(
        [Microsoft.Win32.RegistryKey]$ExtraShellKey,
        [string[]]$TargetSizesMb
    )

    if ($TargetSizesMb.Count -eq 0) {
        return New-ActionResult 'There are no file size options to remove.' $false
    }

    Write-Host ""
    $selectionInput = Read-Host "  Option to remove (1-$($TargetSizesMb.Count))"
    $selection = 0

    if (-not [int]::TryParse($selectionInput, [ref]$selection) -or $selection -lt 1 -or $selection -gt $TargetSizesMb.Count) {
        return New-ActionResult "Selection must be a whole number from 1 to $($TargetSizesMb.Count)." $false
    }

    $updatedOptions = [System.Collections.Generic.List[string]]::new()
    foreach ($targetMb in $TargetSizesMb) {
        $updatedOptions.Add($targetMb)
    }

    $removedTargetMb = $updatedOptions[$selection - 1]
    $updatedOptions.RemoveAt($selection - 1)

    Write-ExtraFileSizeOptions $ExtraShellKey $updatedOptions.ToArray()
    return New-ActionResult "Removed $removedTargetMb MB." $true
}

if (-not (Test-Path $ExePath)) {
    Write-Fail "$AppName is not installed in $InstallDir."
    Write-Host ""
    Read-Host '  Press Enter to exit'
    exit 1
}

$classesKey = $null
$extraKey = $null
$extraShellKey = $null

try {
    $classesKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -eq $classesKey) {
        throw 'Could not open the current user registry classes key.'
    }

    $extraKey = $classesKey.CreateSubKey($ExtraMenuRegistryPath)
    $extraKey.SetValue('MUIVerb', 'Shrink For Discord Extra')
    $extraKey.SetValue('Icon', $IconPath)
    $extraKey.SetValue('SubCommands', '')
    $extraKey.SetValue('OptionsInitialized', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
    $extraShellKey = $extraKey.CreateSubKey('shell')

    # Repair or add the management command whenever the manager opens.
    $currentOptions = @(Get-ExtraFileSizeOptions $extraShellKey)
    Write-ExtraFileSizeOptions $extraShellKey $currentOptions

    $lastAction = $null

    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "  DiscordShrinker Extra Size Options" -ForegroundColor White
        Write-Host "  ----------------------------------" -ForegroundColor DarkGray

        if ($null -ne $lastAction) {
            Write-Host ""
            if ($lastAction.Succeeded) {
                Write-Ok $lastAction.Message
            } else {
                Write-Fail $lastAction.Message
            }
        }

        $currentOptions = @(Get-ExtraFileSizeOptions $extraShellKey)
        Show-CurrentOptions $currentOptions
        Write-Host ""
        Write-Host "    A. Add a custom size"
        Write-Host "    R. Remove a size"
        Write-Host "    Q. Exit"
        Write-Host ""

        $action = (Read-Host '  Choose an action').Trim().ToUpperInvariant()

        switch ($action) {
            'A' { $lastAction = Add-ExtraFileSizeOption $extraShellKey $currentOptions }
            'R' { $lastAction = Remove-ExtraFileSizeOption $extraShellKey $currentOptions }
            'Q' { break }
            default { $lastAction = New-ActionResult 'Choose A, R, or Q.' $false }
        }

        if ($action -eq 'Q') {
            break
        }
    }
} catch {
    Write-Fail $_.Exception.Message
    Write-Host ""
    Read-Host '  Press Enter to exit'
    exit 1
} finally {
    if ($null -ne $extraShellKey) { $extraShellKey.Close() }
    if ($null -ne $extraKey) { $extraKey.Close() }
    if ($null -ne $classesKey) { $classesKey.Close() }
}
