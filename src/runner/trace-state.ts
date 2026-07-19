import { Predicate } from "effect"

export type TraceStateRecord = { readonly [key: string]: unknown }

/** @internal */
export const stripMetadata = (state: TraceStateRecord): TraceStateRecord =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "#meta" && !k.startsWith("mbt::")))

export const resolveNestedValue = (
  obj: TraceStateRecord,
  path: ReadonlyArray<string>
): unknown => {
  let current: unknown = obj
  for (const key of path) {
    if (!Predicate.isObject(current) || !(key in current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}
