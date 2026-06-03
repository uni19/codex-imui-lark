import readline from "node:readline"
import type { AxiosInstance } from "axios"
import type { ConnState, FeishuConn, InboundEvent } from "../contracts.js"
import { parseCardAction, parseInbound, parseMessage } from "./map.js"

type Input = {
  mode: "stdin" | "long_conn" | "off"
  app_id?: string
  app_secret?: string
  ws_base_url?: string
  ws_endpoint_url?: string
  on_msg: (input: InboundEvent) => Promise<void>
  on_state?: (input: ConnState) => Promise<void>
}

function state(status: ConnState["status"], err?: string, attempt?: number): ConnState {
  return {
    name: "message",
    status,
    updated_at: Date.now(),
    err,
    attempt,
  }
}

type WsLogDiagnostic = {
  text: string
  err?: string
  endpoint_error?: boolean
  suppress?: boolean
}

function wsEndpoint(base?: string, endpoint?: string) {
  if (endpoint) return endpoint
  if (!base) return "飞书长连接 endpoint"
  return `${base.replace(/\/+$/, "")}/callback/ws/endpoint`
}

function redactWsUrl(input?: string) {
  if (!input) return input
  try {
    const url = new URL(input)
    for (const key of ["access_key", "ticket", "token"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "***")
    }
    return url.toString()
  } catch {
    return input
      .replace(/([?&](?:access_key|ticket|token)=)[^&]+/g, "$1***")
      .replace(/(AppSecret=)[^&]+/g, "$1***")
  }
}

export function feishuWsLogSummary(args: unknown[]) {
  const text = args.map(String).join(" ")
  const url = text.match(/wss:\/\/\S+/)?.[0]
  let frontier_host: string | undefined
  if (url) {
    try {
      frontier_host = new URL(redactWsUrl(url)!).host
    } catch {
      frontier_host = undefined
    }
  }
  const config = {
    ping_interval: text.match(/PingInterval["'=:\s]+(\d+)/)?.[1],
    reconnect_interval: text.match(/ReconnectInterval["'=:\s]+(\d+)/)?.[1],
    reconnect_count: text.match(/ReconnectCount["'=:\s]+(-?\d+)/)?.[1],
  }
  return {
    text: url ? text.replace(url, redactWsUrl(url) ?? url) : text,
    frontier_host,
    ...(config.ping_interval || config.reconnect_interval || config.reconnect_count ? { client_config: config } : {}),
  }
}

export function diagnoseFeishuWsLog(
  args: unknown[],
  input: { ws_base_url?: string; ws_endpoint_url?: string; recent_endpoint_error?: boolean } = {},
): WsLogDiagnostic {
  const text = args.map(String).join(" ")
  const code = text.match(/code:\s*(\d+)/)?.[1]
  if (code) {
    if (code === "1000040350") {
      return {
        text,
        endpoint_error: true,
        err: `${wsEndpoint(input.ws_base_url, input.ws_endpoint_url)} 返回 ${code}：长连接数超过限制，请关闭重复运行的进程或稍后重试。`,
      }
    }
    if (code === "403" || code === "514") {
      return {
        text,
        endpoint_error: true,
        err: `${wsEndpoint(input.ws_base_url, input.ws_endpoint_url)} 返回 ${code}：应用鉴权失败，请检查 FEISHU_APP_ID/FEISHU_APP_SECRET 以及长连接事件订阅配置。`,
      }
    }
    if (code !== "0") {
      return {
        text,
        endpoint_error: true,
        err: `${wsEndpoint(input.ws_base_url, input.ws_endpoint_url)} 返回 ${code}：请确认 FEISHU_API_BASE_URL/FEISHU_WS_BASE_URL/FEISHU_WS_ENDPOINT_URL 与应用所属区域一致；飞书中国区通常使用 https://open.feishu.cn，Lark Global 使用 https://open.larksuite.com。`,
      }
    }
  }

  if (text.includes("ClientConfig.PingInterval")) {
    if (input.recent_endpoint_error) {
      return { text, suppress: true }
    }
    return {
      text,
      err: `${wsEndpoint(input.ws_base_url, input.ws_endpoint_url)} 响应缺少 ClientConfig.PingInterval，请检查长连接 endpoint 返回内容。`,
    }
  }

  if (input.recent_endpoint_error && text.includes("connect failed")) {
    return { text, suppress: true }
  }

  return { text }
}

function feishuWsEndpointSummary(data: unknown) {
  const item = data as {
    code?: unknown
    msg?: unknown
    data?: {
      URL?: unknown
      ClientConfig?: {
        PingInterval?: unknown
        ReconnectInterval?: unknown
        ReconnectCount?: unknown
      }
    }
  }
  const wsUrl = typeof item.data?.URL === "string" ? item.data.URL : undefined
  let frontier_host: string | undefined
  if (wsUrl) {
    try {
      frontier_host = new URL(wsUrl).host
    } catch {
      frontier_host = undefined
    }
  }
  const client = item.data?.ClientConfig
  return {
    endpoint_code: item.code,
    endpoint_msg: item.msg,
    frontier_host,
    ...(client
      ? {
          client_config: {
            ping_interval: client.PingInterval,
            reconnect_interval: client.ReconnectInterval,
            reconnect_count: client.ReconnectCount,
          },
        }
      : {}),
  }
}

export function createFeishuConn(input: Input): FeishuConn {
  let rl: readline.Interface | undefined
  let stop: (() => Promise<void>) | undefined
  let last = ""
  let prev: ConnState | undefined
  let count = 0

  const handle = async (line: string) => {
    await input.on_msg(parseInbound(line))
  }

  const save = async (item: ConnState) => {
    const next = [item.name, item.status, item.err ?? "", item.attempt ?? "", item.wait_ms ?? ""].join(":")
    if (last === next) return
    last = next
    prev = item
    await input.on_state?.(item)
  }

  return {
    async start() {
      if (input.mode === "off") {
        await save(state("stopped"))
        return
      }
      if (input.mode === "long_conn") {
        if (!input.app_id || !input.app_secret) {
          throw new Error("missing FEISHU_APP_ID or FEISHU_APP_SECRET")
        }

        const Lark = await import("@larksuiteoapi/node-sdk")
        let lastEndpointErrorAt = 0
        const recentEndpointError = () => lastEndpointErrorAt > 0 && Date.now() - lastEndpointErrorAt < 5000
        const defaultHttpInstance = Lark.defaultHttpInstance as AxiosInstance
        const httpInstance = Object.assign(Object.create(defaultHttpInstance), {
          request: async (options: Parameters<AxiosInstance["request"]>[0]) => {
            const next = {
              ...options,
              ...(input.ws_endpoint_url ? { url: input.ws_endpoint_url } : {}),
            }
            const res = await defaultHttpInstance.request(next)
            console.info("[feishu.ws]", JSON.stringify(feishuWsEndpointSummary(res)))
            return res
          },
        })
        const logger = {
          trace: () => undefined,
          debug: (...args: unknown[]) => {
            const text = args.map(String).join(" ")
            const summary = feishuWsLogSummary(args)
            if (summary.frontier_host) {
              console.info("[feishu.ws]", JSON.stringify(summary))
            }
            if (text.includes("client closed")) {
              count = prev?.status === "reconnecting" ? Math.max(1, count) : count + 1
              save(state("reconnecting", "ws closed", count)).catch((err) => {
                console.error("[feishu.conn]", err)
              })
            }
          },
          info: (...args: unknown[]) => {
            const text = args.map(String).join(" ")
            if (text.includes("ws client ready")) {
              if (recentEndpointError()) return
              count = 0
              save(state("ready")).catch((err) => {
                console.error("[feishu.conn]", err)
              })
              return
            }
            if (text.includes("reconnect")) {
              count = prev?.status === "reconnecting" ? Math.max(1, count) : count + 1
              save(state("reconnecting", undefined, count)).catch((err) => {
                console.error("[feishu.conn]", err)
              })
            }
          },
          warn: (...args: unknown[]) => {
            console.warn(...args)
          },
          error: (...args: unknown[]) => {
            const diagnostic = diagnoseFeishuWsLog(args, {
              ws_base_url: input.ws_base_url,
              ws_endpoint_url: input.ws_endpoint_url,
              recent_endpoint_error: recentEndpointError(),
            })
            if (diagnostic.endpoint_error) lastEndpointErrorAt = Date.now()
            if (diagnostic.suppress) return

            const errText = diagnostic.err ?? diagnostic.text
            save(state("error", errText, count || undefined)).catch((err) => {
              console.error("[feishu.conn]", err)
            })
            if (diagnostic.err) console.error("[feishu.conn]", diagnostic.err)
            else console.error(...args)
          },
        }
        const ws = new Lark.WSClient({
          appId: input.app_id,
          appSecret: input.app_secret,
          ...(input.ws_base_url ? { domain: input.ws_base_url } : {}),
          httpInstance,
          loggerLevel: Lark.LoggerLevel.info,
          logger,
        })

        const eventDispatcher = new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data: unknown) => {
            const item = parseMessage(data)
            if (!item) return
            await input.on_msg(item)
          },
          "card.action.trigger": async (data: unknown) => {
            const item = parseCardAction(data)
            if (!item) return {}
            await input.on_msg(item)
            return {}
          },
          "im.message.message_read_v1": async () => undefined,
        })

        await save(state("connecting"))
        console.info(
          "[feishu.ws]",
          JSON.stringify({
            endpoint_url: wsEndpoint(input.ws_base_url, input.ws_endpoint_url),
            endpoint_body_style: "AppID/AppSecret",
          }),
        )
        Promise.resolve(ws.start({ eventDispatcher })).catch((err) => {
          save(state("error", err instanceof Error ? err.message : String(err))).catch((item) => {
            console.error("[feishu.conn]", item)
          })
          console.error("[feishu.conn]", err)
        })

        stop = async () => {
          await Promise.resolve(ws.close?.())
          await save(state("stopped"))
        }
        return
      }
      await save(state("ready"))
      rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
      })
      rl.on("line", (line) => {
        if (!line.trim()) return
        handle(line).catch((err) => {
          console.error("[feishu.conn]", err)
        })
      })
    },

    async stop() {
      rl?.close()
      await stop?.()
      await save(state("stopped"))
    },
  }
}
