$ErrorActionPreference = 'Stop'

$exe = Join-Path (Resolve-Path 'release\win-unpacked') 'MockMate.exe'
if (-not (Test-Path $exe)) { throw "Packaged MockMate executable missing: $exe" }

$pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
$expectLocalBackend = [string]::IsNullOrWhiteSpace([string]$pkg.managedApiBase)
$apiReady = $false
$backendReady = -not $expectLocalBackend
$proc = $null

Write-Host "Launching packaged MockMate runtime: $exe"
Write-Host "Local account backend required: $expectLocalBackend"

try {
  $proc = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds(45)

  while ((Get-Date) -lt $deadline) {
    $proc.Refresh()
    if ($proc.HasExited) { throw "Packaged MockMate exited before services became ready (exit $($proc.ExitCode))." }

    if (-not $apiReady) {
      try {
        $response = Invoke-WebRequest 'http://127.0.0.1:3002/' -UseBasicParsing -TimeoutSec 2
        $apiReady = $response.StatusCode -eq 200
      } catch {}
    }

    if ($expectLocalBackend -and -not $backendReady) {
      try {
        $health = Invoke-RestMethod 'http://127.0.0.1:4000/health' -TimeoutSec 2
        $backendReady = $health.ok -eq $true
      } catch {}
    }

    if ($apiReady -and $backendReady) { break }
    Start-Sleep -Milliseconds 500
  }

  if (-not $apiReady) { throw 'Packaged local UI/API service did not become ready on 127.0.0.1:3002.' }
  if (-not $backendReady) { throw 'Packaged local account service did not become ready on 127.0.0.1:4000.' }

  Write-Host 'Packaged Windows runtime smoke passed: executable stayed alive and required local services became ready.'
} finally {
  if ($proc) {
    try {
      $proc.Refresh()
      if (-not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F | Out-Null }
    } catch {}
  }
}
