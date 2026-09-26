// Correlated acknowledgements cannot complete a newer request or turn failure into success.
export class DetailsFlushGate {
  private sequence = 0;
  private pending: { id: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  get active(): boolean { return this.pending !== null; }
  request(send: (id: string) => void, timeoutMs = 30_000): Promise<void> {
    if (this.pending) return Promise.reject(new Error('A draft transition is already in progress.'));
    return new Promise<void>((resolve, reject) => {
      const id = String(++this.sequence);
      const timer = setTimeout(() => this.complete(id, false), timeoutMs);
      this.pending = { id, resolve, reject, timer };
      try { send(id); } catch { this.complete(id, false); }
    });
  }
  complete(id: string, success: boolean): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (success) pending.resolve();
    else pending.reject(new Error('Report changes could not be saved. The draft remains open; retry saving before leaving.'));
  }
}
