import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, SessionContextUsage } from 'claude-code'

import type { In, MatchedIn, MatchedNext, NextOf } from '../hook-types'

import type { ContextFill } from '../../types'

// The context circle the desktop app moved to the session rail, back in the
// prompt footer: a ring that fills as the live context window does. Full is
// the auto-compact window when one is set (say 400k on a 1M model), else the
// model's window, else a fixed limit from the mod's options.

const fill = atom({ plugin: 'desktop-mods', key: 'contextFill' } as const, null)

const SIZE = 16
const STROKE = 2.5

// The window the compaction limit was last read for: re-read when the model
// (and so the window) changes. Module state; a reload reads it again.
let limitFor = 0
let limit = 0
let isCompactLimit = false

function fmtTok(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function colour(share: number) {
  if (share >= 0.85) return '#e5534b'
  if (share >= 0.6) return '#d29922'
  return '#4f8cff'
}

export function ringSvg(share: number, title: string) {
  const r = (SIZE - STROKE) / 2
  const c = SIZE / 2
  const length = 2 * Math.PI * r
  const shown = Math.min(1, Math.max(0, share))
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<title>${escaped}</title>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#8b8b8b" stroke-opacity="0.35" stroke-width="${STROKE}"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${colour(share)}" stroke-width="${STROKE}" ` +
    `stroke-linecap="round" stroke-dasharray="${(shown * length).toFixed(2)} ${length.toFixed(2)}" ` +
    `transform="rotate(-90 ${c} ${c})"/>` +
    `</svg>`
  )
}

export function describe(f: ContextFill) {
  const pct = Math.round((f.tokens / f.limit) * 100)
  const parts = [`Context ${fmtTok(f.tokens)} of ${fmtTok(f.limit)} (${pct}%)`]
  if (f.isCompactLimit) parts.push('auto-compact window')
  if (f.window !== f.limit) parts.push(`model window ${fmtTok(f.window)}`)

  return parts.join(' · ')
}

// The ring's full mark: the option when set, else the compaction window the
// engine measures /context against, else the model's window.
async function readLimit($: EngineInterface, window: number, fixed: number) {
  if (fixed > 0) {
    limit = fixed
    isCompactLimit = false
    limitFor = window
    return
  }
  if (window === limitFor && limit > 0) return

  limit = window
  isCompactLimit = false
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (b && b.isAutoCompactEnabled && b.rawMaxTokens > 0 && b.rawMaxTokens <= window) {
      limit = b.rawMaxTokens
      isCompactLimit = true
    }
  } catch (err) {
    $.ui.log(`context ring: no breakdown, using the model window: ${String(err)}`, { to: 'debug' })
  }
  limitFor = window
}

async function measure($: EngineInterface, context: SessionContextUsage, fixed: number) {
  if (!context.window) return
  await readLimit($, context.window, fixed)
  // No reading yet (a fresh or just-compacted window): an empty ring.
  const next: ContextFill = { tokens: context.tokens ?? 0, limit, window: context.window, isCompactLimit }
  await update($, fill, () => next)
}

// A fixed full mark from the mod's options; 0 reads the auto-compact window.
let fixed = 0

export function configure(options: PluginOptions): void {
  fixed = typeof options?.contextLimit === 'number' ? Math.max(0, options.contextLimit) : 0
}

export async function sessionStart($: EngineInterface, e: In<'session.start'>, next: NextOf<'session.start'>) {
  const result = await next(e)
  limitFor = 0
  const usage = await $.session.usage().catch(() => null)
  if (usage) await measure($, usage.context, fixed)

  return result
}

export async function sessionMeasure($: EngineInterface, e: In<'session.measure'>, next: NextOf<'session.measure'>) {
  const result = await next(e)
  if (e.changed.includes('context')) await measure($, e.context, fixed)

  return result
}

// A /clear starts the window over.
export async function sessionEnd($: EngineInterface, e: In<'session.end'>, next: NextOf<'session.end'>) {
  const result = await next(e)
  if (e.reason === 'clear') await update($, fill, () => null)

  return result
}

// The terminal's prompt footer: the fill as one more dim mode label. The
// desktop app draws no mod content in its footer (only the band above the
// prompt and panes), so there the ring goes in the band instead.
export async function renderSessionMode($: EngineInterface, e: MatchedIn<'ui.render', { component: 'SessionMode' }>, next: MatchedNext<'ui.render', { component: 'SessionMode' }>) {
  const f = await read($, fill)
  if (!f || e.surface !== 'terminal') return next(e)

  const pct = Math.round((f.tokens / f.limit) * 100)

  return next({ ...e, props: { ...e.props, modes: [`ctx ${pct}%`, ...e.props.modes] } })
}

// The band above the prompt, on the surfaces that draw Svg: the ring on a row
// of its own at the right, nearest the prompt box.
export async function renderAbovePrompt($: EngineInterface, e: MatchedIn<'ui.render', { component: 'AbovePrompt' }>, next: MatchedNext<'ui.render', { component: 'AbovePrompt' }>) {
  const below = await next(e)
  const f = await read($, fill)
  if (!f || e.props.hasSurvey || e.surface === 'terminal') return below

  const els = $.ui.resolve(e)
  if (!('Svg' in els)) return below
  const { Box, Svg } = els
  const label = describe(f)

  // The engine's own node (inside `below`) may not sit under a sized Box: size only the ring's row.
  return (
    <Box flexDirection="column">
      {below}
      <Box flexDirection="row" width={e.props.bodyColumns} justifyContent="flex-end">
        <Svg source={ringSvg(f.tokens / f.limit, label)} alt={label} width={SIZE} height={SIZE} isInteractive />
      </Box>
    </Box>
  )
}
