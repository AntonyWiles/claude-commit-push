# claude-desktop-mods

One mod for Claude Code on Windows (the desktop app's Code tab and the terminal),
holding four features that each switch on or off:

| Feature | What it does | Option |
| --- | --- | --- |
| **Context ring** | A small ring in the prompt footer that fills as the context window does. Full is your auto-compact window (say 400k on a 1M model), or the model's window when auto-compact is off. Hover it for the numbers. The terminal shows `ctx 52%` instead. | `contextRing`, `contextLimit` |
| **Git bar** | Commit (Haiku writes the message) and Push buttons, branch picker and diff count above the prompt. | `gitBar` |
| **Usage meter** | Plan-limit %, tokens and API-equivalent $ in the band above the prompt, and the `/burn` pane. Needs its collector (installed by `deploy\install.ps1`). From [rohit3a/usage-meter](https://github.com/rohit3a/usage-meter). | `usageMeter` |
| **Next steps** | After each turn, up to three suggested next prompts above the input: press 1, 2 or 3 to put one in the prompt box, 0 to dismiss. From Thariq Shihipar's `next-steps` plugin. | `nextSteps`, `minAnswerChars`, `suggestSkills` |

## Install

On the machine you develop on, from this checkout (edits go live with `/reload-plugins`):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install.ps1
```

On any other Windows machine, straight from GitHub:

```powershell
irm https://raw.githubusercontent.com/AntonyWiles/claude-desktop-mods/main/deploy/install.ps1 | iex
```

Or, without the installer (no usage collector), in a terminal session:

`/plugin install desktop-mods --marketplace AntonyWiles/claude-desktop-mods`

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins,
Add marketplace with `AntonyWiles/claude-desktop-mods`, then Add plugin.

Offline: copy `dist\desktop-mods-<version>.zip` over (see Releasing), unzip it, and run
`deploy\install.ps1` from inside the unzipped folder.

The installer:

1. disables the old separate mods (`commit-push@local-mods`, `next-steps@claude-community`) and
   removes the `~/.claude/skills/usage-meter` link, so nothing draws twice (`-KeepOld` skips this);
2. adds this repo as a marketplace and installs `desktop-mods` (or updates it);
3. copies the usage collector to `~/.claude/desktop-mods/app` and runs it as the hidden
   Scheduled Task `usage-meter` at logon (`-NoCollector` skips this; needs Python 3.9+).
   Usage history in `~/.claude/usage-meter` is kept.

Collector options are passed through: `-HostName Desktop`, and for HTTP sync between machines
`-Peer laptop=http://192.168.1.20:8765 -Listen 8765 -Token <shared> -Allow 192.168.1.0/24`.

Then open a new session, or run `/reload-plugins` in an open one.

Remove it with `deploy\uninstall.ps1` (`-RestoreOld` re-enables the old mods, `-RemoveData` deletes usage history).

## Options

Set them in the config menu (`/config`, in a terminal session), or from PowerShell:

```powershell
claude plugin configure desktop-mods@claude-desktop-mods          # show them
'{"nextSteps":"false","contextLimit":"400000"}' | claude plugin configure desktop-mods@claude-desktop-mods --values-stdin
```

`deploy\set-options.ps1 -Set nextSteps=false,contextLimit=400000` does the same.

| Option | Default | |
| --- | --- | --- |
| `contextRing` | `true` | the context ring |
| `contextLimit` | `0` | tokens at which the ring is full; `0` reads the auto-compact window |
| `gitBar` | `true` | the git bar |
| `usageMeter` | `true` | the usage meter's band, pane and `/burn` |
| `nextSteps` | `true` | next-step suggestions |
| `minAnswerChars` | `80` | no suggestions after answers shorter than this |
| `suggestSkills` | `true` | let suggestions name your skills and slash commands |

## Updating

- **From a checkout:** `git pull`, then `/reload-plugins`. Re-run `deploy\install.ps1` when `collector/` changed.
- **From GitHub:** re-run the install line; it runs `claude plugin update` and refreshes the collector.
- `claude plugin list` shows the installed version.

## Layout

```
.claude-plugin/        plugin.json (name, version, options) and marketplace.json
hooks/register.tsx     the one hooks module: chains every feature's hooks per event
hooks/features/        context-ring, git-bar, next-steps, usage-meter
hooks/hook-types.ts    parameter types for hooks written as function declarations
types/index.d.ts       the $.state contract for every feature
collector/             the usage meter's collector (Python), prices.json beside it
deploy/                install.ps1, uninstall.ps1, run_hidden.pyw
scripts/push.ps1       the git bar's push
tools/                 check.ps1, package.ps1, release.ps1
tests/                 claude plugin test suites, one per feature plus a combined one
```

### Adding a feature

1. Add `hooks/features/<name>.tsx`. Write each hook as an exported `async function`
   taking `($: EngineInterface, e: In<'event'>, next: NextOf<'event'>)` (types from
   `hooks/hook-types.ts`). The engine follows `$` across files only into function
   declarations, and a module may hook each event only once, so features never call `on`.
2. Chain it into the event's hook in `hooks/register.tsx`, behind an option.
3. Add the option to `userConfig` in `plugin.json`, any `$.state` values to `types/index.d.ts`
   (all under `'desktop-mods'`), and a `tests/<name>.test.tsx` that turns the other features off.

## Developing

```powershell
powershell -ExecutionPolicy Bypass -File tools\check.ps1   # validate + tests + collector compile
```

## Releasing

Add what changed under `## Unreleased` in `CHANGELOG.md`, commit, then:

```powershell
powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Bump patch   # or minor / major
powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Bump minor -Push   # also push + GitHub release
```

It runs the checks, bumps `version` in `plugin.json`, dates the changelog, commits, tags
`v<version>` and builds `dist\desktop-mods-<version>.zip`. Machines installed from GitHub pick
it up on their next `claude plugin update` (or install-script run).

## Credits and licence

MIT (see `LICENSE`). The usage meter is Rohit's [usage-meter](https://github.com/rohit3a/usage-meter)
(MIT, `licenses/usage-meter.LICENSE`) with a Windows port; next steps is Thariq Shihipar's
`next-steps` plugin (MIT). See `NOTICE`.
