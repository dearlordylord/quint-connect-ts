import type { Effect, Schema } from "effect"

export interface Config {
  readonly statePath?: ReadonlyArray<string> | undefined
  readonly nondetPath?: ReadonlyArray<string> | undefined
}

export const defaultConfig: Config = {
  statePath: [],
  nondetPath: []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaFields = { readonly [key: string]: Schema.Schema<any> }

export type ActionPicks<Fields extends SchemaFields> = {
  readonly [K in keyof Fields]: Schema.Schema.Type<Fields[K]>
}

interface ActionDefSchema<Fields extends SchemaFields> {
  readonly picks: Schema.Struct<Fields>
}

interface ActionDefHandler<Fields extends SchemaFields, E, R> {
  readonly handler: (picks: ActionPicks<Fields>) => Effect.Effect<void, E, R>
}

export type ActionDef<Fields extends SchemaFields, E = never, R = never> =
  & ActionDefSchema<Fields>
  & ActionDefHandler<Fields, E, R>

interface AnyActionDefSchema {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly picks: Schema.Struct<Record<string, Schema.Schema<any>>>
}

interface AnyActionDefHandler<E, R> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (picks: any) => Effect.Effect<void, E, R>
}

export type AnyActionDef<E = never, R = never> = AnyActionDefSchema & AnyActionDefHandler<E, R>

export interface ActionMap<E = never, R = never> {
  readonly [action: string]: AnyActionDef<E, R>
}

interface DriverActions<Actions> {
  readonly actions: Actions
}

interface DriverHooks<S, E, R> {
  readonly getState?: () => Effect.Effect<S, E, R>
  readonly config?: () => Config
  readonly step?: (action: string, nondetPicks: ReadonlyMap<string, unknown>) => Effect.Effect<void, E, R>
  readonly onInit?: (rawState: unknown) => Effect.Effect<void, E, R>
}

export type Driver<S, E = never, R = never, Actions = ActionMap<E, R>> =
  & DriverActions<Actions>
  & DriverHooks<S, E, R>

export interface DriverFactory<S, E = never, R = never, Actions = ActionMap<E, R>> {
  readonly create: () => Effect.Effect<Driver<S, E, R, Actions>, E, R>
}

export type PartialActionMap<E = never, R = never> = Partial<Record<string, AnyActionDef<E, R>>>

export type StateComparator<S> = (spec: S, impl: S) => boolean
