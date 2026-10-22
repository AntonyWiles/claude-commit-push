# Shows or sets desktop-mods' options (turn features on or off, the context ring's full mark).
#   powershell -ExecutionPolicy Bypass -File deploy\set-options.ps1                      # show
#   powershell -ExecutionPolicy Bypass -File deploy\set-options.ps1 -Set gitBar=false,contextLimit=400000
# A change reaches open sessions on their next /reload-plugins.
param([string[]]$Set = @())
$ErrorActionPreference = "Stop"
$Id = "desktop-mods@claude-desktop-mods"

if ($Set.Count -eq 0) { & claude plugin configure $Id; return }

$values = [ordered]@{}
foreach ($pair in $Set) {
  $name, $value = $pair -split "=", 2
  if (-not $value) { throw "Expected name=value, got '$pair'" }
  $values[$name.Trim()] = $value.Trim()
}
($values | ConvertTo-Json -Compress) | & claude plugin configure $Id --values-stdin
if ($LASTEXITCODE -ne 0) { throw "claude plugin configure failed" }
& claude plugin configure $Id
