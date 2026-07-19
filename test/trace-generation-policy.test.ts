import { ConfigProvider, Effect } from "effect"
import { describe, expect, it } from "vitest"

import { isCompiledEvaluatorPolicy, resolveTraceGenerationPolicy } from "../src/cli/trace-generation-policy.js"

describe("trace generation policy", () => {
  it("owns run-mode command, arguments, and compiled-input eligibility", async () => {
    const policy = resolveTraceGenerationPolicy({
      spec: "counter.qnt",
      seed: "42",
      compiledInput: "counter.evaluator.json"
    })

    expect(policy.mode).toBe("run")
    expect(policy.command).toBe("quint run")
    await expect(Effect.runPromise(policy.buildCliArgs("/tmp/traces"))).resolves.toEqual([
      "run",
      "counter.qnt",
      "--mbt",
      "--n-traces",
      "10",
      "--out-itf",
      "/tmp/traces/trace_{seq}.itf.json",
      "--backend",
      "typescript",
      "--seed",
      "42",
      "--max-samples",
      "10000"
    ])
    expect(isCompiledEvaluatorPolicy(policy)).toBe(true)
    if (isCompiledEvaluatorPolicy(policy)) {
      expect(policy.options.compiledInput).toBe("counter.evaluator.json")
    }
  })

  it("owns test-mode command, exact matching, and compiled-input exclusion", async () => {
    const policy = resolveTraceGenerationPolicy({
      spec: "scenarios.qnt",
      generation: { mode: "test", test: "scenario.with+syntax" }
    })

    expect(policy.mode).toBe("test")
    expect(policy.command).toBe("quint test")
    await expect(Effect.runPromise(policy.buildCliArgs("/tmp/traces"))).resolves.toEqual([
      "test",
      "scenarios.qnt",
      "--match",
      "^scenario\\.with\\+syntax$",
      "--max-samples",
      "10",
      "--out-itf",
      "/tmp/traces/trace_{seq}.itf.json",
      "--verbosity",
      "0",
      "--backend",
      "typescript"
    ])
    expect(isCompiledEvaluatorPolicy(policy)).toBe(false)
  })

  it("reads a valid backend through Effect Config and fails fast on malformed configuration", async () => {
    const policy = resolveTraceGenerationPolicy({ spec: "counter.qnt" })
    const withBackend = (backend: string) =>
      Effect.provide(
        policy.buildCliArgs("/tmp"),
        ConfigProvider.layer(ConfigProvider.fromUnknown({ QUINT_BACKEND: backend }))
      )

    await expect(Effect.runPromise(withBackend("rust"))).resolves.toContain("rust")
    await expect(Effect.runPromise(withBackend("invalid"))).rejects.toMatchObject({
      _tag: "QuintError",
      message: expect.stringContaining("QUINT_BACKEND")
    })
  })

  it("connects the policy mode to the canonical generation discriminator", () => {
    expect(resolveTraceGenerationPolicy({ spec: "counter.qnt" }).mode).toBe("run")
    expect(
      resolveTraceGenerationPolicy({
        spec: "counter.qnt",
        generation: { mode: "test", test: "scenario" }
      }).mode
    ).toBe("test")
  })
})
