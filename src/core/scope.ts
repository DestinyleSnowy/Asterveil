export type Cleanup = () => void;

export class Scope {
  private readonly controller = new AbortController();
  private readonly cleanups: Cleanup[] = [];

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  defer(cleanup: Cleanup): void {
    if (this.signal.aborted) this.runCleanup(cleanup);
    else this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of this.cleanups.splice(0).reverse()) this.runCleanup(cleanup);
  }

  private runCleanup(cleanup: Cleanup): void {
    try {
      cleanup();
    } catch (error) {
      console.error('[Asterveil] Resource cleanup failed', error);
    }
  }
}
