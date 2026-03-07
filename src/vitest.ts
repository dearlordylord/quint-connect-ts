import { NodeContext } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { test } from "vitest"

import type { QuintRunOptions } from "./runner/runner.js"
import { quintRun } from "./runner/runner.js"
import type { SimpleRunOptions } from "./simple.js"
import { run } from "./simple.js"

const DEFAULT_TIMEOUT = 30000

export const quintTest = <S>(
  name: string,
  opts: SimpleRunOptions<S>,
  timeout?: number | undefined
): void => {
  test(name, async () => {
    await run(opts)
  }, timeout ?? DEFAULT_TIMEOUT)
}

export const quintIt = <S, E>(
  name: string,
  opts: QuintRunOptions<S, E, never>,
  timeout?: number | undefined
): void => {
  it.effect(name, () =>
    quintRun(opts).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.asVoid
    ), { timeout: timeout ?? DEFAULT_TIMEOUT })
}
