function text(input: unknown) {
  return typeof input === "string" && input ? input : undefined
}

export class CodexTurnState {
  private activeByThread = new Map<string, string>()
  private staleByThread = new Map<string, string>()

  remember(threadId: unknown, turnId: unknown) {
    const thread = text(threadId)
    const turn = text(turnId)
    if (thread && turn) this.activeByThread.set(thread, turn)
  }

  active(threadId: unknown) {
    const thread = text(threadId)
    if (!thread) return undefined
    return this.activeByThread.get(thread)
  }

  forget(threadId: unknown, turnId?: unknown) {
    const thread = text(threadId)
    if (!thread) return
    const turn = text(turnId)
    if (!turn || this.activeByThread.get(thread) === turn) this.activeByThread.delete(thread)
  }

  markStale(threadId: unknown, turnId: unknown) {
    const thread = text(threadId)
    const turn = text(turnId)
    if (thread && turn) this.staleByThread.set(thread, turn)
  }

  consumeStale(threadId: unknown) {
    const thread = text(threadId)
    if (!thread) return undefined
    const turn = this.staleByThread.get(thread)
    this.staleByThread.delete(thread)
    return turn
  }

  complete(threadId: unknown, turnId: unknown) {
    this.forget(threadId, turnId)
    this.markStale(threadId, turnId)
  }

  abort(threadId: unknown) {
    const turn = this.active(threadId)
    if (!turn) return undefined
    this.forget(threadId, turn)
    this.markStale(threadId, turn)
    return turn
  }

  clear() {
    this.activeByThread.clear()
    this.staleByThread.clear()
  }
}
