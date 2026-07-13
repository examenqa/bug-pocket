import type { IpcMain } from 'electron';

export const deleteBugChannel = 'bugs:delete';

export interface BugDeletionActions {
  authorizeMutation(): void;
  deleteBug(id: number): void;
  emitBugsChanged(): void;
  emitDeletedToast(): void;
}

export function registerBugDeletionIpc(
  ipc: Pick<IpcMain, 'handle'>,
  actions: BugDeletionActions
): void {
  ipc.handle(deleteBugChannel, (_event, id: number) => {
    actions.authorizeMutation();
    actions.deleteBug(id);
    actions.emitBugsChanged();
    actions.emitDeletedToast();
  });
}
