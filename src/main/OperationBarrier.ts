export class OperationBarrier {
  private readonly operations = new Set<Promise<unknown>>();
  private maintenanceMode = false;

  acquire<T>(operationFactory: () => Promise<T>): Promise<T> {
    if (this.maintenanceMode) {
      return Promise.reject(new Error('Bug Pocket maintenance is in progress. New operations are temporarily paused.'));
    }

    let operation: Promise<T>;
    try {
      operation = operationFactory();
    } catch (error) {
      return Promise.reject(error);
    }

    this.operations.add(operation);
    const release = (): void => {
      this.operations.delete(operation);
    };
    void operation.then(release, release);
    return operation;
  }

  // Register the exclusive operation itself, but drain only operations that preceded it.
  // Shutdown can then wait for restore without restore waiting on its own promise.
  exclusive<T>(factory: () => Promise<T>): Promise<T> {
    this.enterMaintenance();
    const previous = Array.from(this.operations);
    const operation = Promise.allSettled(previous).then(factory).finally(() => this.exitMaintenance());
    this.operations.add(operation);
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
    return operation;
  }

  enterMaintenance(): void {
    if (this.maintenanceMode) throw new Error('Bug Pocket maintenance is already in progress.');
    this.maintenanceMode = true;
  }

  exitMaintenance(): void {
    this.maintenanceMode = false;
  }

  assertAcceptingOperations(): void {
    if (this.maintenanceMode) {
      throw new Error('Bug Pocket maintenance is in progress. New operations are temporarily paused.');
    }
  }

  async drain(): Promise<void> {
    while (this.operations.size > 0) {
      await Promise.allSettled(Array.from(this.operations));
    }
  }

  get activeCount(): number {
    return this.operations.size;
  }

  get isInMaintenance(): boolean {
    return this.maintenanceMode;
  }
}

export const operationBarrier = new OperationBarrier();
