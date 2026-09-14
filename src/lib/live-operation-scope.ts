export type LiveOperation = { sessionId: string; signal: AbortSignal };

/** Check again under the database lock before accepting delayed audio writes. */
export function acceptsLiveTranscript(
  current: { sessionId: string | null; status: string } | null | undefined,
  sessionId: string
): boolean {
  return Boolean(sessionId && current?.sessionId === sessionId && current.status === "active");
}

/** Invalidates delayed audio and model responses when their live session ends. */
export class LiveOperationScope {
  private operation: LiveOperation | null = null;
  private controller: AbortController | null = null;

  setSession(sessionId: string | null): boolean {
    if ((this.operation?.sessionId ?? null) === sessionId) return false;
    this.controller?.abort();
    this.controller = sessionId ? new AbortController() : null;
    this.operation = sessionId && this.controller ? { sessionId, signal: this.controller.signal } : null;
    return true;
  }

  capture(): LiveOperation | null { return this.operation; }

  isCurrent(operation: LiveOperation | null): operation is LiveOperation {
    return operation !== null && operation === this.operation && !operation.signal.aborted;
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.operation = null;
  }
}
