import { describe, expect, test } from "bun:test"
import { codexEventFromRpc, mapCodexSkillsListResponse, rpcResponseId, turnStartParams } from "../src/codex/client.ts"
import type { AppCfg } from "../src/contracts.ts"
import { createCodexSvc } from "../src/codex/client.ts"

function cfg() {
  return {
    log: { level: "info" },
    storage: { path: ":memory:" },
    feishu: { mode: "off" },
    codex: {
      directory: "/tmp",
    },
  } satisfies AppCfg
}

describe("codex app-server adapter", () => {
  test("includes expectedTurnId when starting after a known completed turn", () => {
    expect(turnStartParams(cfg(), { session_id: "thr_1", text: "next" }, "turn_old")).toMatchObject({
      threadId: "thr_1",
      expectedTurnId: "turn_old",
      input: [{ type: "text", text: "next", text_elements: [] }],
    })
  })

  test("maps command approval request into gateway permission event", () => {
    expect(codexEventFromRpc({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        command: "echo hi",
        cwd: "/tmp",
      },
    })).toEqual({
      type: "permission.asked",
      properties: {
        sessionID: "thr_1",
        id: "thr_1:turn_1:item_1:7:command",
        permission: "command",
        metadata: {
          command: "echo hi",
          cwd: "/tmp",
          reason: undefined,
        },
      },
    })
  })

  test("maps user input request into gateway question event", () => {
    const questions = [{ id: "q0", question: "继续吗？", options: [{ label: "是" }] }]
    expect(codexEventFromRpc({
      id: "req_1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        questions,
      },
    })).toEqual({
      type: "question.asked",
      properties: {
        sessionID: "thr_1",
        id: "thr_1:turn_1:item_1:req_1:question",
        questions,
      },
    })
  })

  test("maps numeric user input request id into a recoverable question req", () => {
    const questions = [{ id: "q0", question: "继续吗？", options: [{ label: "是" }] }]
    expect(codexEventFromRpc({
      id: 0,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        questions,
      },
    })).toEqual({
      type: "question.asked",
      properties: {
        sessionID: "thr_1",
        id: "thr_1:turn_1:item_1:0:question",
        questions,
      },
    })
  })

  test("maps object thread status active to gateway busy", () => {
    expect(codexEventFromRpc({
      method: "thread/status/changed",
      params: {
        threadId: "thr_1",
        status: { type: "active", activeFlags: [] },
      },
    })).toEqual({
      type: "session.status",
      properties: {
        sessionID: "thr_1",
        status: { type: "busy" },
      },
    })
  })

  test("maps object thread status idle to gateway idle", () => {
    expect(codexEventFromRpc({
      method: "thread/status/changed",
      params: {
        threadId: "thr_1",
        status: { type: "idle" },
      },
    })).toEqual({
      type: "session.status",
      properties: {
        sessionID: "thr_1",
        status: { type: "idle" },
      },
    })
  })

  test("maps turn started with nested turn id to gateway busy", () => {
    expect(codexEventFromRpc({
      method: "turn/started",
      params: {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "inProgress" },
      },
    })).toEqual({
      type: "session.status",
      properties: {
        sessionID: "thr_1",
        turnID: "turn_1",
        status: { type: "busy" },
      },
    })
  })

  test("maps completed turn to gateway idle", () => {
    expect(codexEventFromRpc({
      method: "turn/completed",
      params: {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "completed" },
      },
    })).toEqual({
      type: "session.status",
      properties: {
        sessionID: "thr_1",
        status: { type: "idle" },
      },
    })
  })

  test("maps failed turn to gateway session error", () => {
    expect(codexEventFromRpc({
      method: "turn/completed",
      params: {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "failed", error: { message: "boom" } },
      },
    })).toEqual({
      type: "session.error",
      properties: {
        sessionID: "thr_1",
        error: "boom",
      },
    })
  })

  test("maps current skills/list data response into skills", () => {
    expect(mapCodexSkillsListResponse({
      data: [
        {
          cwd: "/tmp/project",
          skills: [
            {
              name: "analyze",
              description: "Analyze repo",
              path: "/tmp/project/.codex/skills/analyze/SKILL.md",
              scope: "repo",
              enabled: true,
            },
            {
              name: "disabled",
              description: "Hidden",
              path: "/tmp/project/.codex/skills/disabled/SKILL.md",
              scope: "repo",
              enabled: false,
            },
          ],
          errors: [],
        },
      ],
    })).toEqual([
      {
        name: "analyze",
        description: "Analyze repo",
        location: "/tmp/project/.codex/skills/analyze/SKILL.md",
      },
    ])
  })

  test("maps current permissions approval request", () => {
    expect(codexEventFromRpc({
      id: "perm_1",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        cwd: "/tmp/project",
        reason: "need network",
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    })).toEqual({
      type: "permission.asked",
      properties: {
        sessionID: "thr_1",
        id: `thr_1:turn_1:item_1:perm_1:permissions:${encodeURIComponent(JSON.stringify({ network: { enabled: true }, fileSystem: undefined }))}`,
        permission: "permissions",
        metadata: {
          cwd: "/tmp/project",
          reason: "need network",
          permissions: {
            network: { enabled: true },
            fileSystem: undefined,
          },
        },
      },
    })
  })

  test("maps legacy exec command approval request", () => {
    expect(codexEventFromRpc({
      id: "approval_1",
      method: "execCommandApproval",
      params: {
        conversationId: "thr_1",
        callId: "call_1",
        approvalId: null,
        command: ["lark-cli", "docs", "+create"],
        cwd: "/tmp/project",
        reason: "needs keychain",
      },
    })).toEqual({
      type: "permission.asked",
      properties: {
        sessionID: "thr_1",
        id: "thr_1:call_1:call_1:approval_1:exec",
        permission: "command",
        metadata: {
          command: "lark-cli docs +create",
          cwd: "/tmp/project",
          reason: "needs keychain",
          parsedCmd: undefined,
        },
      },
    })
  })

  test("maps legacy apply patch approval request", () => {
    expect(codexEventFromRpc({
      id: "approval_2",
      method: "applyPatchApproval",
      params: {
        conversationId: "thr_1",
        callId: "call_2",
        fileChanges: { "/tmp/project/a.ts": { type: "update", unified_diff: "diff", move_path: null } },
        reason: "needs write",
        grantRoot: "/tmp/project",
      },
    })).toEqual({
      type: "permission.asked",
      properties: {
        sessionID: "thr_1",
        id: "thr_1:call_2:call_2:approval_2:patch",
        permission: "file_change",
        metadata: {
          reason: "needs write",
          grantRoot: "/tmp/project",
          fileChanges: { "/tmp/project/a.ts": { type: "update", unified_diff: "diff", move_path: null } },
        },
      },
    })
  })

  test("maps new command exec output delta", () => {
    expect(codexEventFromRpc({
      method: "command/exec/outputDelta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "hello",
      },
    })).toMatchObject({
      type: "message.part.updated",
      properties: {
        sessionID: "thr_1",
        turnID: "turn_1",
        part: {
          messageID: "turn_1",
          id: "item_1",
          type: "command/exec/outputDelta",
          text: "hello",
        },
      },
    })
  })

  test("unsupported metadata endpoints degrade to empty lists without app-server", async () => {
    const svc = createCodexSvc(cfg())
    expect(await svc.workspaces({ directory: "/tmp" })).toEqual([])
    expect(await svc.commands({ directory: "/tmp" })).toEqual([])
    expect(await svc.agents({ directory: "/tmp" })).toEqual([])
  })

  test("preserves numeric json-rpc request ids when responding", () => {
    expect(rpcResponseId("0")).toBe(0)
    expect(rpcResponseId("42")).toBe(42)
    expect(rpcResponseId("req_1")).toBe("req_1")
  })
})
