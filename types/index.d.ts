export type RepoInfo = {
  branch: string
  changes: number
  ahead: number
  hasUpstream: boolean
}

export type Busy = 'commit' | 'push' | null

declare module 'claude-code' {
  interface PluginState {
    'commit-push': { repo: RepoInfo | null; busy: Busy; note: string | null }
  }
}
