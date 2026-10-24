# Installs desktop-mods for Claude Code (terminal and the desktop app's Code tab) on Windows.
# Safe to re-run: it is also how you update.
#
# From a checkout (edits are live after /reload-plugins; for the machine you develop on):
#   powershell -ExecutionPolicy Bypass -File deploy\install.ps1
#
# From GitHub (any other machine; updates with `claude plugin update` + re-running this):
#   powershell -ExecutionPolicy Bypass -File deploy\install.ps1 -FromGitHub
#   irm https://raw.githubusercontent.com/AntonyWiles/claude-desktop-mods/main/deploy/install.ps1 | iex
#
# Options:
#   -NoCollector         skip the usage meter's collector (Python 3.9+); the usage band then stays empty
#   -KeepOld             leave the old separate mods (commit-push, next-steps, usage-meter) enabled
#   -HostName Desktop    this machine's name in the usage meter
#   -Peer name=http://host:8765 -Listen 8765 -Token <shared> -Allow 192.168.1.0/24   usage-meter HTTP sync
param(
  [switch]$FromGitHub,
  [string]$Repo = "AntonyWiles/claude-desktop-mods",
  [switch]$NoCollector,
  [switch]$KeepOld,
  [string]$HostName = "",
  [string[]]$Peer = @(),
  [int]$Listen = 0,
  [string]$Token = "",
  [string[]]$Allow = @()
)
$ErrorActionPreference = "Stop"
$Plugin = "desktop-mods"
$Marketplace = "claude-desktop-mods"

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Invoke-Claude { & claude @args; if ($LASTEXITCODE -ne 0) { throw "claude $($args -join ' ') failed ($LASTEXITCODE)" } }
# For calls that may fail harmlessly: Windows PowerShell 5.1 turns a native program's
# redirected stderr into errors, which "Stop" makes fatal. Returns the output as text.
function Invoke-ClaudeQuiet {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { (& claude @args 2>&1 | ForEach-Object { "$_" }) -join "`n" } finally { $ErrorActionPreference = $saved }
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "The claude CLI is not on PATH. Install Claude Code first: winget install Anthropic.ClaudeCode"
}

# A checkout is where this script sits, unless it was piped in (no $PSScriptRoot) or -FromGitHub.
$Checkout = if ($PSScriptRoot -and -not $FromGitHub) { Split-Path -Parent $PSScriptRoot } else { $null }
if ($Checkout -and -not (Test-Path (Join-Path $Checkout ".claude-plugin\plugin.json"))) { $Checkout = $null }

# 1. the old separate mods, which would draw their rows a second time
if (-not $KeepOld) {
  Step "Disabling the old separate mods (re-enable with: claude plugin enable <name>)"
  foreach ($old in @("commit-push@local-mods", "next-steps@claude-community")) {
    # Fails harmlessly where the plugin isn't installed or is already disabled.
    Invoke-ClaudeQuiet plugin disable $old | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "    disabled $old" }
  }
  $link = Join-Path $env:USERPROFILE ".claude\skills\usage-meter"
  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType) {
      cmd /c rmdir "$link" | Out-Null
      Write-Host "    removed the usage-meter link in ~/.claude/skills (the folder it pointed at is untouched)"
    } else {
      Write-Warning "~/.claude/skills/usage-meter is a real folder, not a link: left as is. Move it away so the usage band doesn't draw twice."
    }
  }
}

# 2. the mod
Step "Installing $Plugin"
$source = if ($Checkout) { $Checkout } else { $Repo }
$known = Invoke-ClaudeQuiet plugin marketplace list
if ($known -match [regex]::Escape($Marketplace)) {
  & claude plugin marketplace update $Marketplace | Out-Null
} else {
  Invoke-Claude plugin marketplace add $source
}
$installed = Invoke-ClaudeQuiet plugin list
if ($installed -match [regex]::Escape("$Plugin@$Marketplace")) {
  & claude plugin update "$Plugin@$Marketplace"
  Invoke-ClaudeQuiet plugin enable "$Plugin@$Marketplace" | Out-Null
} else {
  Invoke-Claude plugin install "$Plugin@$Marketplace" --scope user
}
Write-Host "    source: $source"

# 3. the usage meter's collector: a stable copy of collector/ (the plugin's own folder moves with each version)
if ($NoCollector) { Write-Host "Skipping the collector (-NoCollector)."; Step "Done. Open a new session, or run /reload-plugins in an open one."; return }

$py = Get-Command pythonw.exe -ErrorAction SilentlyContinue
if (-not $py) {
  Write-Warning "pythonw.exe (Python 3.9+) not found: the collector is not installed. Install Python and re-run, or pass -NoCollector."
  Step "Done (without the collector). Open a new session, or run /reload-plugins in an open one."
  return
}

Step "Installing the usage collector"
$pluginRoot = $Checkout
if (-not $pluginRoot) {
  $record = Get-Content (Join-Path $env:USERPROFILE ".claude\plugins\installed_plugins.json") -Raw | ConvertFrom-Json
  $pluginRoot = ($record.plugins."$Plugin@$Marketplace" | Select-Object -First 1).installPath
}
if (-not $pluginRoot -or -not (Test-Path (Join-Path $pluginRoot "collector\umeter.py"))) { throw "Can't find the installed plugin's collector folder ($pluginRoot)." }

$App = Join-Path $env:USERPROFILE ".claude\desktop-mods\app"
New-Item -ItemType Directory -Force (Join-Path $App "collector"), (Join-Path $App "deploy") | Out-Null
Copy-Item (Join-Path $pluginRoot "collector\*.py") (Join-Path $App "collector") -Force
Copy-Item (Join-Path $pluginRoot "deploy\run_hidden.pyw") (Join-Path $App "deploy") -Force
Copy-Item (Join-Path $pluginRoot "prices.json") $App -Force
Copy-Item (Join-Path $pluginRoot ".claude-plugin\plugin.json") (Join-Path $App "version.json") -Force
Write-Host "    collector: $App"

# this machine's name and HTTP sync peers (kept from earlier installs)
$Data = Join-Path $env:USERPROFILE ".claude\usage-meter"
New-Item -ItemType Directory -Force (Join-Path $Data "local") | Out-Null
$cfgPath = Join-Path $Data "local\collector.json"
$cfg = @{}
if (Test-Path $cfgPath) { (Get-Content $cfgPath -Raw | ConvertFrom-Json).psobject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } }
if ($HostName) { $cfg["host"] = $HostName }
if ($Peer.Count) { $cfg["peers"] = @($Peer | ForEach-Object { $n, $u = $_ -split "=", 2; [ordered]@{ name = $n; url = $u } }) }
if (-not $cfg.ContainsKey("peers")) { $cfg["peers"] = @() }
if ($Listen) { $cfg["listen"] = $Listen }
if ($Token) { $cfg["token"] = $Token }
if ($Allow.Count) { $cfg["allow"] = @($Allow) }
if (-not $cfg.ContainsKey("syncSeconds")) { $cfg["syncSeconds"] = 20 }
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json))
Write-Host "    config: $cfgPath"

# a hidden Scheduled Task at logon, restarted on failure (same name as the old usage-meter task, so it replaces it)
$log = Join-Path $Data "local\collector.log"
$action = New-ScheduledTaskAction -Execute $py.Source -Argument "`"$App\deploy\run_hidden.pyw`"" -WorkingDirectory $Data
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "usage-meter" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Stop-ScheduledTask -TaskName "usage-meter" -ErrorAction SilentlyContinue
# Stop-ScheduledTask can leave pythonw running: stop any earlier collector so the new code loads
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object CommandLine -like '*run_hidden.pyw*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 2
Start-ScheduledTask -TaskName "usage-meter"
Write-Host "    service: Scheduled Task 'usage-meter' (log: $log)"

Step "Done. Open a new session, or run /reload-plugins in an open one."
