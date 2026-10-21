# Pushes the current branch of the repository at -Repo.
# Sets the upstream on the first push of a new branch (origin, else the first remote).
param([Parameter(Mandatory = $true)][string]$Repo)

# git writes progress to stderr; keep it as plain text rather than PowerShell errors.
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $Repo

function Invoke-Git { & git @args 2>&1 | ForEach-Object { "$_" } }

$branch = (Invoke-Git rev-parse --abbrev-ref HEAD | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $branch -eq 'HEAD') {
  [Console]::Error.WriteLine('Not on a branch (detached HEAD); nothing to push.')
  exit 1
}

Invoke-Git rev-parse --abbrev-ref --symbolic-full-name '@{u}' | Out-Null
if ($LASTEXITCODE -eq 0) {
  Invoke-Git push
  exit $LASTEXITCODE
}

$remotes = @(Invoke-Git remote)
if ($remotes.Count -eq 0 -or -not $remotes[0]) {
  [Console]::Error.WriteLine('This repository has no remote to push to.')
  exit 1
}
$remote = if ($remotes -contains 'origin') { 'origin' } else { $remotes[0] }
Invoke-Git push -u $remote $branch
exit $LASTEXITCODE
