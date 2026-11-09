param(
  [ValidateRange(0, 180)] [double]$SoakMinutes = 0
)

$ErrorActionPreference = 'Stop'

$pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
# The personal preview intentionally uses a different executable/app identity.
# Default signed/CI MockMate smoke continues to launch MockMate.exe.
$exeBase = if ($pkg.build.executableName) { [string]$pkg.build.executableName } else { 'MockMate' }
$exe = Join-Path (Resolve-Path 'release\win-unpacked') "$exeBase.exe"
if (-not (Test-Path $exe)) { throw "Packaged MockMate executable missing: $exe" }
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


  # Optional real elapsed-time desktop/service endurance test. No provider credentials,
  # audio playback or paid LLM requests; the renderer and both local services remain live.
  # This verifies more than startup, but is NOT a physical 90-minute interview/audio test.
  if ($SoakMinutes -gt 0) {
    $duration = [TimeSpan]::FromMinutes($SoakMinutes)
    $end = (Get-Date).Add($duration)
    $sample = 0
    $startWorkingSet = [double]$proc.WorkingSet64
    $peakDeltaMB = 0
    $successes = 0
    $consecutiveFailures = 0
    Write-Host ("Endurance test started: {0:N2} minutes; no paid AI calls" -f $SoakMinutes)
    while ((Get-Date) -lt $end) {
      Start-Sleep -Seconds 10
      $sample += 1
      $proc.Refresh()
      if ($proc.HasExited) { throw "Packaged Electron process exited during endurance test (exit $($proc.ExitCode))." }
      try {
        $ui = Invoke-WebRequest 'http://127.0.0.1:3002/' -UseBasicParsing -TimeoutSec 4
        if ($ui.StatusCode -ne 200) { throw 'UI/API status was not 200' }
        if ($expectLocalBackend) {
          $health = Invoke-RestMethod 'http://127.0.0.1:4000/health' -TimeoutSec 4
          if ($health.ok -ne $true) { throw 'Account backend health was not OK' }
        }
        $successes += 1
        $consecutiveFailures = 0
      } catch {
        $consecutiveFailures += 1
        Write-Warning ("Endurance health probe failed (consecutive {0}): {1}" -f $consecutiveFailures, $_.Exception.Message)
        if ($consecutiveFailures -ge 2) { throw 'Two consecutive endurance health probes failed.' }
      }
      $deltaMB = [math]::Max(0, ($proc.WorkingSet64 - $startWorkingSet) / 1MB)
      $peakDeltaMB = [math]::Max($peakDeltaMB, $deltaMB)
      if ($deltaMB -gt 1024) { throw ("Electron working set increased by {0:N0} MiB (limit 1024 MiB)." -f $deltaMB) }
      # Every ten minutes: confirm Chromium can still mount and answer an IPC/DOM probe.
      if ($sample % 60 -eq 0) {
        node scripts/windows-packaged-renderer-smoke.mjs
        if ($LASTEXITCODE -ne 0) { throw "Renderer endurance verification failed ($LASTEXITCODE)." }
        Write-Host ("Endurance {0:N0} minutes healthy; peak process memory growth {1:N1} MiB" -f ($sample / 6), $peakDeltaMB)
      }
    }
    Write-Host ("Endurance passed: {0:N2} elapsed minutes, {1} successful probes, peak growth {2:N1} MiB" -f $SoakMinutes, $successes, $peakDeltaMB)
  }

  Write-Host 'Packaged Windows smoke passed: services ready, React mounted, Electron IPC preload present.'
} finally {
  if ($proc) {
    try {
      $proc.Refresh()
      if (-not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F | Out-Null }
    } catch {}
  }
}
