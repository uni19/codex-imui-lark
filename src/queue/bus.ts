import type { Job, Queue, Store } from "../contracts.js"

type Handler = (job: Job) => Promise<void>
type Fail = (job: Job, err: unknown) => Promise<void>
type QueueOptions = {
  stop_timeout_ms?: number
}

const DEFAULT_STOP_TIMEOUT_MS = 5_000

const now = () => Date.now()

export function createQueue(store: Store, handler: Handler, fail?: Fail, opts: QueueOptions = {}): Queue {
  const wait: Array<() => void> = []
  const stop_timeout_ms = opts.stop_timeout_ms ?? DEFAULT_STOP_TIMEOUT_MS
  const abandoned = new Set<string>()
  let live = false
  let task: Promise<void> | undefined
  let current: Job | undefined

  const next = () => {
    const fn = wait.shift()
    if (fn) fn()
  }

  const pull = async () => {
    while (live) {
      const job = await store.claim_job()
      if (job) return job
      await new Promise<void>((resolve) => wait.push(resolve))
    }
  }

  const loop = async () => {
    while (live) {
      const job = await pull()
      if (!job) continue
      current = job
      await handler(job)
        .then(async () => {
          if (abandoned.has(job.id)) return
          await store.done_job(job.id)
        })
        .catch(async (err) => {
          if (abandoned.has(job.id)) return
          await store.fail_job({
            id: job.id,
            err: err instanceof Error ? err.message : String(err),
          })
          console.error("[queue]", err)
          await fail?.(job, err).catch((item) => {
            console.error("[queue.fail]", item)
          })
        })
        .finally(() => {
          abandoned.delete(job.id)
          if (current?.id === job.id) current = undefined
        })
    }
  }

  const waitForStop = async () => {
    if (!task) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const done = Symbol("queue.done")
    const timed = Symbol("queue.timeout")
    const result = await Promise.race([
      task.then(() => done),
      new Promise<typeof timed>((resolve) => {
        timeout = setTimeout(() => resolve(timed), stop_timeout_ms)
      }),
    ])
    if (timeout) clearTimeout(timeout)
    if (result === done) return
    const job = current
    if (job) {
      abandoned.add(job.id)
      console.warn(`[queue.stop] timed out; requeue running job ${job.id}`)
      await store.reset_jobs({
        from: ["running"],
        to: "queued",
      })
      if (current?.id === job.id) current = undefined
    }
  }

  return {
    async push(input) {
      const row = await store.get_job(input.id)
      if (row && row.status !== "failed") {
        next()
        return
      }
      await store.save_job({
        id: input.id,
        status: "queued",
        err: undefined,
        created_at: row?.created_at ?? now(),
        updated_at: now(),
      })
      next()
    },

    async start() {
      if (live) return
      await store.reset_jobs({
        from: ["running"],
        to: "queued",
      })
      live = true
      task = loop()
      next()
    },

    async stop() {
      if (!live) return
      live = false
      next()
      await waitForStop()
    },
  }
}
