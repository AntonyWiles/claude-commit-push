# commit-push

A Claude Code mod that puts a **Commit** button and a **Push** button above the prompt in every
session whose folder is a git repository, with the repository's name, a branch picker, and a
diff count beside them:

`[Commit] [Push] my-repo [main ▾] +12 −3 · 1 new · 1 to push · last result`

Lines added since the last commit show in green and lines removed in red (staged and unstaged
changes to tracked files); new files are counted apart.

Windows only for now: Push runs a PowerShell script. Needs Claude Code 2.1.304 or later.

## Switching branch

The branch picker is shown only while nothing else is going on: Claude is not mid-turn, no
subagent is running, and no background task (a background shell command or a monitor) started
this session is still running. Otherwise the branch shows as text with why it is locked. When
you pick a branch the mod checks all that again, and also refuses while there are uncommitted
changes ("commit or stash your changes first") or a merge, rebase, cherry-pick or revert is in
progress. It then runs `git switch <branch>`.

Background tasks are remembered as they start and forgotten when their notification arrives or
they are stopped through Claude: tasks started before the mod loaded are not known to it.

## What the buttons do

**Commit**

1. Refuses, and changes nothing, when the repository is mid-merge, mid-rebase, mid-cherry-pick
   or mid-revert, has unresolved conflicts, or is on a detached HEAD.
2. Stages changes to files git already tracks (`git add -u`), and new files except ones that look
   like secrets (`.env`, `.env.*` other than `.example`/`.sample`/`.template`/`.dist`, `*.pem`,
   `*.key`, `id_rsa`, `.npmrc`, `credentials*`, `secrets.*`, `settings.local.json`, ...) and ones
   over 5 MB. Files your `.gitignore` excludes are never staged. What it leaves out is shown.
3. Sends the staged diff (cut at 60,000 characters) to Claude Haiku at medium effort, through your
   session's own Claude account, to write the commit message.
4. Commits with that message. If Haiku gives no message, nothing is committed and the changes
   stay staged.

**Push** runs `scripts/push.ps1`: a plain `git push`, or `git push -u` to `origin` (else the first
remote) on a branch's first push. It never force-pushes, and refuses on a detached HEAD.

Claude Code runs the mod's git commands with your repository's git hooks turned off, so
pre-commit hooks do not run for these commits.

The band above the prompt is shared: the mod adds its row under what other mods draw there.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install commit-push --marketplace AntonyWiles/claude-commit-push
```

Answer `y` to add the marketplace, then pick the user scope.

From a shell:

```
claude plugin install commit-push --marketplace AntonyWiles/claude-commit-push
```

In the Claude desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `AntonyWiles/claude-commit-push`, then Add plugin.

Start a new session afterwards; the buttons show in sessions opened in a git repository.
