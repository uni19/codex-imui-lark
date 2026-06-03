/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test"
import { cfg } from "../src/app/cfg.ts"

const env0 = { ...process.env }

afterEach(() => {
  const keys = new Set([...Object.keys(process.env), ...Object.keys(env0)])
  for (const key of keys) {
    const val = env0[key]
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
})

test("cfg normalizes blank codex workspace env to undefined", () => {
  process.env.CODEX_WORKSPACE = "   "
  expect(cfg().codex.workspace).toBeUndefined()
})

test("cfg preserves non-empty codex workspace env", () => {
  process.env.CODEX_WORKSPACE = "wrk_demo"
  expect(cfg().codex.workspace).toBe("wrk_demo")
})

test("cfg normalizes invalid codex workspace env to undefined", () => {
  process.env.CODEX_WORKSPACE = " ws_bad "
  expect(cfg().codex.workspace).toBeUndefined()
})

test("cfg exposes configurable Feishu endpoints with default OpenAPI base", () => {
  expect(cfg().feishu.api_base_url).toBe("https://open.feishu.cn/open-apis")
  expect(cfg().feishu.ws_base_url).toBe("https://open.feishu.cn")

  process.env.FEISHU_API_BASE_URL = "https://open.larksuite.com/open-apis"

  expect(cfg().feishu).toMatchObject({
    api_base_url: "https://open.larksuite.com/open-apis",
    ws_base_url: "https://open.larksuite.com",
  })

  process.env.FEISHU_WS_BASE_URL = "https://custom-feishu.example.com"
  expect(cfg().feishu.ws_base_url).toBe("https://custom-feishu.example.com")
})
