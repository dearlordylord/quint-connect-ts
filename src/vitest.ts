import { NodeContext } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { test } from "vitest"

import type { PartialActionMap } from "./driver/types.js"
import type { QuintRunOptions } from "./runner/runner.js"
import { quintRun } from "./runner/runner.js"
import type { SimpleActionMap, SimpleRunOptions } from "./simple.js"
import { run } from "./simple.js"

const DEFAULT_TIMEOUT = 30000

export const quintTest = <S, Actions extends SimpleActionMap>(
  name: string,
  opts: SimpleRunOptions<S, Actions>,
  timeout?: number | undefined
): void => {
  test(name, async () => {
    return await run(opts)
  }, timeout ?? DEFAULT_TIMEOUT)
}

export const quintIt = <S, Actions extends PartialActionMap<E, never>, E>(
  name: string,
  opts: QuintRunOptions<S, E, never, Actions>,
  timeout?: number | undefined
): void => {
  it.effect(name, () =>
    quintRun(opts).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: timeout ?? DEFAULT_TIMEOUT })
}
