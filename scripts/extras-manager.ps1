#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppName = 'DiscordShrinker'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Split-Path -Parent $ScriptDir
$ExePath = Join-Path $InstallDir 'DiscordShrinker.exe'
$IconPath = Join-Path $InstallDir 'icon.ico'
$ExtrasManagerBatPath = Join-Path $InstallDir 'extras-manager.bat'
$GuiPs1Path = Join-Path $ScriptDir 'gui.ps1'
$MainMenuRegistryPath = '*\shell\ShrinkForDiscord'
$ExtraMenuRegistryPath = '*\shell\ShrinkForDiscordExtra'
$MinimumTargetMb = 0.5
$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture
$DefaultTargetSizesMb = @('8', '10', '20', '50', '100', '500')

function Write-Step { param($Text) Write-Host "  > $Text" -ForegroundColor Cyan }
function Write-Ok   { param($Text) Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Fail { param($Text) Write-Host "  [!!] $Text" -ForegroundColor Red }

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

function Write-MainShrinkCommand {
    param(
        [Microsoft.Win32.RegistryKey]$MainKey,
        [bool]$GuiEnabled
    )

    $commandKey = $MainKey.CreateSubKey('command')
    $commandKey.SetValue('', (Get-ShrinkCommand '20' $GuiEnabled))
    $commandKey.Close()
}

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
        if ($subKeyName -eq 'zz_Customize') {
            continue
        }

        $optionKey = $ExtraShellKey.OpenSubKey($subKeyName)
        if ($null -eq $optionKey) {
            continue
        }

        try {
            $targetMb = ConvertTo-TargetMb ([string]$optionKey.GetValue('TargetMb'))

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
        [string[]]$TargetSizesMb,
        [bool]$GuiEnabled
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
        $commandKey.SetValue('', (Get-ShrinkCommand $targetMb $GuiEnabled))
        $commandKey.Close()
        $optionKey.Close()
    }

    $customizeKey = $ExtraShellKey.CreateSubKey('zz_Customize')
    $customizeKey.SetValue('MUIVerb', 'Customize...')
    $customizeCommandKey = $customizeKey.CreateSubKey('command')
    $customizeCommandKey.SetValue('', "cmd.exe /d /c `"`"$ExtrasManagerBatPath`"`"")
    $customizeCommandKey.Close()
    $customizeKey.Close()
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
        [string[]]$TargetSizesMb,
        [bool]$GuiEnabled
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

    Write-ExtraFileSizeOptions $ExtraShellKey $updatedOptions.ToArray() $GuiEnabled
    return New-ActionResult "Added $targetMb MB at position $position." $true
}

function Remove-ExtraFileSizeOption {
    param(
        [Microsoft.Win32.RegistryKey]$ExtraShellKey,
        [string[]]$TargetSizesMb,
        [bool]$GuiEnabled
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

    Write-ExtraFileSizeOptions $ExtraShellKey $updatedOptions.ToArray() $GuiEnabled
    return New-ActionResult "Removed $removedTargetMb MB." $true
}

function Restore-DefaultExtraFileSizeOptions {
    param(
        [Microsoft.Win32.RegistryKey]$ExtraShellKey,
        [bool]$GuiEnabled
    )

    Write-Host ""
    $confirmation = (Read-Host '  Remove all current options and restore the defaults? (y/N)').Trim()
    if ($confirmation -ne 'Y') {
        return New-ActionResult 'Revert canceled; no changes were made.' $true
    }

    Write-ExtraFileSizeOptions $ExtraShellKey $DefaultTargetSizesMb $GuiEnabled
    return New-ActionResult 'Restored the default options: 8, 10, 20, 50, 100, and 500 MB.' $true
}

if (-not (Test-Path $ExePath)) {
    Write-Fail "$AppName is not installed in $InstallDir."
    Write-Host ""
    Read-Host '  Press Enter to exit'
    exit 1
}

if (-not (Test-Path $GuiPs1Path)) {
    Write-Fail "The GUI script is missing from $ScriptDir. Reinstall $AppName."
    Write-Host ""
    Read-Host '  Press Enter to exit'
    exit 1
}

$classesKey = $null
$mainKey = $null
$extraKey = $null
$extraShellKey = $null

try {
    $classesKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
    if ($null -eq $classesKey) {
        throw 'Could not open the current user registry classes key.'
    }

    $mainKey = $classesKey.CreateSubKey($MainMenuRegistryPath)
    $mainKey.SetValue('', 'Shrink for Discord')
    $mainKey.SetValue('Icon', $IconPath)

    $extraKey = $classesKey.CreateSubKey($ExtraMenuRegistryPath)
    $extraKey.SetValue('MUIVerb', 'Shrink For Discord Extra')
    $extraKey.SetValue('Icon', $IconPath)
    $extraKey.SetValue('SubCommands', '')
    $extraKey.SetValue('OptionsInitialized', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
    $extraShellKey = $extraKey.CreateSubKey('shell')

    $guiEnabledValue = $extraKey.GetValue('GuiEnabled')
    $guiEnabled = if ($null -eq $guiEnabledValue) { $true } else { [int]$guiEnabledValue -ne 0 }
    $extraKey.SetValue('GuiEnabled', [int]$guiEnabled, [Microsoft.Win32.RegistryValueKind]::DWord)

    # Repair all commands whenever the manager opens.
    $currentOptions = @(Get-ExtraFileSizeOptions $extraShellKey)
    Write-MainShrinkCommand $mainKey $guiEnabled
    Write-ExtraFileSizeOptions $extraShellKey $currentOptions $guiEnabled

    $lastAction = $null

    while ($true) {
        Clear-Host
        Write-Host ""
        Write-Host "  DiscordShrinker Extras Manager" -ForegroundColor White
        Write-Host "  --------------------------------" -ForegroundColor DarkGray

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
        Write-Host "    D. Revert to defaults"
        if ($guiEnabled) {
            Write-Host "    G. Disable GUI (enable debug mode)"
        } else {
            Write-Host "    G. Enable GUI (disable debug mode)"
        }
        Write-Host "    Q. Exit"
        Write-Host ""

        $action = (Read-Host '  Choose an action').Trim().ToUpperInvariant()

        switch ($action) {
            'A' { $lastAction = Add-ExtraFileSizeOption $extraShellKey $currentOptions $guiEnabled }
            'R' { $lastAction = Remove-ExtraFileSizeOption $extraShellKey $currentOptions $guiEnabled }
            'D' { $lastAction = Restore-DefaultExtraFileSizeOptions $extraShellKey $guiEnabled }
            'G' {
                $guiEnabled = -not $guiEnabled
                $extraKey.SetValue('GuiEnabled', [int]$guiEnabled, [Microsoft.Win32.RegistryValueKind]::DWord)
                Write-MainShrinkCommand $mainKey $guiEnabled
                Write-ExtraFileSizeOptions $extraShellKey $currentOptions $guiEnabled

                if ($guiEnabled) {
                    $lastAction = New-ActionResult 'GUI enabled; context-menu compression will use the progress window.' $true
                } else {
                    $lastAction = New-ActionResult 'GUI disabled; context-menu compression will run in debug mode.' $true
                }
            }
            'Q' { break }
            default { $lastAction = New-ActionResult 'Choose A, R, D, G, or Q.' $false }
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
    if ($null -ne $mainKey) { $mainKey.Close() }
    if ($null -ne $classesKey) { $classesKey.Close() }
}
