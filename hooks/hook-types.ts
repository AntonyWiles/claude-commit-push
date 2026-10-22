import type { HookFor, MatchedHook, Pattern } from 'claude-code'

// The parameter types of a hook, for features that write their hooks as
// function declarations (the form the engine follows `$` into across files).
export type In<P extends Pattern> = Parameters<HookFor<P>>[1]
export type NextOf<P extends Pattern> = Parameters<HookFor<P>>[2]
export type MatchedIn<P extends Pattern, M> = Parameters<MatchedHook<P, M>>[1]
export type MatchedNext<P extends Pattern, M> = Parameters<MatchedHook<P, M>>[2]
