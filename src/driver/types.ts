import type { Effect } from "effect"

export interface Step {
  readonly action: string
  readonly nondetPicks: ReadonlyMap<string, unknown>
  readonly rawState: { readonly [key: string]: unknown }
}

export interface Config {
  readonly statePath: ReadonlyArray<string>
}

export const defaultConfig: Config = {
  statePath: []
}

export interface Driver<S, E = never, R = never> {
  readonly step: (step: Step) => Effect.Effect<void, E, R>
  readonly getState: () => Effect.Effect<S, E, R>
  readonly config?: () => Config
}

export interface DriverFactory<S, E = never, R = never> {
  readonly create: () => Effect.Effect<Driver<S, E, R>, E, R>
}

export type StateComparator<S> = (spec: S, impl: S) => boolean
