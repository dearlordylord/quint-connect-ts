import type { SimpleActionMap, SimpleRunOptions } from "./simple.js"
import { run } from "./simple.js"

const DEFAULT_TIMEOUT = 30000

export const quintTest = <S, Actions extends SimpleActionMap>(
  testFn: (name: string, fn: () => Promise<unknown>, timeout?: number) => void,
  name: string,
  opts: SimpleRunOptions<S, Actions>,
  timeout?: number | undefined
): void => {
  testFn(name, async () => {
    return await run(opts)
  }, timeout ?? DEFAULT_TIMEOUT)
}
