/**
 * Workaround: @firfi/itf-trace-parser is compiled against Effect 3.
 * Its Schema types report `any` for DecodingServices in Effect 4 context.
 * This helper creates a `stateCheck` that accepts the wider R type.
 *
 * TODO: Remove this file once itf-trace-parser supports Effect 4.
 */
import { Effect, Schema } from "effect"

import type { StateCheck } from "../src/runner/runner.js"

export const stateCheckCompat = <S>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deserializeState: (raw: unknown) => Effect.Effect<S, never, any>,
  compareState: (spec: S, impl: S) => boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): StateCheck<S> => ({ compareState, deserializeState: deserializeState as any })

export const decodeOrDie = <S extends Schema.Top>(schema: S) => (raw: unknown): Effect.Effect<S["Type"]> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Schema.decodeUnknownEffect(schema)(raw).pipe(Effect.orDie) as any
