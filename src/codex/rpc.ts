import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { AppCfg } from "../contracts.js"

type Json = Record<string, unknown>

type Pending = {
  method: string
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeout?: ReturnType<typeof setTimeout>
}

export type RpcMessage = Json & {
  id?: string | number
  method?: string
  params?: Json
  result?: unknown
  error?: unknown
}

export type AppServerRpc = {
  request(method: string, params?: unknown, opts?: { timeout_ms?: number }): Promise<unknown>
  respond(id: string | number, result?: unknown, error?: unknown): void
  on_message(fn: (msg: RpcMessage) => void): () => void
  close(): Promise<void>
}

export const DEFAULT_RPC_TIMEOUT_MS = 30_000

function as_error(input: unknown) {
  if (!input) return new Error("codex app-server request failed")
  if (typeof input === "string") return new Error(input)
  if (typeof input === "object" && "message" in input) return new Error(String((input as { message?: unknown }).message))
  return new Error(JSON.stringify(input))
}

function parse_lines(buf: string) {
  const list: string[] = []
  while (true) {
    const idx = buf.indexOf("\n")
    if (idx < 0) break
    const raw = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (raw) list.push(raw)
  }
  return { list, rest: buf }
}

export function createAppServerRpc(cfg: AppCfg): AppServerRpc {
  const args = ["app-server", "--stdio"]
  if (cfg.codex.model) args.push("-c", `model=${JSON.stringify(cfg.codex.model.modelID)}`)
  const child = spawn("codex", args, {
    cwd: cfg.codex.directory,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams

  let seq = 0
  let closed = false
  let buf = ""
  const pending = new Map<string | number, Pending>()
  const listeners = new Set<(msg: RpcMessage) => void>()

  const send = (msg: unknown) => {
    if (closed) throw new Error("codex app-server rpc is closed")
    child.stdin.write(JSON.stringify(msg) + "\n")
  }

  child.stdout.on("data", (chunk: Buffer) => {
    const parsed = parse_lines(buf + chunk.toString("utf8"))
    buf = parsed.rest
    for (const line of parsed.list) {
      let msg: RpcMessage
      try {
        msg = JSON.parse(line) as RpcMessage
      } catch (err) {
        console.error("[codex.rpc.parse]", err, line)
        continue
      }
      if (Object.prototype.hasOwnProperty.call(msg, "id") && ("result" in msg || "error" in msg)) {
        const waiter = pending.get(msg.id as string | number)
        if (waiter) {
          pending.delete(msg.id as string | number)
          if (waiter.timeout) clearTimeout(waiter.timeout)
          if (msg.error) waiter.reject(as_error(msg.error))
          else waiter.resolve(msg.result)
        }
      }
      for (const fn of listeners) fn(msg)
    }
  })

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim()
    if (text) console.error("[codex.app-server]", text)
  })

  child.on("exit", (code, signal) => {
    closed = true
    const err = new Error(`codex app-server exited: code=${code ?? ""} signal=${signal ?? ""}`)
    for (const waiter of pending.values()) {
      if (waiter.timeout) clearTimeout(waiter.timeout)
      waiter.reject(err)
    }
    pending.clear()
  })

  return {
    request(method, params = {}, opts = {}) {
      const id = ++seq
      const timeout_ms = opts.timeout_ms ?? DEFAULT_RPC_TIMEOUT_MS
      return new Promise((resolve, reject) => {
        const timeout = timeout_ms > 0
          ? setTimeout(() => {
              pending.delete(id)
              reject(new Error(`codex app-server ${method} timed out after ${timeout_ms}ms`))
            }, timeout_ms)
          : undefined
        pending.set(id, { method, resolve, reject, timeout })
        try {
          send({ jsonrpc: "2.0", id, method, params })
        } catch (err) {
          pending.delete(id)
          if (timeout) clearTimeout(timeout)
          reject(err)
        }
      })
    },

    respond(id, result, error) {
      const msg = error
        ? { jsonrpc: "2.0", id, error }
        : { jsonrpc: "2.0", id, result: result ?? {} }
      send(msg)
    },

    on_message(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    async close() {
      if (closed) return
      closed = true
      child.kill("SIGTERM")
      await new Promise<void>((resolve) => child.once("exit", () => resolve()))
    },
  }
}
