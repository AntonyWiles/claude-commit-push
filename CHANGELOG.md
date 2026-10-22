# Changelog

## Unreleased

## 1.0.0 - 2026-10-23

- One mod, `desktop-mods`, replaces three: commit-push (now the git bar), usage-meter and next-steps.
  Each feature switches on or off in the mod's options.
- New: the context ring in the prompt footer, full at the auto-compact window (or the model's
  window, or `contextLimit`), with the numbers on hover; `ctx N%` on the terminal.
- Windows installer (`deploy\install.ps1`) for a checkout or straight from GitHub, which retires
  the old mods and moves the usage collector to a stable folder; uninstaller and options script.
- `tools\check.ps1`, `tools\package.ps1` (offline zip) and `tools\release.ps1` (version bump, tag, release).
