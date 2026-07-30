export interface GracefulShutdownTasks {
  pauseRenderer(): void;
  drainOperations(): Promise<void>;
  stopAndDrain(): Promise<void>;
  disconnectWorkspace(): void | Promise<void>;
}

export async function runGracefulShutdown(tasks: GracefulShutdownTasks): Promise<void> {
  tasks.pauseRenderer();
  await tasks.drainOperations();
  await tasks.stopAndDrain();
  await tasks.disconnectWorkspace();
}
