import { defineDriver as defineSimpleDriver, run, stateCheck as simpleStateCheck } from "@firfi/quint-connect"
import {
  defineDriver as defineEffectDriver,
  ITFBigInt,
  quintRun,
  stateCheck as effectStateCheck
} from "@firfi/quint-connect/effect"
import { ITFBigInt as ZodITFBigInt } from "@firfi/quint-connect/zod"
import { Effect, Schema } from "effect"
import { z } from "zod"

const SimpleCounterState = z.object({ count: ZodITFBigInt })

const simpleDriver = defineSimpleDriver(
  { init: {}, AddHuge: { amount: ZodITFBigInt } },
  () => ({
    init: () => {},
    AddHuge: ({ amount }) => {
      const exact: bigint = amount
      void exact
    },
    getState: () => ({ count: 0n })
  })
)

const simpleProgram: Promise<{ readonly tracesReplayed: number; readonly seed: string }> = run({
  spec: "./packed consumer spec.qnt",
  driver: simpleDriver,
  stateCheck: simpleStateCheck(
    (raw) => SimpleCounterState.parse(raw),
    (specState, implementationState) => specState.count === implementationState.count
  )
})

const effectDriver = defineEffectDriver(
  { init: {}, AddHuge: { amount: ITFBigInt } },
  () => ({
    init: () => Effect.void,
    AddHuge: ({ amount }) =>
      Effect.sync(() => {
        const exact: bigint = amount
        void exact
      }),
    getState: () => Effect.succeed({ count: 0n })
  })
)

const CounterState = Schema.Struct({ count: ITFBigInt })
const effectProgram = quintRun({
  spec: "./packed consumer spec.qnt",
  driverFactory: effectDriver,
  stateCheck: effectStateCheck(
    (raw) => Schema.decodeUnknownEffect(CounterState)(raw),
    (specState, implementationState) => specState.count === implementationState.count
  )
})

void simpleProgram
void effectProgram
