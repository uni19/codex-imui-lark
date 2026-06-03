import { describe, expect, test } from "bun:test"
import { decidePublish } from "../src/app/publish-policy.ts"
import type { RenderOut } from "../src/contracts.ts"

const out = { kind: "card", body: { text: "done" } } satisfies RenderOut

describe("publish policy", () => {
  test("dedups against visible payload", () => {
    expect(decidePublish({
      row: { outbound_id: "out_1", note: undefined },
      out,
      dedup: true,
      visible: { kind: "card", payload: { text: "done" } },
      kind: "progress",
    })).toEqual({ action: "skip", reason: "dedup_visible" })
  })

  test("patches existing visible slot unless publishing intermediate", () => {
    expect(decidePublish({
      row: { outbound_id: "out_1", note: undefined },
      out,
      history: [],
      kind: "final",
    })).toEqual({ action: "patch", target: "out_1" })
  })

  test("final after emitted intermediate replies and patches status target", () => {
    expect(decidePublish({
      row: { outbound_id: "out_final", status_outbound_id: "out_status", note: undefined },
      out,
      history: [{ kind: "intermediate", state: "emitted" }],
      kind: "final",
    })).toEqual({ action: "final_after_intermediate", status_target: "out_status" })
  })

  test("first intermediate preserves current visible slot as status target", () => {
    expect(decidePublish({
      row: { outbound_id: "out_ack", note: undefined },
      out,
      history: [],
      kind: "intermediate",
    })).toEqual({
      action: "reply",
      first_intermediate: true,
      intermediate_status_target: "out_ack",
    })
  })
})
