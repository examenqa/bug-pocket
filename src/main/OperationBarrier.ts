export class OperationBarrier {
  private readonly operations = new Set<Promise<unknown>>();

  acquire<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    const release = (): void => {
      this.operations.delete(operation);
    };
    void operation.then(release, release);
    return operation;
  }

  async drain(): Promise<void> {
    while (this.operations.size > 0) {
      await Promise.allSettled(Array.from(this.operations));
    }
  }

  get activeCount(): number {
    return this.operations.size;
  }
}

export const operationBarrier = new OperationBarrier();
