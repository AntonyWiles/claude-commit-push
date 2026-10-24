// Text links on the desktop, where a Button is always a native button: each
// link is underlined accent text, bold under the pointer, and a click posts
// `{ press: id }` to the hooks module. A busy link is drawn dim and ignores
// clicks. The surface module has no `$`.

import type { ClientModule } from 'claude-code'

export type LinksProps = {
  links: { id: string; label: string; isBusy?: boolean }[]
}

type Span = { id: string; from: number; to: number; isBusy: boolean }
type LinksState = { spans: Span[]; hovered: string | null }

const GAP = 2

function spansOf(links: LinksProps['links']): Span[] {
  let x = 0
  return links.map(link => {
    const span = { id: link.id, from: x, to: x + [...link.label].length, isBusy: link.isBusy === true }
    x = span.to + GAP
    return span
  })
}

const Links: ClientModule<LinksProps, LinksState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const spans = spansOf(props.links)

  if (surface.state === undefined) {
    surface.setState({ spans, hovered: null })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined) return
      const under = event.type === 'leave' ? undefined : state.spans.find(s => event.x >= s.from && event.x < s.to && event.y === 0)
      if (event.type === 'down' && event.button === 'left' && under !== undefined && !under.isBusy) {
        surface.post({ press: under.id })
      }
      const hovered = under?.id ?? null
      if (hovered !== state.hovered) surface.setState({ ...state, hovered })
    })
  } else {
    // The labels change as a link works ("Committing..."): keep the spans current.
    surface.state.spans = spans
  }

  const hovered = surface.state?.hovered ?? null

  return (
    <Box flexDirection="row" gap={GAP}>
      {props.links.map(link => (
        <Text
          key={`link:${link.id}`}
          color={link.isBusy ? undefined : 'suggestion'}
          dimColor={link.isBusy === true}
          underline={!link.isBusy}
          bold={hovered === link.id && !link.isBusy}
        >
          {link.label}
        </Text>
      ))}
    </Box>
  )
}

export default Links
