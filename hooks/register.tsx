import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Busy, RepoInfo } from '../types'

const repo = atom({ plugin: 'commit-push', key: 'repo' } as const, null)
const busy = atom({ plugin: 'commit-push', key: 'busy' } as const, null)
const note = atom({ plugin: 'commit-push', key: 'note' } as const, null)

// Haiku sees at most this much of the staged diff.
const DIFF_LIMIT = 60_000

// New files larger than this are left out of a commit.
const MAX_NEW_FILE_BYTES = 5 * 1024 * 1024

// New (untracked) files that look like secrets are left out of a commit.
// Files git already tracks are committed as usual.
const SECRET_NAMES = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$|dist$).+/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials)$/i,
  /^credentials(\..+)?$/i,
  /^secrets?\..+$/i,
  /^settings\.local\.json$/i,
]

const SYSTEM = `You write git commit messages.
Reply with the commit message only: no code fences, no quotes, no preamble.
First line: imperative mood, at most 72 characters, no trailing period.
If the change needs explaining, add a blank line and a short body wrapped at 72 columns
saying what changed and why. Do not invent reasons the diff does not show.`

async function git($: EngineInterface, args: string[], init: { cwd?: string; stdin?: string } = {}) {
  return $.process.run(['git', ...args], { ...init, timeoutMs: 60_000 })
}

async function refresh($: EngineInterface) {
  const top = await git($, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await update($, repo, () => null)
    return
  }

  const [head, status, upstream] = await Promise.all([
    git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--count', '@{u}..HEAD']),
  ])

  const info: RepoInfo = {
    branch: head.stdout.trim() || '?',
    changes: status.stdout.split('\n').filter(line => line.trim()).length,
    ahead: upstream.exitCode === 0 ? Number(upstream.stdout.trim()) || 0 : 0,
    hasUpstream: upstream.exitCode === 0,
  }
  await update($, repo, () => info)
}

function lastLine(text: string) {
  const lines = text.trim().split('\n').filter(line => line.trim())

  return lines[lines.length - 1] ?? ''
}

function cleanMessage(text: string) {
  return text
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim()
}

async function exists($: EngineInterface, path: string) {
  return $.fs.stat(path).then(
    () => true,
    () => false,
  )
}

// Why the repository is in no state for a one-click commit, or null when it is.
async function blocker($: EngineInterface, root: string) {
  const head = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
  if (head.stdout.trim() === 'HEAD') {
    return 'detached HEAD; check out a branch first'
  }

  const gitDir = (await git($, ['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim()
  if ((await exists($, `${gitDir}/rebase-merge`)) || (await exists($, `${gitDir}/rebase-apply`))) {
    return 'a rebase is in progress; finish it in a terminal'
  }

  const states = [
    ['MERGE_HEAD', 'a merge'],
    ['CHERRY_PICK_HEAD', 'a cherry-pick'],
    ['REVERT_HEAD', 'a revert'],
  ] as const
  for (const [ref, what] of states) {
    const found = await git($, ['rev-parse', '-q', '--verify', ref], { cwd: root })
    if (found.exitCode === 0) {
      return `${what} is in progress; finish it in a terminal`
    }
  }

  const conflicts = await git($, ['diff', '--name-only', '--diff-filter=U'], { cwd: root })
  if (conflicts.stdout.trim()) {
    return 'there are unresolved conflicts'
  }

  return null
}

// Stages changes to tracked files, and new files that are neither secret-looking nor large.
// Answers the new files it left out.
async function stage($: EngineInterface, root: string) {
  const tracked = await git($, ['add', '-u'], { cwd: root })
  if (tracked.exitCode !== 0) {
    throw new Error(lastLine(tracked.stderr))
  }

  const listed = await git($, ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root })
  const kept: string[] = []
  const skipped: string[] = []

  for (const path of listed.stdout.split('\0').filter(Boolean)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const isSecret = SECRET_NAMES.some(pattern => pattern.test(name))
    const size = isSecret ? 0 : await $.fs.stat(`${root}/${path}`).then(s => s.size, () => 0)
    if (isSecret || size > MAX_NEW_FILE_BYTES) {
      skipped.push(path)
    } else {
      kept.push(path)
    }
  }

  if (kept.length > 0) {
    const added = await git($, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      cwd: root,
      stdin: kept.join('\0'),
    })
    if (added.exitCode !== 0) {
      throw new Error(lastLine(added.stderr))
    }
  }

  return skipped
}

function leftOut(skipped: string[]) {
  if (skipped.length === 0) {
    return ''
  }
  const shown = skipped.slice(0, 3).join(', ')

  return ` (left out: ${shown}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''})`
}

async function run($: EngineInterface, kind: Exclude<Busy, null>, work: () => Promise<string>) {
  if ((await read($, busy)) !== null) {
    return
  }

  await update($, busy, () => kind)
  await update($, note, () => (kind === 'commit' ? 'Writing commit message...' : 'Pushing...'))

  let message: string
  try {
    message = await work()
  } catch (err) {
    message = `${kind === 'commit' ? 'Commit' : 'Push'} failed: ${err instanceof Error ? err.message : String(err)}`
  }

  await update($, note, () => message)
  await update($, busy, () => null)
  $.ui.toast(message)
  await refresh($)
}

async function commit($: EngineInterface) {
  const root = (await git($, ['rev-parse', '--show-toplevel'])).stdout.trim()

  const reason = await blocker($, root)
  if (reason) {
    return `Not committed: ${reason}`
  }

  const skipped = await stage($, root)

  const stat = await git($, ['diff', '--cached', '--stat'], { cwd: root })
  if (!stat.stdout.trim()) {
    return `Nothing to commit${leftOut(skipped)}`
  }

  const diff = await git($, ['diff', '--cached', '--no-color'], { cwd: root })
  const shown =
    diff.stdout.length > DIFF_LIMIT
      ? `${diff.stdout.slice(0, DIFF_LIMIT)}\n[diff cut at ${DIFF_LIMIT} characters]`
      : diff.stdout

  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'medium',
    system: SYSTEM,
    prompt: `Summary:\n${stat.stdout}\nDiff:\n${shown}`,
    maxTokens: 600,
    timeoutMs: 90_000,
  })

  if (!reply.isAnswered) {
    return `Not committed: Haiku gave no message (${reply.reason}); changes are staged`
  }

  const message = cleanMessage(reply.text)
  if (!message) {
    return 'Not committed: Haiku gave an empty message; changes are staged'
  }

  const done = await git($, ['commit', '-F', '-'], { cwd: root, stdin: message })
  if (done.exitCode !== 0) {
    return `Commit failed: ${lastLine(done.stderr || done.stdout)}`
  }

  return `Committed: ${message.split('\n')[0]}${leftOut(skipped)}`
}

async function push($: EngineInterface) {
  const root = await git($, ['rev-parse', '--show-toplevel'])
  const script = `${$.plugin.root}/scripts/push.ps1`
  const result = await $.process.run(
    [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Repo',
      root.stdout.trim(),
    ],
    { timeoutMs: 300_000 },
  )

  if (result.exitCode !== 0) {
    return `Push failed: ${lastLine(result.stderr || result.stdout)}`
  }

  return `Pushed: ${lastLine(result.stdout) || 'up to date'}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, busy, () => null)
    await refresh($)

    return result
  })

  // The model may have edited or committed files during the turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  // The band is shared: draw what the mods beneath drew, and add one row under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const info = await read($, repo)
    if (e.props.hasSurvey || info === null) {
      return below
    }

    const working = await read($, busy)
    const last = await read($, note)
    const { Box, Button, Text } = $.ui.resolve(e)

    const summary = [
      info.branch,
      info.changes === 1 ? '1 change' : `${info.changes} changes`,
      info.hasUpstream ? `${info.ahead} to push` : 'no upstream',
    ].join(' · ')

    return (
      <Box flexDirection="column">
        {below}
        <Box key="commit-push:row" flexDirection="row" gap={1}>
          <Button
            key="commit-push:commit"
            label={working === 'commit' ? 'Committing...' : 'Commit'}
            variant="primary"
            onPress={() => run($, 'commit', () => commit($))}
          />
          <Button
            key="commit-push:push"
            label={working === 'push' ? 'Pushing...' : 'Push'}
            onPress={() => run($, 'push', () => push($))}
          />
          <Text dimColor wrap="truncate-end">
            {summary}
            {last ? ` · ${last}` : ''}
          </Text>
        </Box>
      </Box>
    )
  })
}
