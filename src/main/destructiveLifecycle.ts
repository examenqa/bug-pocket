import type { OperationBarrier } from './OperationBarrier';

export interface DestructiveMaintenanceOptions<T> {
  barrier: OperationBarrier;
  stopAndDrain(): Promise<void>;
  operation(): Promise<T>;
  resumeAfterFailure?(): Promise<void>;
}

export async function runDestructiveMaintenance<T>(options: DestructiveMaintenanceOptions<T>): Promise<T> {
  options.barrier.enterMaintenance();
  let maintenanceActive = true;
  try {
    await options.barrier.drain();
    await options.stopAndDrain();
    return await options.operation();
  } catch (error) {
    options.barrier.exitMaintenance();
    maintenanceActive = false;
    try {
      await options.resumeAfterFailure?.();
    } catch (resumeError) {
      console.error('[maintenance] Failed to restore background services.', resumeError);
    }
    throw error;
  } finally {
    if (maintenanceActive) options.barrier.exitMaintenance();
  }
}
