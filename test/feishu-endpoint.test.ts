/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { createFeishuApi } from "../src/feishu/api.ts"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("feishu endpoints", () => {
  test("uses configured OpenAPI base for auth and message APIs", async () => {
    const urls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      urls.push(url)
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return json({ code: 0, tenant_access_token: "tenant_token", expire: 7200 })
      }
      return json({ code: 0, data: { message_id: "om_custom" } })
    }) as typeof fetch

    const api = createFeishuApi({
      app_id: "cli_demo",
      app_secret: "sec_demo",
      api_base_url: "https://open.larksuite.com/open-apis/",
    })

    await expect(api.send({
      chat_id: "oc_demo",
      out: {
        kind: "text",
        body: {
          text: "hello",
        },
      },
    })).resolves.toEqual({ id: "om_custom" })

    expect(urls).toEqual([
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id",
    ])
  })

  test("uses configured OpenAPI base for asset download", async () => {
    const urls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      urls.push(url)
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return json({ code: 0, tenant_access_token: "tenant_token", expire: 7200 })
      }
      return new Response("file-body", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "content-disposition": "attachment; filename=demo.txt",
        },
      })
    }) as typeof fetch

    const cache = path.join(tmpdir(), `codex-feishu-endpoint-${Date.now()}`)
    await mkdir(cache, { recursive: true })
    try {
      const api = createFeishuApi({
        app_id: "cli_demo",
        app_secret: "sec_demo",
        api_base_url: "https://open.larksuite.com/open-apis/",
        cache,
      })

      const asset = await api.fetch({
        message_id: "om_demo",
        asset: {
          kind: "file",
          key: "file_key",
          name: "demo.txt",
        },
      })

      expect(asset.url).toStartWith("file://")
      expect(urls).toEqual([
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        "https://open.larksuite.com/open-apis/im/v1/messages/om_demo/resources/file_key?type=file",
      ])
    } finally {
      await rm(cache, { recursive: true, force: true })
    }
  })
})
