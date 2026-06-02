import type { AppCfg, ConnState, CodexEvent, CodexEventSvc, Store } from "../contracts.js"
import { codexEventFromRpc, getCodexRpc } from "./client.js"

type Input = {
  cfg: AppCfg
  store: Store
  on_event: (event: CodexEvent) => Promise<void>
  on_state?: (input: ConnState) => Promise<void>
}

function state(status: ConnState["status"], err?: string): ConnState {
  return {
    name: "codex",
    status,
    updated_at: Date.now(),
    err,
  }
}

export function createCodexEvent(input: Input): CodexEventSvc {
  let off: (() => void) | undefined
  let live = false

  const save = async (item: ConnState) => {
    await input.store.set_conn(item)
    await input.on_state?.(item)
  }

  return {
    async start() {
      if (live) return
      live = true
      await save(state("connecting"))
      const rpc = getCodexRpc(input.cfg)
      off = rpc.on_message((msg) => {
        const event = codexEventFromRpc(msg)
        if (!event) return
        input.on_event(event).catch((err) => console.error("[codex.event.on_event]", err))
      })
      await save(state("ready"))
    },

    async stop() {
      if (!live) return
      live = false
      off?.()
      off = undefined
      await save(state("stopped"))
    },
  }
}
