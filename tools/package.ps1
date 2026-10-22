# Builds dist\desktop-mods-<version>.zip from the committed tree (HEAD), for machines
# that install offline: unzip anywhere, then run deploy\install.ps1 from inside it.
#   powershell -ExecutionPolicy Bypass -File tools\package.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $Root ".claude-plugin\plugin.json") -Raw | ConvertFrom-Json).version
$dist = Join-Path $Root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "desktop-mods-$version.zip"
if ((& git -C $Root status --porcelain)) { Write-Warning "Uncommitted changes are not in the package: it is built from HEAD." }
& git -C $Root archive --format=zip --prefix="desktop-mods-$version/" -o $zip HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
Write-Host $zip
