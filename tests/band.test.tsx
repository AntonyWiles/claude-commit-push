import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = {
  plugin: 'commit-push',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const result = (exitCode: number, stdout = '') => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const ok = (stdout = '') => result(0, stdout)

type Repo = {
  untracked?: string
  sizes?: Record<string, number>
  merging?: boolean
  rebasing?: boolean
  below?: string
}

// Stands for git, the file system and Haiku beneath the plugin.
function fakeRepo(on: Parameters<TestBody>[1], repo: Repo = {}) {
  const ran: string[][] = []
  const stdins = new Map<string, string | undefined>()
  const asked: { model: string; effort?: string }[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return repo.below ? <Text>{repo.below}</Text> : <Box />
  })
  on('fs.stat', (_, e) => {
    // The engine hands paths over with the platform's separators.
    const name = e.path.split(/[\\/]/).pop() ?? ''
    if (name === 'rebase-merge' && repo.rebasing) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    }
    const size = repo.sizes?.[name]
    if (size === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file', size, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const args = e.argv.slice(1).join(' ')
    stdins.set(args, e.init?.stdin)
    if (args === 'rev-parse --show-toplevel') return ok('C:/repo\n')
    if (args === 'rev-parse --absolute-git-dir') return ok('C:/repo/.git\n')
    if (args === 'rev-parse --abbrev-ref HEAD') return ok('main\n')
    if (args === 'rev-parse -q --verify MERGE_HEAD') return result(repo.merging ? 0 : 1)
    if (args.startsWith('rev-parse -q --verify')) return result(1)
    if (args === 'status --porcelain') return ok(' M a.ts\n')
    if (args === 'rev-list --count @{u}..HEAD') return ok('1\n')
    if (args === 'ls-files -z --others --exclude-standard') return ok(repo.untracked ?? '')
    if (args === 'diff --cached --stat') return ok(' a.ts | 2 +-\n')
    if (args === 'diff --cached --no-color') return ok('diff --git a/a.ts b/a.ts\n')
    if (e.argv[0] === 'powershell.exe') return ok('To github.com:me/repo.git\n   abc..def  main -> main\n')
    return ok()
  })
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, effort: e.effort })
    return {
      value: {
        isAnswered: true,
        text: 'Fix the thing in a.ts',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })

  return { ran, stdins, asked }
}

test('Commit asks Haiku on medium and commits; Push runs the script', async ($, on) => {
  const { ran, stdins, asked } = fakeRepo(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /main/ }))?.text).toContain('1 change')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'commit-push:commit' })

  expect(asked).toEqual([{ model: 'haiku', effort: 'medium' }])
  expect(ran.some(argv => argv.join(' ') === 'git add -u')).toBe(true)
  expect(stdins.get('commit -F -')).toBe('Fix the thing in a.ts')
  expect((await ui.find({ type: 'Text', text: /Committed/ }))?.text).toContain('Fix the thing')

  await ui.press({ key: 'commit-push:push' })
  const pushCall = ran.find(argv => argv[0] === 'powershell.exe')
  expect(pushCall?.some(arg => arg.endsWith('scripts/push.ps1'))).toBe(true)
  expect(pushCall?.slice(-2)).toEqual(['-Repo', 'C:/repo'])
  expect((await ui.find({ type: 'Text', text: /Pushed/ }))?.text).toContain('main -> main')
  expect(pushCall?.join(' ')).not.toContain('force')
  await ui.unmount()
})

test('secret-looking and large new files are left out of a commit', async ($, on) => {
  const { stdins } = fakeRepo(on, {
    untracked: 'src/new.ts\0.env\0keys/server.pem\0.env.example\0video.mp4\0',
    sizes: { 'new.ts': 100, '.env.example': 50, 'video.mp4': 50 * 1024 * 1024 },
  })
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'commit-push:commit' })

  expect(stdins.get('add --pathspec-from-file=- --pathspec-file-nul')).toBe('src/new.ts\0.env.example')
  const shown = (await ui.find({ type: 'Text', text: /Committed/ }))?.text
  expect(shown).toContain('left out: .env, keys/server.pem, video.mp4')
  await ui.unmount()
})

for (const [what, repo] of [
  ['merge', { merging: true }],
  ['rebase', { rebasing: true }],
] as const) {
  test(`Commit refuses during a ${what} and stages nothing`, async ($, on) => {
    const { ran, asked } = fakeRepo(on, repo)
    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'commit-push:commit' })

    expect((await ui.find({ type: 'Text', text: /Not committed/ }))?.text).toContain('in progress')
    expect(ran.some(argv => argv[1] === 'add' || argv[1] === 'commit')).toBe(false)
    expect(asked).toEqual([])
    await ui.unmount()
  })
}

test('the band keeps what other mods drew', async ($, on) => {
  fakeRepo(on, { below: 'other mod' })
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /other mod/ })).toBeDefined()
    expect(await ui.find({ key: 'commit-push:commit' })).toBeDefined()
    await ui.unmount()
  }
})

test('outside a git repository the band is left to the others', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => result(128))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: 'C:/tmp', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'commit-push:commit' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})
