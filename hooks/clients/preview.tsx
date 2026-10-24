// The preview area under the next-step suggestions on the desktop: the full
// prompt the hooks module chose, or a hint. It posts `{ enter }` and
// `{ leave }` too, so the prompt shown stays while the pointer is down here
// reading it. No `$` here.

import type { ClientModule } from 'claude-code'

export type PreviewProps = { text: string; isHint: boolean; rows: number }

type PreviewState = { isInside: boolean }

const Preview: ClientModule<PreviewProps, PreviewState> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ isInside: false })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined) return
      const isInside = event.type !== 'leave'
      if (isInside === state.isInside) return
      state.isInside = isInside
      surface.post(isInside ? { enter: 'preview' } : { leave: 'preview' })
    })
  }

  return (
    <Box height={props.rows} overflow="hidden" flexGrow={1}>
      <Text dimColor wrap={props.isHint ? 'truncate-end' : 'wrap'}>
        ↳ {props.text}
      </Text>
    </Box>
  )
}

export default Preview
