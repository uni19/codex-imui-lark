/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import { diagnoseFeishuWsLog } from "../src/feishu/conn.ts"

test("diagnoses unknown long-connection endpoint error codes with endpoint guidance", () => {
  const item = diagnoseFeishuWsLog(["[ws]", "code: 1000040351, system busy"], {
    ws_base_url: "https://open.larksuite.com",
  })

  expect(item.endpoint_error).toBe(true)
  expect(item.err).toContain("https://open.larksuite.com/callback/ws/endpoint 返回 1000040351")
  expect(item.err).toContain("FEISHU_API_BASE_URL/FEISHU_WS_BASE_URL 与应用所属区域一致")
})

test("diagnoses long-connection limit separately", () => {
  const item = diagnoseFeishuWsLog(["[ws]", "code: 1000040350, system busy"], {
    ws_base_url: "https://open.feishu.cn/",
  })

  expect(item.endpoint_error).toBe(true)
  expect(item.err).toContain("https://open.feishu.cn/callback/ws/endpoint 返回 1000040350")
  expect(item.err).toContain("长连接数超过限制")
})

test("suppresses SDK secondary PingInterval and connect failed noise after endpoint errors", () => {
  expect(
    diagnoseFeishuWsLog(["[ws]", "undefined is not an object (evaluating 'ClientConfig.PingInterval')"], {
      recent_endpoint_error: true,
    }).suppress,
  ).toBe(true)
  expect(diagnoseFeishuWsLog(["[ws]", "connect failed"], { recent_endpoint_error: true }).suppress).toBe(true)
})
