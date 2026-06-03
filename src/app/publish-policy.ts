import type { AssistantOutbound, Outbound, RenderOut, Task } from "../contracts.js"

export type PublishKind = "ack" | "progress" | "attachment" | "intermediate" | "final" | "error"

export type PublishPolicyInput = {
  row?: Pick<Task, "outbound_id" | "status_outbound_id" | "note"> | null
  out: RenderOut
  note?: string
  dedup?: boolean
  visible?: Pick<Outbound, "kind" | "payload"> | null
  history?: Array<Pick<AssistantOutbound, "kind" | "state">>
  kind?: PublishKind
}

export type PublishDecision =
  | { action: "skip"; reason: "dedup_visible" | "dedup_note" }
  | { action: "send" }
  | { action: "reply"; first_intermediate: boolean; intermediate_status_target?: string }
  | { action: "patch"; target: string }
  | { action: "final_after_intermediate"; status_target?: string }

export function samePayload(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function decidePublish(input: PublishPolicyInput): PublishDecision {
  const row = input.row
  if (input.dedup && row) {
    if (input.visible && input.visible.kind === input.out.kind && samePayload(input.visible.payload, input.out.body)) {
      return { action: "skip", reason: "dedup_visible" }
    }
    if (!input.visible && row.note && input.note && row.note === input.note) {
      return { action: "skip", reason: "dedup_note" }
    }
  }

  if (!row) return { action: "send" }

  const history = input.history ?? []
  const hasIntermediate = history.some((item) => item.kind === "intermediate" && item.state === "emitted")

  if (row.outbound_id && input.kind === "final" && hasIntermediate) {
    return { action: "final_after_intermediate", status_target: row.status_outbound_id }
  }

  if (row.outbound_id && input.kind !== "intermediate") {
    return { action: "patch", target: row.outbound_id }
  }

  return {
    action: "reply",
    first_intermediate: input.kind === "intermediate" && !row.status_outbound_id && !hasIntermediate,
    intermediate_status_target: row.outbound_id,
  }
}
