$ErrorActionPreference = "Stop"
$source = Join-Path $env:LOCALAPPDATA "Programs\yapper-desktop"
$asar = Join-Path $PSScriptRoot "build\app.asar"
$dest = Join-Path $env:LOCALAPPDATA "Venpper"

if (-not (Test-Path (Join-Path $source "Yapper.exe"))) {
  Write-Host "Yapper desktop is not installed. Install it from https://www.yapper.website/download first."
  exit 1
}
if (-not (Test-Path $asar)) {
  Write-Host "Venpper's app package is missing. Expected $asar"
  exit 1
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dest "resources") | Out-Null

Get-ChildItem $source -File | Where-Object { $_.Name -ne "Uninstall Yapper.exe" } | ForEach-Object {
  $link = Join-Path $dest $_.Name
  if (-not (Test-Path $link)) {
    New-Item -ItemType HardLink -Path $link -Target $_.FullName | Out-Null
  }
}

$exeLink = Join-Path $dest "Venpper.exe"
if (-not (Test-Path $exeLink)) {
  New-Item -ItemType HardLink -Path $exeLink -Target (Join-Path $source "Yapper.exe") | Out-Null
}

$localesLink = Join-Path $dest "locales"
if (-not (Test-Path $localesLink)) {
  New-Item -ItemType Junction -Path $localesLink -Target (Join-Path $source "locales") | Out-Null
}

Copy-Item $asar (Join-Path $dest "resources\app.asar") -Force
Start-Process $exeLink
Write-Host "Venpper is opening. Log in once; your mods stay on this computer."
