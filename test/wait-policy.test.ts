import { describe, expect, test } from "bun:test"
import { decidePromotedWaitAction, decideQueuedWait, waitReqType, waitStatus } from "../src/app/wait-policy.ts"

describe("wait policy", () => {
  test("maps wait kinds to task status and req type", () => {
    expect(waitReqType("approval")).toBe("permission")
    expect(waitReqType("question")).toBe("question")
    expect(waitStatus("approval")).toBe("waiting_permission")
    expect(waitStatus("question")).toBe("waiting_question")
  })

  test("new head wait is visible only when requested", () => {
    expect(decideQueuedWait({ openCount: 0, visible: true, rowOutboundId: "out_1" })).toEqual({
      isHead: true,
      action: "patch",
      feishuMessageId: "out_1",
    })
    expect(decideQueuedWait({ openCount: 0, visible: false, rowOutboundId: "out_1" })).toEqual({
      isHead: true,
      action: "deferred",
      feishuMessageId: undefined,
    })
    expect(decideQueuedWait({ openCount: 1, visible: true, rowOutboundId: "out_1" })).toEqual({
      isHead: false,
      action: "deferred",
      feishuMessageId: undefined,
    })
  })

  test("promoted wait patches existing card only for first unseen wait", () => {
    expect(decidePromotedWaitAction({
      item: { action: "deferred", seq: 2 },
      row: { outbound_id: "out_1" },
      priorWaitCount: 0,
    })).toBe("patch")
    expect(decidePromotedWaitAction({
      item: { action: "deferred", seq: 2 },
      row: { outbound_id: "out_1" },
      priorWaitCount: 1,
    })).toBe("reply")
    expect(decidePromotedWaitAction({
      item: { action: "deferred", feishu_message_id: "out_wait", seq: 2 },
      row: { outbound_id: "out_1" },
      priorWaitCount: 1,
    })).toBe("patch")
  })
})
