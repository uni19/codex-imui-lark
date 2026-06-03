import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AppCfg } from "../src/contracts.ts"
import { validateAppCfg } from "../src/app/validate.ts"

function conf(root: string): AppCfg {
  return {
    log: {
      level: "info",
    },
    storage: {
      path: path.join(root, "db", "imui.db"),
    },
    runtime: {
      config_dir: path.join(root, "config"),
      data_dir: path.join(root, "data"),
      asset_dir: path.join(root, "data", "asset"),
      asset_ttl_hours: 168,
      asset_max_mb: 1024,
      backup_dir: path.join(root, "data", "backup"),
      backup_retention_days: 14,
    },
    feishu: {
      mode: "long_conn",
      app_id: "cli_xxx",
      app_secret: "sec_xxx",
    },
    codex: {
      base_url: "http://127.0.0.1:4096",
      username: "codex",
      password: "dev",
      directory: path.join(root, "repo"),
    },
  }
}

describe("validate app cfg", () => {
  test("passes for a valid long connection config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-feishu-validate-"))

    try {
      await mkdir(path.join(root, "repo"), { recursive: true })

      const out = validateAppCfg(conf(root), {})

      expect(out.ok).toBe(true)
      expect(out.errors).toEqual([])
      expect(out.warnings).toContain("未配置 FEISHU_BOT_OPEN_ID，群聊首条 @bot 判断会退回到名称匹配。")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("fails on malformed runtime and missing required fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-feishu-validate-"))

    try {
      const bad = conf(root)
      bad.codex.base_url = "notaurl"
      bad.feishu.api_base_url = "notaurl"
      bad.feishu.ws_base_url = "https://example.com/path?bad=1"
      bad.codex.password = undefined
      bad.codex.directory = path.join(root, "missing")
      bad.feishu.app_id = undefined
      bad.runtime!.asset_ttl_hours = 0
      bad.runtime!.backup_retention_days = 0

      const out = validateAppCfg(bad, {
        CODEX_MODEL: "bad-model",
      })

      expect(out.ok).toBe(false)
      expect(out.errors).toContain("CODEX_BASE_URL 必须是 http(s) URL。")
      expect(out.errors).toContain("FEISHU_API_BASE_URL 必须是 http(s) URL，且不能包含 query/hash。")
      expect(out.errors).toContain("FEISHU_WS_BASE_URL 必须是 http(s) URL，且不能包含 query/hash。")
      expect(out.errors).toContain("FEISHU_MODE=long_conn 时必须配置 FEISHU_APP_ID。")
      expect(out.errors).toContain(`CODEX_DIRECTORY 不存在：${path.join(root, "missing")}`)
      expect(out.errors).toContain("IMUI_ASSET_TTL_HOURS 必须大于等于 1。")
      expect(out.errors).toContain("IMUI_BACKUP_RETENTION_DAYS 必须大于等于 1。")
      expect(out.errors).toContain("CODEX_MODEL 格式应为 [<provider>/]<model_id>[@<variant>]。")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("fails on invalid CODEX_WORKSPACE env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-feishu-validate-"))

    try {
      await mkdir(path.join(root, "repo"), { recursive: true })

      const out = validateAppCfg(conf(root), {
        CODEX_WORKSPACE: "ws_bad",
      })

      expect(out.ok).toBe(false)
      expect(out.errors).toContain("CODEX_WORKSPACE 必须是 wrk* workspace ID；本地项目请留空。")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
