# Force-remove a MockMate Windows install when Smart App Control blocks the unsigned uninstaller.
# Does NOT require running "Uninstall MockMate.exe".
#
# Usage (PowerShell, Run as your user — elevation only needed for Program Files installs):
#   powershell -ExecutionPolicy Bypass -File scripts/force-uninstall-windows.ps1

$ErrorActionPreference = "Continue"
$paths = @(
  "$env:LOCALAPPDATA\Programs\MockMate",
  "$env:ProgramFiles\MockMate",
  "${env:ProgramFiles(x86)}\MockMate"
)

Write-Host "Stopping MockMate processes (if any)..."
Get-Process -Name "MockMate","electron" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and ($_.Path -like "*MockMate*") } |
  Stop-Process -Force -ErrorAction SilentlyContinue

foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "Removing $p"
    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$updater = "$env:LOCALAPPDATA\mockmate-updater"
if (Test-Path $updater) {
  Write-Host "Removing $updater"
  Remove-Item -LiteralPath $updater -Recurse -Force -ErrorAction SilentlyContinue
}

$uninstallRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)

foreach ($root in $uninstallRoots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    $name = $props.DisplayName
    $key = $_.PSChildName
    if (($name -and $name -match "MockMate") -or ($key -match "MockMate|mockmate|com\.mockmate")) {
      Write-Host "Removing ARP key $($_.PSPath)"
      Remove-Item -LiteralPath $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$shortcutPlaces = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\MockMate.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\MockMate\*.lnk",
  "$env:PUBLIC\Desktop\MockMate.lnk",
  "$env:USERPROFILE\Desktop\MockMate.lnk"
)
foreach ($s in $shortcutPlaces) {
  Get-Item $s -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. Refresh Settings → Apps → Installed apps (or sign out/in) if MockMate still appears."
Write-Host "Next: install a SIGNED build (see SIGNING.md — WIN_CSC_LINK secrets), or temporarily turn Smart App Control off to run an unsigned setup."
