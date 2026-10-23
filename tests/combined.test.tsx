import { expect, test } from 'claude-code/testing'

// Every feature that draws but the usage meter (which needs its collector's
// files): the band and the footer carry each feature's part at once.
const OPTIONS = { options: { usageMeter: false, sessionArchive: false } }

const result = (exitCode: number, stdout = '') => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('git bar, next steps and context ring share the band', OPTIONS, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { window: 1_000_000, ...(e.breakdown ? { breakdown: { rawMaxTokens: 400_000, isAutoCompactEnabled: true } } : {}) },
    },
  }) as never)
  on('agent.list', () => ({ value: [] }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(1).join(' ')
    if (args === 'rev-parse --show-toplevel') return result(0, 'C:/repo\n')
    if (args === 'rev-parse --abbrev-ref HEAD') return result(0, 'main\n')
    if (args === 'for-each-ref --format=%(refname:short) refs/heads') return result(0, 'main\n')
    return result(0)
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: [], changed: ['context'] } as never)

  const band = await $.ui.mount({
    plugin: 'desktop-mods',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  } as never)
  expect(await band.find({ key: 'commit-push:commit' })).toBeDefined()
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect((await band.find({ type: 'Svg' }))?.props.alt).toContain('Context 100k of 400k (25%)')
  // The gutter layout: a label per section, no full-width rules, the ring closing the first row.
  expect(await band.find({ type: 'Text', text: /^git$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /──/ })).toBeUndefined()
  const rows = (await band.findAll({ type: 'Box' })).filter(b => String(b.key).startsWith('band:'))
  expect(rows[0]?.key).toBe('band:git:0')
  expect(JSON.stringify(rows[0]?.children)).toContain('"Svg"')
  await band.unmount()
})
