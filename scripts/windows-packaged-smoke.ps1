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
  # Loopback-only remote debugging for this validation process. Never enable
  # this in production app shortcuts or release builds.
  $proc = Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9228') -PassThru
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

  # Node 24's built-in WebSocket talks directly to Chromium DevTools. Unlike an
  # HTTP 200 on :3002, this proves compiled React actually mounted in Electron.
  node scripts/windows-packaged-renderer-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw "Packaged React renderer failed smoke verification (exit $LASTEXITCODE)" }

  Write-Host 'Packaged Windows smoke passed: services ready, React mounted, Electron IPC preload present.'
} finally {
  if ($proc) {
    try {
      $proc.Refresh()
      if (-not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F | Out-Null }
    } catch {}
  }
}
