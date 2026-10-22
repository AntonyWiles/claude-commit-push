# Removes desktop-mods: the plugin, its marketplace entry and the usage collector's Scheduled Task.
# Usage data in ~/.claude/usage-meter is kept unless -RemoveData.
#   powershell -ExecutionPolicy Bypass -File deploy\uninstall.ps1 [-RemoveData] [-RestoreOld]
param([switch]$RemoveData, [switch]$RestoreOld)
$ErrorActionPreference = "Continue"

& claude plugin uninstall "desktop-mods@claude-desktop-mods" 2>&1 | Out-Null
& claude plugin marketplace remove "claude-desktop-mods" 2>&1 | Out-Null
Write-Host "plugin removed"

Stop-ScheduledTask -TaskName "usage-meter" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object CommandLine -like '*desktop-mods*run_hidden.pyw*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Unregister-ScheduledTask -TaskName "usage-meter" -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE ".claude\desktop-mods") -ErrorAction SilentlyContinue
Write-Host "collector removed"

if ($RemoveData) {
  Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE ".claude\usage-meter") -ErrorAction SilentlyContinue
  Write-Host "usage data removed"
}

if ($RestoreOld) {
  foreach ($old in @("commit-push@local-mods", "next-steps@claude-community")) { & claude plugin enable $old 2>&1 | Out-Null }
  Write-Host "old mods re-enabled (the usage-meter skills link is not restored: re-run its own installer)"
}
