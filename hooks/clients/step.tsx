// One next-step suggestion on the desktop, a Client of its own so the pointer
// is told apart by row however tall the surface draws a row: it posts
// `{ enter }` when the pointer comes onto it and `{ leave }` when it goes,
// and the hooks module decides, 200ms later, which prompt to preview. A press
// posts `{ pick }`, the last row's dismiss `{ dismiss }`. No `$` here.

import type { ClientModule } from 'claude-code'

export type StepProps = { index: number; label: string; isLast: boolean }

// Mutable on purpose: the pointer writes it between redraws, and nothing it
// holds is drawn, so it never asks for one.
type StepState = { index: number; isInside: boolean }

const Step: ClientModule<StepProps, StepState> = (props, surface) => {
  const { Box, Button } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ index: props.index, isInside: false })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined) return
      const isInside = event.type !== 'leave'
      if (isInside === state.isInside) return
      state.isInside = isInside
      surface.post(isInside ? { enter: state.index } : { leave: state.index })
    })
  } else {
    surface.state.index = props.index
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Button
          key={`next-steps:${props.index + 1}`}
          hotkey={String(props.index + 1)}
          plain
          label={props.label}
          onPress={() => surface.post({ pick: props.index })}
        />
      </Box>
      {props.isLast ? (
        <Button key="next-steps:dismiss" hotkey="0" plain label="dismiss" onPress={() => surface.post({ dismiss: true })} />
      ) : null}
    </Box>
  )
}

export default Step
