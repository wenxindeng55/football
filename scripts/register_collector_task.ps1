param(
    [string]$TaskName = "SgoddsOddsCollector",
    [string]$PythonPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Runner = Join-Path $PSScriptRoot "run_collector_background.ps1"
$UserId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$HasExplicitPythonPath = [bool]$PythonPath

if (-not (Test-Path $Runner)) {
    throw "Background runner script not found: $Runner"
}

if (-not $PythonPath) {
    $ResolvedPython = (& python -c "import sys; print(sys.executable)").Trim()
    if ($LASTEXITCODE -eq 0 -and $ResolvedPython -and (Test-Path $ResolvedPython)) {
        $PythonPath = $ResolvedPython
    } else {
        $PythonCommand = Get-Command python -ErrorAction Stop
        $PythonPath = $PythonCommand.Source
    }
}

$PowerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$escapedRunner = $Runner.Replace('"', '\"')
$escapedPython = $PythonPath.Replace('"', '\"')
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$escapedRunner`""
if ($HasExplicitPythonPath) {
    $arguments = "$arguments -PythonPath `"$escapedPython`""
}

function Install-StartupShortcut {
    $StartupDir = [Environment]::GetFolderPath("Startup")
    $ShortcutPath = Join-Path $StartupDir "$TaskName.lnk"
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $PowerShellPath
    $Shortcut.Arguments = $arguments
    $Shortcut.WorkingDirectory = $ProjectRoot
    $Shortcut.WindowStyle = 7
    $Shortcut.Description = "sgodds odds collector background startup"
    $Shortcut.Save()
    return $ShortcutPath
}

$action = New-ScheduledTaskAction `
    -Execute $PowerShellPath `
    -Argument $arguments

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "sgodds odds collector background task. Lock screen does not stop it; sleep or logoff stops it." `
        -Force | Out-Null

    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Scheduled task registered and started: $TaskName"
} catch {
    $ShortcutPath = Install-StartupShortcut
    Start-Process -FilePath $PowerShellPath -ArgumentList $arguments -WindowStyle Hidden
    Write-Warning "Scheduled task registration failed. Startup shortcut installed instead: $ShortcutPath"
}

Write-Host "Lock screen will not stop collection. Sleep, hibernate, or logoff will stop it; it restarts after the next logon."
