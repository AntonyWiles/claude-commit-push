import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = {
  plugin: 'desktop-mods',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// Next steps alone: the mod's other features are switched off.
const ONLY = { options: { usageMeter: false, gitBar: false, contextRing: false, sessionArchive: false } }

const LONG = 'Run tools\\release.ps1 -Bump minor -Push to cut v1.1.0, tag it, build the zip and publish a GitHub release with the changelog as its notes.'

// Stands for the engine: the fork answers three suggestions, the first with a long prompt.
function fakeEngine(on: Parameters<TestBody>[1]) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('command.list', () => ({ value: [] }))
  on('prompt.suggest', () => ({ isShown: false }) as never)
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify([
        { label: 'Cut a minor release and push', prompt: LONG },
        { label: 'Delete the merged branch', prompt: 'Delete the add-session-archive branch.' },
        { label: 'Mine the archive for skills', prompt: 'Read claude-session-archive and suggest skills.' },
      ]),
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

async function offer($: Parameters<TestBody>[0]) {
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'merge it', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'x'.repeat(200), durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
}

const PREVIEW = 'next-steps:preview'
const row = (n: number) => `next-steps:row:${n}`

// The preview area's text, as the desktop's preview Client last drew it.
async function preview(ui: { find: (q: never) => Promise<{ text: string } | undefined> }) {
  return (await ui.find({ type: 'Text', text: /^↳ /, in: PREVIEW } as never))?.text
}

const HINT = '↳ rest on a step to read it in full'

test('on the desktop the full prompt follows the pointer after 200ms', ONLY, async ($, on) => {
  fakeEngine(on)
  const clock = mock.clock(on, { now: 0 })
  await offer($)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^next$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Cut a minor release and push', in: row(1) })).toBeDefined()
  expect(await preview(ui)).toBe(HINT)

  // Not before the pointer has rested 200ms on a step.
  await ui.pointer({ type: 'enter', x: 4, y: 0, in: row(1) })
  await clock.advance(150)
  expect(await preview(ui)).toBe(HINT)
  await clock.advance(100)
  expect(await preview(ui)).toBe(`↳ ${LONG}`)

  // From 1 to 3: 3 takes over once the pointer has rested there.
  await ui.pointer({ type: 'leave', x: 4, y: 0, in: row(1) })
  await ui.pointer({ type: 'enter', x: 4, y: 0, in: row(3) })
  await clock.advance(250)
  expect(await preview(ui)).toBe('↳ Read claude-session-archive and suggest skills.')

  // Back up to 2: 2 shows, never stuck on 3, however tall the rows are drawn.
  await ui.pointer({ type: 'leave', x: 4, y: 0, in: row(3) })
  await ui.pointer({ type: 'enter', x: 4, y: 0, in: row(2) })
  await clock.advance(250)
  expect(await preview(ui)).toBe('↳ Delete the add-session-archive branch.')

  // Passing quickly over 3 on the way down changes nothing.
  await ui.pointer({ type: 'leave', x: 4, y: 0, in: row(2) })
  await ui.pointer({ type: 'enter', x: 4, y: 0, in: row(3) })
  await clock.advance(100)
  await ui.pointer({ type: 'leave', x: 4, y: 0, in: row(3) })
  // Down into the preview to read it: it stays.
  await ui.pointer({ type: 'enter', x: 4, y: 0, in: PREVIEW })
  await clock.advance(500)
  expect(await preview(ui)).toBe('↳ Delete the add-session-archive branch.')

  // Leaving the list hides it, after the same rest.
  await ui.pointer({ type: 'leave', x: 4, y: 0, in: PREVIEW })
  await clock.advance(250)
  expect(await preview(ui)).toBe(HINT)
  await ui.unmount()
})

test('on the desktop a pick fills the prompt box and 0 dismisses', ONLY, async ($, on) => {
  fakeEngine(on)
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  await offer($)

  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'next-steps:2' })
  expect(filled).toEqual(['Delete the add-session-archive branch.'])
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^next$/ })).toBeUndefined()
  await ui.unmount()

  await offer($)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'next-steps:dismiss' })
  expect(filled).toHaveLength(1)
  await ui.unmount()
})

test('VS Code reveals each preview from its keyed row', ONLY, async ($, on) => {
  fakeEngine(on)
  await offer($)

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await ui.find({ type: 'Button', text: 'Cut a minor release and push' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'hover for full text' })).toBeDefined()

  // One preview per suggestion, drawn hidden in its row for the row's hover to
  // reveal (the hover itself is surface data a found element does not carry),
  // each placed down over the preview area under the list.
  const previews = await ui.findAll({ type: 'Text', text: /^↳ / })
  expect(previews.map(p => p.text)).toEqual([
    `↳ ${LONG}`,
    '↳ Delete the add-session-archive branch.',
    '↳ Read claude-session-archive and suggest skills.',
  ])
  const hidden = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')
  expect(hidden.map(b => [b.props.display, b.props.top, b.props.height])).toEqual([
    ['none', 3, 2],
    ['none', 2, 2],
    ['none', 1, 2],
  ])
  // The rows are keyed, which is what makes each a hover scope.
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => String(b.key).startsWith('band:next:'))
  expect(rows.map(r => r.key)).toEqual(['band:next:0', 'band:next:1', 'band:next:2', 'band:next:3'])
  await ui.unmount()
})

test('the terminal and mobile draw the suggestions without previews', ONLY, async ($, on) => {
  fakeEngine(on)
  await offer($)

  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', text: 'Delete the merged branch' })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^↳ / })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: 'hover for full text' })).toBeUndefined()
    await ui.unmount()
  }
})
