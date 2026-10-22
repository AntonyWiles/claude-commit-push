import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const FOOTER = {
  plugin: 'desktop-mods',
  component: 'SessionMode',
  requestId: 'footer',
  props: { modes: ['auto'] },
} as const

// The context ring alone: the mod's other features are switched off.
const ONLY = { options: { usageMeter: false, nextSteps: false, gitBar: false } }

const WINDOW = 1_000_000

// Stands for the engine: a 1M model with auto-compact at 400k, and the footer's own labels.
function fakeEngine(on: Parameters<TestBody>[1], compactAt: number | null = 400_000) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: WINDOW,
        ...(e.breakdown
          ? {
              breakdown: {
                rawMaxTokens: compactAt ?? WINDOW,
                isAutoCompactEnabled: compactAt !== null,
                autocompactSource: compactAt === null ? 'model-default' : 'settings',
              },
            }
          : {}),
      },
    },
  }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`modes: ${(e.props as { modes: string[] }).modes.join(' & ')}`}</Text>
  })
}

const measure = (tokens: number) => ({ context: { tokens, window: WINDOW, percent: Math.round((tokens / WINDOW) * 100) }, rateLimits: [], changed: ['context'] as const })

test('the ring is full at the auto-compact window, not the model window', ONLY, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure(200_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  const ring = await ui.find({ type: 'Svg' })
  expect(ring?.props.alt).toBe('Context 200k of 400k (50%) · auto-compact window · model window 1M')
  // half of the ring's circumference is drawn
  expect(String(ring?.props.source)).toContain('stroke-dasharray="21.21 42.41"')
  // the engine's own mode labels still draw beside it
  expect((await ui.find({ type: 'Text', text: /modes:/ }))?.text).toBe('modes: auto')
  await ui.unmount()
})

test('the ring follows the window as it fills, and turns red near the limit', ONLY, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure(360_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  const ring = await ui.find({ type: 'Svg' })
  expect(ring?.props.alt).toContain('(90%)')
  expect(String(ring?.props.source)).toContain('#e5534b')
  await ui.unmount()
})

test('a fresh session draws an empty ring', ONLY, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Context 0 of 400k (0%)')
  await ui.unmount()
})

test('with auto-compact off the ring is full at the model window', ONLY, async ($, on) => {
  fakeEngine(on, null)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure(250_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Context 250k of 1M (25%)')
  await ui.unmount()
})

test('the contextLimit option sets the full mark', { options: { ...ONLY.options, contextLimit: 500_000 } }, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure(250_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Context 250k of 500k (50%) · model window 1M')
  await ui.unmount()
})

test('the terminal, which draws no Svg, gets a mode label instead', ONLY, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.session.measure(measure(100_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /modes:/ }))?.text).toBe('modes: ctx 25% & auto')
  await ui.unmount()
})

test('switched off, the footer is the engine\'s own', { options: { ...ONLY.options, contextRing: false } }, async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await $.session.measure(measure(100_000) as never)

  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /modes:/ }))?.text).toBe('modes: auto')
  await ui.unmount()
})
