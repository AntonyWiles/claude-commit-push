import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { BandIn, Section } from '../band'
import type { In, NextOf } from '../hook-types'

import type { Busy, RepoInfo } from '../../types'

const repo = atom({ plugin: 'desktop-mods', key: 'repo' } as const, null)
const busy = atom({ plugin: 'desktop-mods', key: 'busy' } as const, null)
const note = atom({ plugin: 'desktop-mods', key: 'note' } as const, null)
const tasks = atom({ plugin: 'desktop-mods', key: 'tasks' } as const, [])

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

  const [head, status, upstream, numstat, heads] = await Promise.all([
    git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, ['status', '--porcelain']),
    git($, ['rev-list', '--count', '@{u}..HEAD']),
    // Staged and unstaged changes to tracked files, against the last commit.
    git($, ['diff', 'HEAD', '--numstat', '--no-color']),
    git($, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ])

  let added = 0
  let removed = 0
  for (const line of numstat.exitCode === 0 ? numstat.stdout.split('\n') : []) {
    // Binary files read "-\t-\tpath" and count as no lines.
    const [plus, minus] = line.split('\t')
    added += Number(plus) || 0
    removed += Number(minus) || 0
  }

  const statusLines = status.stdout.split('\n').filter(line => line.trim())
  const root = top.stdout.trim().replace(/[\\/]+$/, '')
  const info: RepoInfo = {
    name: root.slice(Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\')) + 1),
    branch: head.stdout.trim() || '?',
    branches: heads.stdout.split('\n').map(line => line.trim()).filter(Boolean),
    changes: statusLines.length,
    added,
    removed,
    untracked: statusLines.filter(line => line.startsWith('??')).length,
    ahead: upstream.exitCode === 0 ? Number(upstream.stdout.trim()) || 0 : 0,
    hasUpstream: upstream.exitCode === 0,
  }
  await update($, repo, () => info)
}

// What is still running in this session, as words, or null when nothing is.
async function running($: EngineInterface) {
  const agents = (await $.agent.list()).filter(
    agent => agent.status === 'pending' || agent.status === 'running' || agent.status === 'waiting',
  )
  const shells = await read($, tasks)
  const parts = [
    agents.length ? `${agents.length} subagent${agents.length === 1 ? '' : 's'}` : '',
    shells.length ? `${shells.length} background task${shells.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean)

  return parts.length ? `${parts.join(' and ')} running` : null
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

  return midOperation($, root)
}

// Why git is mid-way through something (a rebase, a merge, conflicts), or null when it is not.
async function midOperation($: EngineInterface, root: string) {
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

const DOING = { commit: 'Writing commit message...', push: 'Pushing...', switch: 'Switching branch...' }
const FAILED = { commit: 'Commit', push: 'Push', switch: 'Branch switch' }

async function run($: EngineInterface, kind: Exclude<Busy, null>, work: () => Promise<string>) {
  if ((await read($, busy)) !== null) {
    return
  }

  await update($, busy, () => kind)
  await update($, note, () => DOING[kind])

  let message: string
  try {
    message = await work()
  } catch (err) {
    message = `${FAILED[kind]} failed: ${err instanceof Error ? err.message : String(err)}`
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

// Main-loop turns under way (a subagent's turns are counted by running()).
let turnsRunning = 0

async function switchBranch($: EngineInterface, target: string, isWorking: boolean) {
  if (isWorking || turnsRunning > 0) {
    return 'Not switched: wait until Claude has finished'
  }
  const busyWith = await running($)
  if (busyWith) {
    return `Not switched: ${busyWith}`
  }

  const root = (await git($, ['rev-parse', '--show-toplevel'])).stdout.trim()
  const reason = await midOperation($, root)
  if (reason) {
    return `Not switched: ${reason}`
  }
  const status = await git($, ['status', '--porcelain'], { cwd: root })
  if (status.stdout.trim()) {
    return 'Not switched: commit or stash your changes first'
  }

  const done = await git($, ['switch', target], { cwd: root })
  if (done.exitCode !== 0) {
    return `Branch switch failed: ${lastLine(done.stderr || done.stdout)}`
  }

  return `Switched to ${target}`
}

// The id of a background task a tool call started, if it started one.
function startedTask(tool: string, record: unknown) {
  const r = (record ?? {}) as { backgroundTaskId?: unknown; taskId?: unknown }
  const id = tool === 'Monitor' ? r.taskId : r.backgroundTaskId

  return typeof id === 'string' && id ? id : null
}

export async function sessionStart($: EngineInterface, e: In<'session.start'>, next: NextOf<'session.start'>) {
  const result = await next(e)
  turnsRunning = 0
  await update($, busy, () => null)
  await update($, tasks, () => [])
  await refresh($)

  return result
}

export async function turnStart($: EngineInterface, e: In<'turn.start'>, next: NextOf<'turn.start'>) {
  if (!e.agentId) turnsRunning += 1

  return next(e)
}

// The model may have edited or committed files during the turn.
export async function turnComplete($: EngineInterface, e: In<'turn.complete'>, next: NextOf<'turn.complete'>) {
  const result = await next(e)
  if (!(e as { agentId?: string }).agentId) turnsRunning = Math.max(0, turnsRunning - 1)
  await refresh($)

  return result
}

// Background shells and monitors: remembered when started, forgotten when stopped.
export async function toolCall($: EngineInterface, e: In<'tool.call'>, next: NextOf<'tool.call'>) {
  const result = await next(e)
  if (result.deny !== undefined || result.isError) {
    return result
  }

  const tool = String(e.tool)
  const id = startedTask(tool, result.result)
  if (id) {
    await update($, tasks, list => [...(list ?? []), id])
  }
  if (tool === 'TaskStop') {
    const input = e as { task_id?: string; shell_id?: string }
    const stopped = input.task_id ?? input.shell_id
    await update($, tasks, list => (list ?? []).filter(t => t !== stopped))
  }

  return result
}

// A finished task reports back as a notification row naming its id
// (a prompt-like row when idle, an attachment when folded into a running turn).
export async function sessionAppend($: EngineInterface, e: In<'session.append'>, next: NextOf<'session.append'>) {
  const result = await next(e)
  const shells = await read($, tasks)
  if (shells.length === 0 || e.message.role === 'assistant') {
    return result
  }

  const text = JSON.stringify(e.message.content)
  const ended = shells.filter(id => text.includes(`<task-id>${id}</task-id>`) && !/<status>running<\/status>/.test(text))
  if (ended.length > 0) {
    await update($, tasks, list => (list ?? []).filter(t => !ended.includes(t)))
  }

  return result
}

// The git section of the band: one row, Commit and Push first.
export async function bandSection($: EngineInterface, e: BandIn): Promise<Section | null> {
  const info = await read($, repo)
  if (info === null) {
    return null
  }

  const working = await read($, busy)
  const last = await read($, note)
  const busyWith = e.props.isWorking ? 'Claude is working' : await running($)
  const canSwitch = !busyWith && working === null && info.branches.length > 1 && e.surface !== 'mobile'

  const branchPicker =
    canSwitch && (e.surface === 'terminal' || e.surface === 'desktop' || e.surface === 'vscode')
      ? (() => {
          const { Select } = $.ui.resolve(e)
          const options = info.branches.includes(info.branch) ? info.branches : [info.branch, ...info.branches]

          return (
            <Select
              key="commit-push:branch"
              options={options.map(name => ({ value: name, label: name }))}
              value={info.branch}
              onSelect={target => {
                if (target !== info.branch) {
                  void run($, 'switch', () => switchBranch($, target, e.props.isWorking))
                }
              }}
            />
          )
        })()
      : null

  const { Box, Button, Text } = $.ui.resolve(e)
  const changes = [
    info.untracked ? `${info.untracked} new` : '',
    info.hasUpstream ? `${info.ahead} to push` : 'no upstream',
  ].filter(Boolean)

  const row = (
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
      <Text bold>{info.name}</Text>
      {branchPicker ?? <Text>⎇ {info.branch}</Text>}
      <Text wrap="truncate-end">
        <Text color="success">+{info.added}</Text> <Text color="error">−{info.removed}</Text>
        <Text dimColor>
          {' · '}
          {changes.join(' · ')}
          {busyWith && info.branches.length > 1 ? ` · branch locked: ${busyWith}` : ''}
          {last ? ` · ${last}` : ''}
        </Text>
      </Text>
    </Box>
  )

  return { label: 'git', rows: [row] }
}
