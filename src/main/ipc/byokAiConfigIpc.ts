import type { IpcMain } from 'electron';
import type { AiByokConfig } from '../../shared/types';

export const getByokAiConfigChannel = 'get-ai-config';

export function registerGetByokAiConfigIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getConfig: () => AiByokConfig
): void {
  ipc.handle(getByokAiConfigChannel, () => getConfig());
}
