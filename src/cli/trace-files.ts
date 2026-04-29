import { Effect, Schema } from "effect"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { ItfTrace } from "../itf/schema.js"
import { QuintError } from "./errors.js"

export type ItfTraceJson = Readonly<Record<string, unknown>>

const traceFileName = (index: number): string => `trace_${index}.itf.json`

const stringifyItfJson = (trace: ItfTraceJson): string =>
  JSON.stringify(trace, (_key, value: unknown) => typeof value === "bigint" ? { "#bigint": String(value) } : value)

export const writeTraceFiles = (
  outDir: string,
  traces: ReadonlyArray<ItfTraceJson>
): Effect.Effect<ReadonlyArray<string>, QuintError> =>
  Effect.tryPromise({
    try: () =>
      Promise.all(
        traces.map(async (trace, index) => {
          const filePath = join(outDir, traceFileName(index))
          await writeFile(filePath, stringifyItfJson(trace))
          return filePath
        })
      ),
    catch: (e) => new QuintError({ message: `Failed to write trace file: ${e}` })
  })

export const readTraceFiles = (
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError> =>
  Effect.gen(function*() {
    const files = yield* Effect.tryPromise({
      try: () => readdir(outDir),
      catch: (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    })
    const traceFiles = files.filter((file) => file.endsWith(".itf.json")).sort()
    const traces: Array<ItfTrace> = []
    for (const file of traceFiles) {
      const content = yield* Effect.tryPromise({
        try: () => readFile(join(outDir, file), "utf-8"),
        catch: (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      })
      const json: unknown = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (e) => new QuintError({ message: `Invalid JSON in trace file ${file}: ${e}` })
      })
      const trace = yield* Effect.mapError(
        Schema.decodeUnknown(ItfTrace)(json),
        (e) => new QuintError({ message: `Failed to parse ITF trace ${file}: ${e}` })
      )
      traces.push(trace)
    }
    return traces
  })
