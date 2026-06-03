import { accessSync, constants, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import type { AppCfg } from "../contracts.js"
import { parseWorkspaceSelection } from "../workspace.js"

export type ValidateReport = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function add(list: string[], text: string) {
  if (!list.includes(text)) list.push(text)
}

function validURL(text?: string) {
  if (!text) return true
  try {
    const url = new URL(text)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function validBaseURL(text?: string) {
  if (!validURL(text)) return false
  if (!text) return true
  return !/[?#]/.test(text)
}

function writable(file: string) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  accessSync(dir, constants.W_OK)
}

export function validateAppCfg(conf: AppCfg, env: NodeJS.ProcessEnv = process.env): ValidateReport {
  const errors: string[] = []
  const warnings: string[] = []

  if (!validURL(conf.codex.base_url)) {
    add(errors, "CODEX_BASE_URL 必须是 http(s) URL。")
  }

  if (!validBaseURL(conf.feishu.api_base_url)) {
    add(errors, "FEISHU_API_BASE_URL 必须是 http(s) URL，且不能包含 query/hash。")
  }

  if (!validBaseURL(conf.feishu.ws_base_url)) {
    add(errors, "FEISHU_WS_BASE_URL 必须是 http(s) URL，且不能包含 query/hash。")
  }


  if (env.CODEX_MODEL && !conf.codex.model) {
    add(errors, "CODEX_MODEL 格式应为 [<provider>/]<model_id>[@<variant>]。")
  }

  if (env.CODEX_WORKSPACE?.trim()) {
    const selected = parseWorkspaceSelection(env.CODEX_WORKSPACE)
    if (!selected.ok) {
      add(errors, "CODEX_WORKSPACE 必须是 wrk* workspace ID；本地项目请留空。")
    }
  }

  if (conf.feishu.mode === "long_conn") {
    if (!conf.feishu.app_id) add(errors, "FEISHU_MODE=long_conn 时必须配置 FEISHU_APP_ID。")
    if (!conf.feishu.app_secret) add(errors, "FEISHU_MODE=long_conn 时必须配置 FEISHU_APP_SECRET。")
    if (!conf.feishu.bot_id) add(warnings, "未配置 FEISHU_BOT_OPEN_ID，群聊首条 @bot 判断会退回到名称匹配。")
  }

  if (!conf.codex.directory && !conf.codex.workspace) {
    add(warnings, "未配置 CODEX_DIRECTORY 或 CODEX_WORKSPACE，新会话需要用户先绑定目录或 workspace。")
  }

  if (conf.codex.directory && !existsSync(conf.codex.directory)) {
    add(errors, `CODEX_DIRECTORY 不存在：${conf.codex.directory}`)
  }

  if (conf.storage.path !== ":memory:") {
    try {
      writable(conf.storage.path)
    } catch {
      add(errors, `IMUI_DB_PATH 所在目录不可写：${path.dirname(conf.storage.path)}`)
    }
  }

  if (conf.runtime) {
    try {
      writable(path.join(conf.runtime.asset_dir, ".keep"))
    } catch {
      add(errors, `附件缓存目录不可写：${conf.runtime.asset_dir}`)
    }

    try {
      writable(path.join(conf.runtime.backup_dir, ".keep"))
    } catch {
      add(errors, `备份目录不可写：${conf.runtime.backup_dir}`)
    }

    if (conf.runtime.asset_ttl_hours < 1) {
      add(errors, "IMUI_ASSET_TTL_HOURS 必须大于等于 1。")
    }
    if (conf.runtime.asset_max_mb < 16) {
      add(warnings, "IMUI_ASSET_MAX_MB 小于 16，附件缓存可能很快被清空。")
    }
    if (conf.runtime.backup_retention_days < 1) {
      add(errors, "IMUI_BACKUP_RETENTION_DAYS 必须大于等于 1。")
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
