export type RepoInfo = {
  name: string
  branch: string
  branches: string[]
  changes: number
  added: number
  removed: number
  untracked: number
  ahead: number
  hasUpstream: boolean
}

export type Busy = 'commit' | 'push' | 'switch' | null

declare module 'claude-code' {
  interface PluginState {
    'commit-push': {
      repo: RepoInfo | null
      busy: Busy
      note: string | null
      // Background shells and monitors started this session that have not reported back.
      tasks: string[]
    }
  }
}
