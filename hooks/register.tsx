import type { Register } from 'claude-code'

import {
  configure as configureRing,
  renderAbovePrompt as ringRenderAbovePrompt,
  renderSessionMode as ringRenderSessionMode,
  sessionEnd as ringSessionEnd,
  sessionMeasure as ringSessionMeasure,
  sessionStart as ringSessionStart,
} from './features/context-ring'
import {
  renderAbovePrompt as gitRenderAbovePrompt,
  sessionAppend as gitSessionAppend,
  sessionStart as gitSessionStart,
  toolCall as gitToolCall,
  turnComplete as gitTurnComplete,
  turnStart as gitTurnStart,
} from './features/git-bar'
import {
  configure as configureNext,
  renderAbovePrompt as nextRenderAbovePrompt,
  turnComplete as nextTurnComplete,
  turnStart as nextTurnStart,
} from './features/next-steps'
import {
  agentSpawn as usageAgentSpawn,
  renderAbovePrompt as usageRenderAbovePrompt,
  renderPane as usageRenderPane,
  runBurn as usageRunBurn,
  sessionEnd as usageSessionEnd,
  sessionMeasure as usageSessionMeasure,
  sessionStart as usageSessionStart,
  toolCallBash as usageToolCallBash,
  turnComplete as usageTurnComplete,
  turnStart as usageTurnStart,
  turnStep as usageTurnStep,
} from './features/usage-meter'

// One mod, four features, each switched on or off in the mod's options (the
// config menu, or `pluginConfigs` in settings); a change reloads the module.
//
// A module hooks each event once, so where several features hook the same
// event they are chained here by hand: each feature's hook gets the next
// feature's as its `next`, the last one the engine's. A feature that is off
// passes straight through. In the band above the prompt each hook draws what
// is beneath it and then its own rows, so the first in a chain draws lowest:
// the context ring sits closest to the prompt, then next steps, git, and usage on top.
export const register: Register = (on, options) => {
  const isOn = (name: string) => options?.[name] !== false
  const ring = isOn('contextRing')
  const git = isOn('gitBar')
  const usage = isOn('usageMeter')
  const steps = isOn('nextSteps')

  configureRing(options)
  configureNext(options)

  on('session.start', ($, e, next) => {
    const toRing = (ev: typeof e) => (ring ? ringSessionStart($, ev, next) : next(ev))
    const toUsage = (ev: typeof e) => (usage ? usageSessionStart($, ev, toRing as never) : toRing(ev))

    return git ? gitSessionStart($, e, toUsage as never) : toUsage(e)
  })

  on('session.end', ($, e, next) => {
    const toRing = (ev: typeof e) => (ring ? ringSessionEnd($, ev, next) : next(ev))

    return usage ? usageSessionEnd($, e, toRing as never) : toRing(e)
  })

  on('session.measure', ($, e, next) => {
    const toRing = (ev: typeof e) => (ring ? ringSessionMeasure($, ev, next) : next(ev))

    return usage ? usageSessionMeasure($, e, toRing as never) : toRing(e)
  })

  on('session.append', ($, e, next) => (git ? gitSessionAppend($, e, next) : next(e)))

  on('turn.start', ($, e, next) => {
    const toUsage = (ev: typeof e) => (usage ? usageTurnStart($, ev, next) : next(ev))
    const toGit = (ev: typeof e) => (git ? gitTurnStart($, ev, toUsage as never) : toUsage(ev))

    return steps ? nextTurnStart($, e, toGit as never) : toGit(e)
  })

  on('turn.complete', ($, e, next) => {
    const toUsage = (ev: typeof e) => (usage ? usageTurnComplete($, ev, next) : next(ev))
    const toGit = (ev: typeof e) => (git ? gitTurnComplete($, ev, toUsage as never) : toUsage(ev))

    return steps ? nextTurnComplete($, e, toGit as never) : toGit(e)
  })

  on('agent.spawn', ($, e, next) => (usage ? usageAgentSpawn($, e, next) : next(e)))

  on('tool.call', ($, e, next) => {
    const toUsage = (ev: typeof e) => (usage && ev.tool === 'Bash' ? usageToolCallBash($, ev as never, next as never) : next(ev))

    return git ? gitToolCall($, e, toUsage as never) : toUsage(e)
  })

  on('turn.step', async function* ($, e, next) {
    return usage ? yield* usageTurnStep($, e, next) : yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const toUsage = (ev: typeof e) => (usage ? usageRenderAbovePrompt($, ev, next) : next(ev))
    const toGit = (ev: typeof e) => (git ? gitRenderAbovePrompt($, ev, toUsage as never) : toUsage(ev))
    const toSteps = (ev: typeof e) => (steps ? nextRenderAbovePrompt($, ev, toGit as never) : toGit(ev))

    return ring ? ringRenderAbovePrompt($, e, toSteps as never) : toSteps(e)
  })

  on('ui.render', { component: 'SessionMode' }, ($, e, next) => (ring ? ringRenderSessionMode($, e, next) : next(e)))

  if (usage) {
    on('ui.render', { component: 'Pane', requestId: 'usage-meter' }, ($, e) => usageRenderPane($, e))
    on('command.run', { command: 'burn' }, ($, e) => usageRunBurn($, e))
  }
}
