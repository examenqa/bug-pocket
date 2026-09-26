import { AiCancelledError, AiTimeoutError, withAiDeadline, type AiRequestResult } from '../../shared/aiRequest';

export class AiRequestRegistry {
  private current = new Map<number, { id: string; controller: AbortController }>();
  cancel(owner: number, id?: string): void {
    const request = this.current.get(owner);
    if (request && (!id || request.id === id)) {
      this.current.delete(owner);
      request.controller.abort(new AiCancelledError());
    }
  }
  cancelAll(): void { for (const owner of this.current.keys()) this.cancel(owner); }
  async run<T>(owner: number, id: string, work: (signal: AbortSignal) => Promise<T>): Promise<AiRequestResult<T>> {
    this.cancel(owner);
    const request = { id, controller: new AbortController() };
    this.current.set(owner, request);
    try {
      const value = await withAiDeadline(work, request.controller.signal);
      if (this.current.get(owner) !== request) return { status: 'cancelled', message: 'AI request cancelled.' };
      return { status: 'completed', value };
    } catch (error) {
      if (error instanceof AiCancelledError) return { status: 'cancelled', message: error.message };
      if (error instanceof AiTimeoutError) return { status: 'timed_out', message: error.message };
      return { status: 'failed', message: error instanceof Error ? error.message : 'AI request failed.' };
    } finally {
      if (this.current.get(owner) === request) this.current.delete(owner);
    }
  }
}
