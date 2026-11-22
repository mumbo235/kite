# Kite installer for Windows. Installs for the current user (no admin needed).
#
#   irm https://mumbo235.github.io/kite/install.ps1 | iex
#
# To uninstall, use Settings > Apps > Installed apps > Kite.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # makes Invoke-WebRequest much faster

# Where the installers are hosted. With GitHub Releases this is
#   https://github.com/mumbo235/kite/releases/latest/download
$Files = if ($env:KITE_FILES) { $env:KITE_FILES } else { 'https://github.com/mumbo235/kite/releases/latest/download' }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$url = "$Files/Kite-Setup-$arch.exe"
$setup = Join-Path $env:TEMP 'Kite-Setup.exe'

Write-Host '==> Downloading Kite' -ForegroundColor Blue
Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing

Write-Host '==> Installing' -ForegroundColor Blue
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Remove-Item $setup -ErrorAction SilentlyContinue

Write-Host '==> Kite is installed. Find it in the Start menu or on your desktop.' -ForegroundColor Green
