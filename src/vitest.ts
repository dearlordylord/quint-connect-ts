import type { Effect } from "effect"

import type { PartialActionMap } from "./driver/types.js"
import type { QuintRunOptions } from "./runner/runner.js"
import { quintRun } from "./runner/runner.js"

export { quintTest } from "./vitest-simple.js"

const DEFAULT_TIMEOUT = 30000

export const quintIt = <S, Actions extends PartialActionMap<E, never>, E>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itEffect: (name: string, fn: () => Effect.Effect<any, any, any>, options?: { readonly timeout?: number }) => void,
  name: string,
  opts: QuintRunOptions<S, E, never, Actions>,
  timeout?: number | undefined
): void => {
  itEffect(name, () => quintRun(opts), { timeout: timeout ?? DEFAULT_TIMEOUT })
}
