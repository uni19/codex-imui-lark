import { describe, expect, test } from "bun:test"
import { CodexTurnState } from "../src/codex/turn-state.ts"

describe("codex turn state", () => {
  test("tracks active turns and consumes stale expected turn once", () => {
    const state = new CodexTurnState()
    state.remember("thr_1", "turn_1")
    expect(state.active("thr_1")).toBe("turn_1")

    state.complete("thr_1", "turn_1")
    expect(state.active("thr_1")).toBeUndefined()
    expect(state.consumeStale("thr_1")).toBe("turn_1")
    expect(state.consumeStale("thr_1")).toBeUndefined()
  })

  test("does not forget a newer active turn when an old turn completes", () => {
    const state = new CodexTurnState()
    state.remember("thr_1", "turn_old")
    state.remember("thr_1", "turn_new")
    state.complete("thr_1", "turn_old")

    expect(state.active("thr_1")).toBe("turn_new")
    expect(state.consumeStale("thr_1")).toBe("turn_old")
  })

  test("abort returns active turn and marks it stale", () => {
    const state = new CodexTurnState()
    state.remember("thr_1", "turn_1")
    expect(state.abort("thr_1")).toBe("turn_1")
    expect(state.active("thr_1")).toBeUndefined()
    expect(state.consumeStale("thr_1")).toBe("turn_1")
  })
})
