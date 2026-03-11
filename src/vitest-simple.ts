import { test } from "vitest"

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
