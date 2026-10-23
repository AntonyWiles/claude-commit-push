# Cuts a release: checks, bumps the version in plugin.json, dates the CHANGELOG's
# Unreleased section, commits, tags v<version>, builds the zip; -Push also pushes and
# publishes a GitHub release with the zip attached.
#   powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Bump patch|minor|major [-Push]
param([ValidateSet("patch", "minor", "major")][string]$Bump = "patch", [switch]$Push)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

if ((& git -C $Root status --porcelain)) { throw "Commit or stash your changes first." }
& (Join-Path $PSScriptRoot "check.ps1")

$manifestPath = Join-Path $Root ".claude-plugin\plugin.json"
$text = Get-Content $manifestPath -Raw
$old = ($text | ConvertFrom-Json).version
$major, $minor, $patch = $old.Split(".") | ForEach-Object { [int]$_ }
switch ($Bump) {
  "major" { $major++; $minor = 0; $patch = 0 }
  "minor" { $minor++; $patch = 0 }
  "patch" { $patch++ }
}
$new = "$major.$minor.$patch"
# Edit the one line so the file's layout stays as written.
$text = $text -replace "(`"version`"\s*:\s*`")$([regex]::Escape($old))(`")", "`${1}$new`${2}"
[IO.File]::WriteAllText($manifestPath, $text)

$changelog = Join-Path $Root "CHANGELOG.md"
$log = Get-Content $changelog -Raw
if ($log -notmatch "## Unreleased") { throw "CHANGELOG.md has no '## Unreleased' section to release." }
$date = Get-Date -Format "yyyy-MM-dd"
$log = $log -replace "## Unreleased", "## Unreleased`n`n## $new - $date"
[IO.File]::WriteAllText($changelog, $log)

& git -C $Root commit -am "Release v$new"
& git -C $Root tag -a "v$new" -m "v$new"
& (Join-Path $PSScriptRoot "package.ps1")
Write-Host "Released v$old -> v$new" -ForegroundColor Green

if ($Push) {
  & git -C $Root push --follow-tags
  & gh release create "v$new" (Join-Path $Root "dist\desktop-mods-$new.zip") --repo AntonyWiles/claude-desktop-mods --title "v$new" --notes "See CHANGELOG.md"
} else {
  Write-Host "Not pushed. To publish: git push --follow-tags, then gh release create v$new dist\desktop-mods-$new.zip"
}
