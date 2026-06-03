import { afterEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

const children: FakeChild[] = []

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    writes: [] as string[],
    write: (chunk: string) => {
      this.stdin.writes.push(chunk)
      return true
    },
  }

  kill() {
    queueMicrotask(() => this.emit("exit", null, "SIGTERM"))
    return true
  }
}

mock.module("node:child_process", () => ({
  spawn: () => {
    const child = new FakeChild()
    children.push(child)
    return child
  },
}))

afterEach(() => {
  children.splice(0)
})

describe("codex app-server rpc", () => {
  test("summarizes user-rejected tool stderr without dumping the command", async () => {
    const { formatAppServerStderr } = await import("../src/codex/rpc.ts")

    expect(formatAppServerStderr('ERROR router: error=exec_command failed for `cat > /Users/demo/.codex/skills/demo/SKILL.md`: CreateProcess { message: "Rejected(\\"rejected by user\\")" }')).toEqual({
      level: "warn",
      message: "[codex.app-server] tool execution was rejected by user; suppressed verbose app-server stderr",
    })
  })

  test("times out pending requests instead of waiting forever", async () => {
    const { createAppServerRpc } = await import("../src/codex/rpc.ts")
    const rpc = createAppServerRpc({
      log: { level: "info" },
      storage: { path: ":memory:" },
      feishu: { mode: "off" },
      codex: { directory: "/tmp" },
    })

    await expect(rpc.request("thread/list", {}, { timeout_ms: 20 })).rejects.toThrow(
      "codex app-server thread/list timed out after 20ms",
    )
    await rpc.close()
  })
})
