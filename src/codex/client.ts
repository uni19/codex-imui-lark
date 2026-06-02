import crypto from "node:crypto"
import path from "node:path"
import type {
  AppCfg,
  CodexAgent,
  CodexCommand,
  CodexMcp,
  CodexProvider,
  CodexResult,
  CodexSession,
  CodexSkill,
  CodexStatus,
  CodexSvc,
  CodexWorkspace,
  PromptPart,
} from "../contracts.js"
import { createAppServerRpc, type AppServerRpc, type RpcMessage } from "./rpc.js"

type Json = Record<string, unknown>

type CodexThread = {
  id: string
  sessionId?: string
  forkedFromId?: string | null
  preview?: string
  name?: string | null
  cwd?: string
  createdAt?: number
  updatedAt?: number
  modelProvider?: string
  turns?: CodexTurn[]
  status?: CodexThreadStatus
}

type CodexThreadStatus = string | { type?: string; activeFlags?: unknown[] }

type CodexTurn = {
  id: string
  status: string
  items?: CodexItem[]
  itemsView?: string
  completedAt?: number | null
  error?: { message?: string } | null
}

type CodexItem =
  | { type: "agentMessage"; text?: string }
  | { type: "plan"; text?: string }
  | { type: "reasoning"; summary?: string[]; content?: string[] }
  | { type: "commandExecution"; command?: string; status?: string; aggregatedOutput?: string | null }
  | { type: string; [key: string]: unknown }

type CodexSkillListItem = {
  name: string
  description?: string
  shortDescription?: string
  path?: string
  enabled?: boolean
}

type CodexSkillsListResponse = {
  data?: Array<{
    cwd?: string
    skills?: CodexSkillListItem[]
    errors?: Array<{ path?: string; message?: string }>
  }>
  entries?: CodexSkillListItem[]
}

type CodexModelListItem = {
  id?: string
  model?: string
  name?: string
  displayName?: string
  serviceTiers?: Array<{ id?: string; name?: string }>
}

type CodexMcpStatusItem = {
  name: string
  status?: string
  error?: string
  authStatus?: string
}

export function mapCodexSkillsListResponse(result: CodexSkillsListResponse): CodexSkill[] {
  const list = result.data?.flatMap((entry) => entry.skills ?? []) ?? result.entries ?? []
  return list.filter((item) => item.enabled !== false).map((item) => ({
    name: item.name,
    description: item.description ?? item.shortDescription ?? "",
    location: item.path ?? "",
  }))
}

const rpcs = new WeakMap<AppCfg, AppServerRpc>()
const turnByThread = new Map<string, string>()

function obj(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" ? input as Record<string, unknown> : undefined
}

function str(input: unknown) {
  return typeof input === "string" && input ? input : undefined
}

function prop(input: unknown, key: string) {
  return obj(input)?.[key]
}

function thread_status_type(status: unknown) {
  return str(status) ?? str(prop(status, "type"))
}

function thread_busy(status: unknown) {
  const type = thread_status_type(status)
  return type === "active" || type === "running" || type === "inProgress" || type === "busy"
}

function codex_status(status: unknown): CodexStatus {
  return thread_busy(status) ? { type: "busy" } : { type: "idle" }
}

function current_protocol_terminal(status: unknown) {
  const val = str(status)
  return val === "completed" || val === "failed" || val === "interrupted"
}

function turn_id_from(input: unknown) {
  return str(prop(input, "turnId")) ?? str(prop(prop(input, "turn"), "id"))
}

function turn_status_from(input: unknown) {
  return str(prop(prop(input, "turn"), "status")) ?? str(prop(input, "status"))
}

function turn_error_from(input: unknown) {
  return str(prop(prop(prop(input, "turn"), "error"), "message")) ?? str(prop(prop(input, "error"), "message")) ?? str(prop(input, "error"))
}

function err_text(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function thread_missing(err: unknown) {
  const text = err_text(err).toLowerCase()
  return text.includes("thread not found") || text.includes("not found") || text.includes("not loaded") || text.includes("unknown thread")
}

function remember_turn(threadId: unknown, turnId: unknown) {
  const thread = str(threadId)
  const turn = str(turnId)
  if (thread && turn) turnByThread.set(thread, turn)
}

function forget_turn(threadId: unknown, turnId: unknown) {
  const thread = str(threadId)
  if (!thread) return
  const turn = str(turnId)
  if (!turn || turnByThread.get(thread) === turn) turnByThread.delete(thread)
}

function rpc(cfg: AppCfg) {
  let item = rpcs.get(cfg)
  if (!item) {
    item = createAppServerRpc(cfg)
    rpcs.set(cfg, item)
    item.request("initialize", {
      clientInfo: {
        name: "codex-feishu-imui",
        title: "Codex Feishu IMUI",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    }).catch((err) => console.error("[codex.initialize]", err))
  }
  return item
}

function dir(val?: string) {
  if (!val) return
  return path.resolve(val)
}

function model_id(input?: { providerID?: string; modelID: string; variant?: string }) {
  if (!input) return undefined
  return input.variant ? `${input.modelID}@${input.variant}` : input.modelID
}

function session(item: CodexThread): CodexSession {
  return {
    id: item.id,
    title: item.name ?? item.preview ?? item.id,
    directory: item.cwd ?? "",
    parent_id: item.forkedFromId ?? undefined,
    created_at: item.createdAt ? item.createdAt * 1000 : 0,
    updated_at: item.updatedAt ? item.updatedAt * 1000 : 0,
    ...(item.modelProvider ? { model: { providerID: item.modelProvider, modelID: "" } } : {}),
  }
}

function text_from_item(item: CodexItem) {
  if ((item.type === "agentMessage" || item.type === "plan") && typeof item.text === "string") return item.text.trim()
  return undefined
}

function inspect_thread(thread: CodexThread | undefined): CodexResult {
  const turns = thread?.turns ?? []
  const entries = turns
    .flatMap((turn) => turn.items ?? [])
    .map(text_from_item)
    .filter((item): item is string => !!item)
  const text = entries.at(-1)
  const completed = turns.some((turn) => !!turn.completedAt || current_protocol_terminal(turn.status))
  const out = {
    ...(entries.length > 0 ? { entries, hash: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex") } : {}),
    ...(completed ? { completed } : {}),
  }
  if (text) return { state: "ok", text, ...out }
  return { state: "empty", ...out }
}

function model_variants(item: CodexModelListItem) {
  const tiers = item.serviceTiers?.map((tier) => tier.id).filter((id): id is string => !!id) ?? []
  return tiers.length > 0 ? tiers : undefined
}

function mcp_status(item: CodexMcpStatusItem): CodexMcp["status"] {
  if (item.status === "disabled") return "disabled"
  if (item.status === "failed") return "failed"
  if (item.status === "needs_client_registration") return "needs_client_registration"
  if (item.status === "needs_auth" || item.authStatus === "notLoggedIn") return "needs_auth"
  return "connected"
}

function permission_profile(params: Json) {
  const req = obj(params.permissions)
  const permissions: Json = {}
  if (Object.prototype.hasOwnProperty.call(req ?? {}, "network")) permissions.network = req?.network ?? undefined
  if (Object.prototype.hasOwnProperty.call(req ?? {}, "fileSystem")) permissions.fileSystem = req?.fileSystem ?? undefined
  return permissions
}

export function rpcResponseId(input: string) {
  return /^-?\d+$/.test(input) ? Number(input) : input
}

function to_input(parts: PromptPart[] | undefined, text?: string) {
  const list = parts ?? (text ? [{ type: "text", text } satisfies PromptPart] : [])
  return list.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text, text_elements: [] }
    if (part.url.startsWith("file://")) return { type: "localImage", path: part.url.slice("file://".length) }
    return { type: "text", text: `[附件] ${part.filename}: ${part.url}`, text_elements: [] }
  })
}

async function request<T = unknown>(cfg: AppCfg, method: string, params: unknown = {}) {
  return (await rpc(cfg).request(method, params)) as T
}

async function resume_thread(cfg: AppCfg, input: { threadId: string; directory?: string; model?: { providerID?: string; modelID: string; variant?: string } }) {
  const result = await request<{ thread: CodexThread }>(cfg, "thread/resume", {
    threadId: input.threadId,
    cwd: dir(input.directory ?? cfg.codex.directory),
    model: model_id(input.model ?? cfg.codex.model),
    modelProvider: input.model?.providerID ?? cfg.codex.model?.providerID,
    approvalsReviewer: "user",
  })
  return result.thread
}

export function createCodexSvc(cfg: AppCfg): CodexSvc {
  return {
    async ensure(input) {
      if (input.session_id) {
        await resume_thread(cfg, {
          threadId: input.session_id,
          directory: input.directory,
          model: input.model,
        }).catch((err) => {
          if (!thread_missing(err)) throw err
        })
        return { id: input.session_id }
      }
      const result = await request<{ thread: CodexThread }>(cfg, "thread/start", {
        cwd: dir(input.directory ?? cfg.codex.directory),
        model: model_id(input.model ?? cfg.codex.model),
        modelProvider: input.model?.providerID ?? cfg.codex.model?.providerID,
        approvalsReviewer: "user",
      })
      if (!result.thread?.id) throw new Error("codex thread/start returned no id")
      return { id: result.thread.id }
    },

    async session(id) {
      const thread = await resume_thread(cfg, { threadId: id }).catch(async (err) => {
        if (!thread_missing(err)) throw err
        const result = await request<{ thread: CodexThread }>(cfg, "thread/read", { threadId: id, includeTurns: false }).catch(() => ({ thread: undefined as unknown as CodexThread }))
        return result.thread
      })
      return thread?.id ? session(thread) : null
    },

    async sessions(input) {
      const result = await request<{ data: CodexThread[] }>(cfg, "thread/list", {
        limit: input.limit ?? 20,
        cwd: dir(input.directory ?? cfg.codex.directory),
        archived: false,
      })
      return (result.data ?? []).map(session)
    },

    async workspaces() {
      return [] satisfies CodexWorkspace[]
    },

    async status() {
      const result = await request<{ data: CodexThread[] }>(cfg, "thread/list", { limit: 200, archived: false, useStateDbOnly: true })
      return Object.fromEntries((result.data ?? []).map((thread) => [thread.id, codex_status(thread.status)]))
    },

    async commands() {
      return [] satisfies CodexCommand[]
    },

    async skills(input = {}) {
      const cwd = dir(input.directory ?? cfg.codex.directory)
      const result = await request<CodexSkillsListResponse>(cfg, "skills/list", {
        cwds: cwd ? [cwd] : undefined,
        forceReload: true,
      }).catch(() => ({ entries: [] }))
      return mapCodexSkillsListResponse(result)
    },

    async agents() {
      return [] satisfies CodexAgent[]
    },

    async providers() {
      const result = await request<{ data: CodexModelListItem[] }>(cfg, "model/list", { includeHidden: true }).catch(() => ({ data: [] }))
      const models = (result.data ?? []).map((item) => {
        const id = item.model ?? item.id ?? ""
        return {
          id,
          name: item.displayName ?? item.name ?? id,
          variants: model_variants(item),
        }
      }).filter((item) => !!item.id)
      return [{ id: "openai", name: "OpenAI", connected: true, models }] satisfies CodexProvider[]
    },

    async mcps() {
      const result = await request<{ data?: CodexMcpStatusItem[]; statuses?: Record<string, { status?: string; error?: string }> }>(cfg, "mcpServerStatus/list", { detail: "toolsAndAuthOnly" }).catch((): { data?: CodexMcpStatusItem[]; statuses?: Record<string, { status?: string; error?: string }> } => ({ data: [] }))
      const list = result.data ?? Object.entries(result.statuses ?? {}).map(([name, item]) => ({ name, ...item }))
      return list.map((item) => ({
        name: item.name,
        status: mcp_status(item),
        error: item.error,
      } satisfies CodexMcp))
    },

    async prompt(input) {
      const params = {
        threadId: input.session_id,
        input: to_input(input.parts, input.text),
        cwd: dir(input.directory ?? cfg.codex.directory),
        model: model_id(input.model),
      }
      const result = await request<{ turn: { id: string } }>(cfg, "turn/start", params).catch(async (err) => {
        if (!thread_missing(err)) throw err
        await resume_thread(cfg, {
          threadId: input.session_id,
          directory: input.directory,
          model: input.model,
        })
        return request<{ turn: { id: string } }>(cfg, "turn/start", params)
      })
      remember_turn(input.session_id, result.turn?.id)
    },

    async abort(input) {
      const turnId = turnByThread.get(input.session_id)
      if (!turnId) return
      await request(cfg, "turn/interrupt", { threadId: input.session_id, turnId })
      forget_turn(input.session_id, turnId)
    },

    async allow(input) {
      const [threadId, turnId, itemId, approvalId, kind] = input.req.split(":")
      const id = rpcResponseId(approvalId)
      const decision = input.reply === "reject" ? "decline" : input.reply === "always" ? "acceptForSession" : "accept"
      if (kind === "permissions") {
        const permissions = input.reply === "reject" ? {} : (() => {
          const encoded = input.req.split(":", 6)[5]
          if (!encoded) return {}
          try {
            return JSON.parse(decodeURIComponent(encoded)) as Json
          } catch {
            return {}
          }
        })()
        await rpc(cfg).respond(id, {
          permissions,
          scope: input.reply === "always" ? "session" : "turn",
        })
      } else if (kind === "exec" || kind === "patch") {
        const legacy = input.reply === "reject" ? "denied" : input.reply === "always" ? "approved_for_session" : "approved"
        await rpc(cfg).respond(id, { decision: legacy })
      } else {
        await rpc(cfg).respond(id, { decision })
      }
      void threadId
      void turnId
      void itemId
    },

    async answer(input) {
      const [, , , requestId] = input.req.split(":")
      await rpc(cfg).respond(rpcResponseId(requestId), {
        answers: Object.fromEntries(input.answers.map((answers, i) => [`q${i}`, { answers }])),
      })
    },

    async reject(input) {
      const [, , , requestId] = input.req.split(":")
      await rpc(cfg).respond(rpcResponseId(requestId), { answers: {} })
    },

    async command(input) {
      await this.prompt({
        session_id: input.session_id,
        text: `/${input.command}${input.arguments ? ` ${input.arguments}` : ""}`,
        directory: input.directory,
        workspace: input.workspace,
        model: input.model,
      })
      return undefined
    },

    async last(input) {
      return (await this.result?.(input))?.text
    },

    async result(input) {
      const result = await request<{ thread: CodexThread }>(cfg, "thread/read", { threadId: input.session_id, includeTurns: true })
      return inspect_thread(result.thread)
    },
  }
}

export function codexEventFromRpc(msg: RpcMessage): { type: string; properties: Json } | undefined {
  const method = msg.method
  const params = (msg.params ?? {}) as Json
  if (!method) return
  if (method === "execCommandApproval") {
    const threadId = params.conversationId ?? params.threadId ?? ""
    const callId = params.callId ?? params.approvalId ?? ""
    const approvalId = msg.id
    const command = Array.isArray(params.command) ? params.command.join(" ") : params.command
    const req = `${threadId}:${callId}:${params.approvalId ?? callId}:${approvalId}:exec`
    return { type: "permission.asked", properties: { sessionID: threadId, id: req, permission: "command", metadata: { command, cwd: params.cwd, reason: params.reason, parsedCmd: params.parsedCmd } } }
  }
  if (method === "applyPatchApproval") {
    const threadId = params.conversationId ?? params.threadId ?? ""
    const callId = params.callId ?? ""
    const approvalId = msg.id
    const req = `${threadId}:${callId}:${callId}:${approvalId}:patch`
    return { type: "permission.asked", properties: { sessionID: threadId, id: req, permission: "file_change", metadata: { reason: params.reason, grantRoot: params.grantRoot, fileChanges: params.fileChanges } } }
  }
  if (method === "item/commandExecution/requestApproval") {
    const req = `${params.threadId}:${params.turnId}:${params.itemId}:${msg.id}:command`
    return { type: "permission.asked", properties: { sessionID: params.threadId, id: req, permission: "command", metadata: { command: params.command, cwd: params.cwd, reason: params.reason } } }
  }
  if (method === "item/fileChange/requestApproval") {
    const req = `${params.threadId}:${params.turnId}:${params.itemId}:${msg.id}:file`
    return { type: "permission.asked", properties: { sessionID: params.threadId, id: req, permission: "file_change", metadata: { reason: params.reason, grantRoot: params.grantRoot } } }
  }
  if (method === "item/permissions/requestApproval") {
    const permissions = permission_profile(params)
    const req = `${params.threadId}:${params.turnId}:${params.itemId}:${msg.id}:permissions:${encodeURIComponent(JSON.stringify(permissions))}`
    return { type: "permission.asked", properties: { sessionID: params.threadId, id: req, permission: "permissions", metadata: { cwd: params.cwd, reason: params.reason, permissions } } }
  }
  if (method === "item/tool/requestUserInput") {
    const req = `${params.threadId}:${params.turnId}:${params.itemId}:${msg.id}:question`
    return { type: "question.asked", properties: { sessionID: params.threadId, id: req, questions: params.questions } }
  }
  if (method === "thread/status/changed") {
    return { type: "session.status", properties: { sessionID: params.threadId, status: codex_status(params.status) } }
  }
  if (method === "turn/started") {
    remember_turn(params.threadId, turn_id_from(params))
    return { type: "session.status", properties: { sessionID: params.threadId, status: { type: "busy" } } }
  }
  if (method === "item/agentMessage/delta") {
    return { type: "message.updated", properties: { sessionID: params.threadId, info: { id: params.itemId, role: "assistant" } } }
  }
  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta" || method === "item/plan/delta" || method === "command/exec/outputDelta" || method === "process/outputDelta") {
    return { type: "message.part.updated", properties: { sessionID: params.threadId, part: { messageID: params.turnId, id: params.itemId, type: method, text: params.delta }, time: Date.now() } }
  }
  if (method === "turn/completed") {
    const turnId = turn_id_from(params)
    forget_turn(params.threadId, turnId)
    if (turn_status_from(params) === "failed") {
      return { type: "session.error", properties: { sessionID: params.threadId, error: turn_error_from(params) ?? params.turn ?? params } }
    }
    return { type: "session.status", properties: { sessionID: params.threadId, status: { type: "idle" } } }
  }
  if (method === "error") {
    return { type: "session.error", properties: { sessionID: params.threadId ?? "", error: params } }
  }
}

export function getCodexRpc(cfg: AppCfg) {
  return rpc(cfg)
}
