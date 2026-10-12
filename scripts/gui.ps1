#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string]$TargetMb = '20',

    [string]$ExecutablePath,

    [string]$EntryScript
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Split-Path -Parent $ScriptDir

if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
    $ExecutablePath = Join-Path $InstallDir 'DiscordShrinker.exe'
}

function Quote-ProcessArgument {
    param([string]$Value)

    # These values are file paths, flags, or validated numbers. Windows file paths
    # cannot contain a quote, so wrapping each value is sufficient here.
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Show-StartupError {
    param([string]$Message)

    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'DiscordShrinker',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    Show-StartupError "DiscordShrinker could not find its executable at:`n$ExecutablePath"
    exit 1
}

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    Show-StartupError "The selected file no longer exists:`n$FilePath"
    exit 1
}

$progressFilePath = Join-Path ([System.IO.Path]::GetTempPath()) ("discordshrinker-progress-{0}.jsonl" -f [guid]::NewGuid())
[System.IO.File]::WriteAllText($progressFilePath, '')
$progressStream = [System.IO.FileStream]::new(
    $progressFilePath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite
)
$progressReader = [System.IO.StreamReader]::new($progressStream, [System.Text.Encoding]::UTF8)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'DiscordShrinker'
$form.ClientSize = New-Object System.Drawing.Size(460, 154)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ShowInTaskbar = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$iconPaths = @(
    (Join-Path $InstallDir 'icon.ico'),
    (Join-Path $InstallDir 'assets\icon.ico')
)
$iconPath = $iconPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -ne $iconPath) {
    $form.Icon = New-Object System.Drawing.Icon([string]$iconPath)
}

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Location = New-Object System.Drawing.Point(18, 16)
$titleLabel.Size = New-Object System.Drawing.Size(424, 22)
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$titleLabel.Text = [System.IO.Path]::GetFileName($FilePath)
$titleLabel.AutoEllipsis = $true
$form.Controls.Add($titleLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Location = New-Object System.Drawing.Point(18, 45)
$statusLabel.Size = New-Object System.Drawing.Size(350, 20)
$statusLabel.Text = 'Starting...'
$statusLabel.AutoEllipsis = $true
$form.Controls.Add($statusLabel)

$percentLabel = New-Object System.Windows.Forms.Label
$percentLabel.Location = New-Object System.Drawing.Point(374, 45)
$percentLabel.Size = New-Object System.Drawing.Size(68, 20)
$percentLabel.TextAlign = [System.Drawing.ContentAlignment]::TopRight
$percentLabel.Text = ''
$form.Controls.Add($percentLabel)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(18, 72)
$progressBar.Size = New-Object System.Drawing.Size(424, 23)
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
$progressBar.MarqueeAnimationSpeed = 25
$form.Controls.Add($progressBar)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Location = New-Object System.Drawing.Point(367, 110)
$closeButton.Size = New-Object System.Drawing.Size(75, 28)
$closeButton.Text = 'Close'
$closeButton.Visible = $false
$closeButton.Enabled = $false
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

$workerArguments = New-Object System.Collections.Generic.List[string]
if (-not [string]::IsNullOrWhiteSpace($EntryScript)) {
    $workerArguments.Add($EntryScript)
}
$workerArguments.Add($FilePath)
$workerArguments.Add('--targetMb')
$workerArguments.Add($TargetMb)
$workerArguments.Add('--gui')
$workerArguments.Add($progressFilePath)

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $ExecutablePath
$startInfo.Arguments = (($workerArguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
$startInfo.WorkingDirectory = $InstallDir
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo

$state = @{
    ResultType = $null
    ResultMessage = $null
    Finalized = $false
    CloseAt = $null
}

function Set-ProgressMode {
    param([bool]$Determinate)

    if ($Determinate) {
        $progressBar.MarqueeAnimationSpeed = 0
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        $progressBar.Value = 0
        $percentLabel.Text = '0%'
    } else {
        $percentLabel.Text = ''
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
        $progressBar.MarqueeAnimationSpeed = 25
    }
}

function Read-ProgressEvents {
    while ($null -ne ($line = $progressReader.ReadLine())) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        try {
            $event = $line | ConvertFrom-Json
        } catch {
            continue
        }

        switch ($event.type) {
            'stage' {
                $statusLabel.Text = [string]$event.message
                Set-ProgressMode ([bool]$event.determinate)
            }
            'progress' {
                $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
                $progressBar.MarqueeAnimationSpeed = 0
                $percent = [Math]::Max(0, [Math]::Min(100, [int][Math]::Round(([double]$event.value) * 100)))
                $progressBar.Value = $percent
                $percentLabel.Text = "$percent%"
            }
            'success' {
                $state.ResultType = 'success'
                $state.ResultMessage = [string]$event.message
            }
            'error' {
                $state.ResultType = 'error'
                $state.ResultMessage = [string]$event.message
            }
        }
    }
}

function Complete-Window {
    if ($state.Finalized) {
        return
    }

    $state.Finalized = $true
    $form.ControlBox = $true
    $closeButton.Visible = $true
    $closeButton.Enabled = $true

    if ($state.ResultType -eq 'success' -or ($null -eq $state.ResultType -and $process.ExitCode -eq 0)) {
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        $progressBar.MarqueeAnimationSpeed = 0
        $progressBar.Value = 100
        $percentLabel.Text = '100%'
        $statusLabel.Text = if ($state.ResultMessage) { $state.ResultMessage } else { 'Video compressed successfully!' }
        $state.CloseAt = [DateTime]::UtcNow.AddSeconds(2)
        return
    }

    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $progressBar.MarqueeAnimationSpeed = 0
    $progressBar.Value = 0
    $percentLabel.Text = ''
    $statusLabel.Text = 'Compression failed.'

    $errorMessage = if ($state.ResultMessage) { $state.ResultMessage } else { "DiscordShrinker exited with code $($process.ExitCode)." }
    [System.Windows.Forms.MessageBox]::Show(
        $form,
        $errorMessage,
        'DiscordShrinker',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    Read-ProgressEvents

    if ($process.HasExited) {
        Complete-Window
    }

    if ($null -ne $state.CloseAt -and [DateTime]::UtcNow -ge $state.CloseAt) {
        $form.Close()
    }
})

$form.Add_Shown({
    try {
        $null = $process.Start()
        $timer.Start()
    } catch {
        $state.ResultType = 'error'
        $state.ResultMessage = $_.Exception.Message
        Complete-Window
    }
})

try {
    [System.Windows.Forms.Application]::Run($form)
} finally {
    $timer.Stop()
    $timer.Dispose()
    $process.Dispose()
    $progressReader.Dispose()
    $progressStream.Dispose()
    $form.Dispose()
    Remove-Item -LiteralPath $progressFilePath -Force -ErrorAction SilentlyContinue
}
