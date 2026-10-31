// Safe configuration knowledge only: this says nothing about provider, daemon or model health.
export type AiReadiness = { status: 'unknown' } | {
  status: 'known';
  hasByokKey: boolean;
  nativeEnabled: boolean;
};

export function aiConfigurationReady(configuration: AiReadiness): boolean {
  return configuration.status === 'known' && (configuration.hasByokKey || configuration.nativeEnabled);
}

export function readAiReadiness(config: unknown, settings: unknown): AiReadiness {
  if (!config || !settings || typeof config !== 'object' || typeof settings !== 'object'
    || !('hasApiKey' in config) || typeof config.hasApiKey !== 'boolean'
    || !('aiTriageEnabled' in settings) || typeof settings.aiTriageEnabled !== 'boolean') {
    return { status: 'unknown' };
  }
  return { status: 'known', hasByokKey: config.hasApiKey, nativeEnabled: settings.aiTriageEnabled };
}

// Each read invalidates older reads immediately, including a preflight overlapped by
// a settings notification. Disposing prevents both late publication and dispatch.
export class AiReadinessMonitor {
  private generation = 0;
  private disposed = false;
  private current: AiReadiness = { status: 'unknown' };

  constructor(
    private readConfig: () => Promise<unknown>,
    private readSettings: () => Promise<unknown>,
    private publish: (configuration: AiReadiness) => void
  ) {}

  async refresh(): Promise<AiReadiness> {
    if (this.disposed) return { status: 'unknown' };
    const generation = ++this.generation;
    this.current = { status: 'unknown' };
    this.publish(this.current);
    let next: AiReadiness;
    try {
      const [config, settings] = await Promise.all([this.readConfig(), this.readSettings()]);
      next = readAiReadiness(config, settings);
    } catch {
      next = { status: 'unknown' };
    }
    if (this.disposed || generation !== this.generation) return { status: 'unknown' };
    this.current = next;
    this.publish(next);
    return next;
  }

  isCurrent(configuration: AiReadiness): boolean {
    return !this.disposed && configuration === this.current && configuration.status === 'known';
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.current = { status: 'unknown' };
  }
}
