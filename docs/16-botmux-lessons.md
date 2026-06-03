# Botmux 设计借鉴与落地路线

本文记录对 `/Users/bytedance/workspace/botmux` 的只读调研结论，并约定本项目后续吸收这些设计的边界。原则是：**本仓库以 Codex app-server 原生接入为主，不照搬 botmux 的 transcript bridge/worker 架构；只吸收能降低卡住、串台、状态错写风险的设计方法。**

## 适用边界

- 本项目仍以 `src/contracts.ts` 中的内部模型为主：`Inbound`、`ImSession`、`Task`、`AssistantOutbound`、`QueueJob`。
- botmux 是参考实现，不作为运行时依赖。
- 优先落地低风险、可单测、能独立验证的改动。
- 涉及 `.env`、飞书真实身份、真实邮箱/密钥的内容不得进入代码和测试。

## 值得学习的模式

### 1. 纯状态机优先

botmux 的 `BridgeTurnQueue` 将 turn 归属、pending、seen-set、过期清理等逻辑抽成无 I/O 状态机。外层 worker 负责文件、IPC、timer，核心判断则可用单测驱动。

本项目中类似复杂逻辑主要集中在：

- `src/codex/client.ts`：`turnByThread`、`staleTurnByThread`、`expectedTurnId` 相关状态。
- `src/app/boot.ts`：等待审批/问题队列、卡片 patch/reply、intermediate/final 可见槽位、恢复路径。

落地建议：

- 将 turn 生命周期抽到 `src/codex/turn-state.ts`。
- 将卡片发送/patch/reply 决策抽到 `src/app/publish-policy.ts`。
- 将 waiting permission/question 的队首选择和可见性决策抽到 `src/app/wait-policy.ts`。

每个模块只返回“应该做什么”，不直接调用 Feishu/Codex/SQLite。

### 2. 恢复优先的 bounded shutdown

botmux 的队列和 bridge 设计倾向于：进程停止或重启时，不让未完成任务永久卡在 running，而是可恢复、可重放、可去重。

本项目已落地第一步：`src/queue/bus.ts` 中 `queue.stop()` 增加有限等待。若 handler 卡死，停止不会无限挂起；当前 running job 会回到 queued，后续重启可继续处理。同时使用 abandoned 集合避免超时后的旧 handler 再把任务错误写成 done/failed。

### 3. 远端副作用与本地状态的事务补偿

botmux 的 `pending-response-transaction-store` 用 marker 处理“飞书 PATCH 已成功，但本地 session 保存前崩溃”的裂缝。

本项目也存在类似窗口：`publish()` 中 `feishu.patch()` 成功后，才保存 assistant outbound、visible slot 和 note。如果进程在中间崩溃，远端消息和本地 DB 可能不一致。

后续建议：

- 新增 SQLite outbox/transaction 表，记录 send/reply/patch 的 `preparing -> remote_done -> local_done`。
- 启动 recover/sweep 时扫描未完成事务。
- 对 patch 成功但本地状态未保存的情况，优先补本地状态；对 send/reply 成功但未保存 message id 的情况，保守记录异常并避免重复发送。

### 4. app-server 请求必须有边界

botmux 的 Codex app-server probe 对 initialize/thread-list 使用 timeout，避免探测类请求长期挂起。

本项目已落地第一步：`src/codex/rpc.ts` 的 JSON-RPC `request()` 增加默认超时。这样 `/sessions`、`/skills`、`/models`、`status`、`result` 等 app-server 请求不会永久阻塞主流程。

注意：botmux 的 metadata probe 可以 suppress notifications；本项目主连接依赖 `thread/status/changed`、`turn/started`、`turn/completed` 推进飞书卡片状态，因此主 RPC 初始化不能简单抑制这些通知。若未来新增只读 metadata probe，可单独创建 suppressNotifications 版本。

### 5. 策略函数单测化

botmux 的 `send-policy.ts`、`bridge-fallback-gate.ts` 都是纯函数策略模块，便于覆盖边界条件。

本项目后续应将以下判断从 `boot.ts` 拆出并单测：

- dedup：相同 payload 是否跳过。
- first intermediate：是否需要保留原 processing 卡片作为 status slot。
- final after intermediate：是否新发最终答复并 patch 原卡片。
- patch 失败 fallback：何时 reply 新消息，何时更新 visible slot。
- waiting request：多个审批/问题排队时，哪个可见、哪个后台保存。

## 落地优先级

### P0：已落地

- `queue.stop()` 有界等待并恢复 running job。
- app-server JSON-RPC request 默认超时。

### P1：已落地

1. `publish-policy.ts`
   - 已从 `publish()` 中抽出纯策略，覆盖 dedup、patch/reply/send、first intermediate、final-after-intermediate 等决策。
   - 已补 `test/publish-policy.test.ts`，并保留现有 `boot.test.ts`、`message-flow.test.ts` 的端到端行为覆盖。

2. `codex/turn-state.ts`
   - 已收敛 `turnByThread`、`staleTurnByThread` 到 `CodexTurnState` 小状态机。
   - 已覆盖 active turn、completed stale turn、abort 后 stale expectedTurnId 等边界。

3. Feishu outbound transaction/outbox
   - 已新增 `outbound_txn` 表和 `preparing -> remote_done -> local_done(drop)` 补偿路径。
   - 已覆盖 patch/reply/send 远端成功但本地 bookkeeping 未完成时的启动恢复，避免重复发送或状态丢失。

4. `wait-policy.ts`
   - 已将 waiting permission/question 的 req type、task status、队首可见动作、promote 动作抽成纯函数。
   - 已补 `test/wait-policy.test.ts`，现有 waiting approval/question 流程测试继续通过。

### P2：有需要再做

- IM adapter 抽象：当前项目只接飞书，短期不必为了多平台提前重构。
- append-only JSONL 队列：当前 SQLite 队列足够，学习 replay/offset 思路即可。
- file lock/logger/i18n：仅在多进程文件写、CLI JSON 输出或多语言产品化时引入。

## 验收标准

每次吸收 botmux 设计时，都需要满足：

- 有明确的本项目问题或风险对应，不做纯风格迁移。
- 核心判断优先是纯函数或小状态机。
- 至少有专项测试覆盖新增边界。
- 不引入真实飞书身份、邮箱、密钥、绝对机器路径到测试快照或文档示例。
