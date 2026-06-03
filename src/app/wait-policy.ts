import type { AssistantOutbound, Task } from "../contracts.js"

export type WaitKind = "approval" | "question"
export type WaitAction = "reply" | "patch" | "deferred"

export function waitReqType(kind: WaitKind) {
  return kind === "approval" ? "permission" : "question"
}

export function waitStatus(kind: WaitKind) {
  return kind === "approval" ? "waiting_permission" : "waiting_question"
}

export function decideQueuedWait(input: { openCount: number; visible: boolean; rowOutboundId?: string }) {
  const isHead = input.openCount === 0
  return {
    isHead,
    action: isHead && input.visible ? (input.rowOutboundId ? "patch" : "reply") : "deferred",
    feishuMessageId: isHead && input.visible ? input.rowOutboundId : undefined,
  } satisfies { isHead: boolean; action: WaitAction; feishuMessageId?: string }
}

export function decidePromotedWaitAction(input: {
  item: Pick<AssistantOutbound, "action" | "feishu_message_id" | "seq">
  row: Pick<Task, "outbound_id">
  priorWaitCount: number
}) {
  if (input.item.feishu_message_id) return "patch" as const
  if (input.item.action === "reply" || input.item.action === "patch") return input.item.action
  return input.priorWaitCount === 0 && input.row.outbound_id ? "patch" : "reply"
}
