import type { AppCfg, CodexModel } from "../contracts.js"
import path from "node:path"
import { configDir, dataDir } from "./env.js"
import { normalizeWorkspace } from "../workspace.js"

export function parseCodexModel(val?: string): CodexModel | undefined {
  const input = val?.trim()
  if (!input) return
  const slash = input.indexOf("/")
  const providerID = slash > 0 ? input.slice(0, slash) : undefined
  const rest = slash > 0 ? input.slice(slash + 1) : input
  if (!rest) return
  const at = rest.lastIndexOf("@")
  const modelID = at > 0 ? rest.slice(0, at) : rest
  const variant = at > 0 ? rest.slice(at + 1) : undefined
  if (!modelID || (at > 0 && !variant)) return
  return {
    ...(providerID ? { providerID } : {}),
    modelID,
    ...(variant ? { variant } : {}),
  }
}

function base() {
  return configDir()
}

function data() {
  return dataDir()
}

function level() {
  const val = process.env.LOG_LEVEL
  if (val === "debug") return val
  if (val === "warn") return val
  if (val === "error") return val
  return "info"
}

function mode() {
  if (process.env.FEISHU_MODE === "off") return "off" as const
  if (process.env.FEISHU_MODE === "long_conn") return "long_conn" as const
  return "stdin" as const
}

function model(): CodexModel | undefined {
  return parseCodexModel(process.env.CODEX_MODEL)
}

function dir(val?: string) {
  if (!val) return
  return path.resolve(base(), val)
}

function runtimeDir(val: string | undefined, root: string, fallback: string) {
  if (!val) return fallback
  return path.resolve(root, val)
}

function num(val: string | undefined, fallback: number) {
  if (!val?.trim()) return fallback
  const parsed = Number(val)
  return Number.isFinite(parsed) ? parsed : fallback
}

function feishuApiBaseUrl() {
  return process.env.FEISHU_API_BASE_URL || "https://open.feishu.cn/open-apis"
}

export function feishuWsBaseUrl(input: { api_base_url?: string; ws_base_url?: string }) {
  if (input.ws_base_url?.trim()) return input.ws_base_url
  if (!input.api_base_url) return
  try {
    return new URL(input.api_base_url).origin
  } catch {
    return undefined
  }
}

export function cfg(): AppCfg {
  const config_dir = base()
  const data_dir = data()
  const asset_dir = runtimeDir(process.env.IMUI_ASSET_CACHE_DIR, data_dir, path.join(data_dir, "asset"))
  const backup_dir = runtimeDir(process.env.IMUI_BACKUP_DIR, data_dir, path.join(data_dir, "backup"))
  const api_base_url = feishuApiBaseUrl()

  return {
    log: {
      level: level(),
    },
    storage: {
      path:
        process.env.IMUI_DB_PATH === ":memory:"
          ? ":memory:"
          : path.resolve(config_dir, process.env.IMUI_DB_PATH ?? ".data/imui.db"),
    },
    runtime: {
      config_dir,
      data_dir,
      asset_dir,
      asset_ttl_hours: num(process.env.IMUI_ASSET_TTL_HOURS, 7 * 24),
      asset_max_mb: num(process.env.IMUI_ASSET_MAX_MB, 1024),
      backup_dir,
      backup_retention_days: num(process.env.IMUI_BACKUP_RETENTION_DAYS, 14),
    },
    feishu: {
      mode: mode(),
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
      bot_id: process.env.FEISHU_BOT_OPEN_ID,
      api_base_url,
      ws_base_url: feishuWsBaseUrl({
        api_base_url,
        ws_base_url: process.env.FEISHU_WS_BASE_URL,
      }),
    },
    codex: {
      base_url: process.env.CODEX_BASE_URL ?? "http://127.0.0.1:4096",
      username: process.env.CODEX_USERNAME ?? "codex",
      password: process.env.CODEX_PASSWORD,
      directory: dir(process.env.CODEX_DIRECTORY),
      workspace: normalizeWorkspace(process.env.CODEX_WORKSPACE),
      agent: process.env.CODEX_AGENT,
      model: model(),
    },
  }
}
