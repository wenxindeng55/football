param(
    [string]$PythonPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $ProjectRoot "data\logs"
$StdoutLog = Join-Path $LogDir "collector.task.out.log"
$StderrLog = Join-Path $LogDir "collector.task.err.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not $PythonPath) {
    $ResolvedPython = (& python -c "import sys; print(sys.executable)").Trim()
    if ($LASTEXITCODE -eq 0 -and $ResolvedPython -and (Test-Path $ResolvedPython)) {
        $PythonPath = $ResolvedPython
    } else {
        $PythonCommand = Get-Command python -ErrorAction Stop
        $PythonPath = $PythonCommand.Source
    }
}

Set-Location $ProjectRoot
& $PythonPath -u "sgodds_collector.py" run 1>> $StdoutLog 2>> $StderrLog
