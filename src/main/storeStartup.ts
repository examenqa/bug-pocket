import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { StartupStatus } from '../shared/types';
import { STORE_STARTUP_TASK_ID } from './startupPreference';

export interface StoreStartupBridge {
  read(): Promise<unknown>;
  enable(): Promise<unknown>;
  disable(): Promise<unknown>;
  activation(): Promise<unknown>;
}

export interface StoreLaunch {
  identityVerified: boolean;
  activationKnown: boolean;
  startupActivation: boolean;
}

export function loadStoreStartupBridge(resourcesPath: string): StoreStartupBridge {
  // Called only in the main process for AppX/MSIX execution. No renderer path,
  // task ID, command or environment override can reach this loader.
  const bridge = createRequire(__filename)(join(resourcesPath, 'store-startup', 'bug_pocket_store_startup.node')) as StoreStartupBridge;
  if (!bridge || !['read', 'enable', 'disable', 'activation'].every(key => typeof bridge[key as keyof StoreStartupBridge] === 'function')) {
    throw new Error('Store startup bridge is unavailable.');
  }
  return bridge;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function unavailableStoreStartup(message = 'Windows startup status is unavailable. No startup change has been confirmed.'): StartupStatus {
  return { mode: 'store', taskId: STORE_STARTUP_TASK_ID, state: 'unavailable', enabled: null, canEnable: false, canDisable: false, message };
}

export function mapStoreStartupResult(value: unknown): StartupStatus {
  const result = record(value);
  if (!result || result.taskId !== STORE_STARTUP_TASK_ID) return unavailableStoreStartup();
  if (result.identityVerified !== true) {
    return unavailableStoreStartup('The installed Bug Pocket package identity could not be verified. No startup change was made.');
  }
  const states: Record<string, { enabled: boolean; canEnable: boolean; canDisable: boolean; message: string }> = {
    disabled: { enabled: false, canEnable: true, canDisable: true, message: 'Windows startup is off. Enable it to keep Bug Pocket quietly available after sign-in.' },
    enabled: { enabled: true, canEnable: true, canDisable: true, message: 'Windows reports startup is enabled. Bug Pocket will start quietly after sign-in. Shortcut conflicts are shown in Hotkeys.' },
    disabledByUser: { enabled: false, canEnable: false, canDisable: true, message: 'You disabled Bug Pocket in Windows Startup apps. Only Windows Settings can re-enable it.' },
    disabledByPolicy: { enabled: false, canEnable: false, canDisable: false, message: 'Windows policy or this Windows platform prevents startup. Bug Pocket cannot enable it.' },
    enabledByPolicy: { enabled: true, canEnable: false, canDisable: false, message: 'Windows policy requires startup. Bug Pocket cannot disable it.' }
  };
  const state = typeof result.state === 'string' && Object.hasOwn(states, result.state) ? states[result.state] : undefined;
  if (state && result.enabled === state.enabled) {
    return { mode: 'store', taskId: STORE_STARTUP_TASK_ID, state: result.state as StartupStatus['state'], ...state };
  }
  if (result.state === 'unsupported') {
    return { ...unavailableStoreStartup('This Windows installation does not expose the required startup API.'), state: 'unsupported' };
  }
  if (result.errorCode === 'access_denied') {
    return unavailableStoreStartup('Windows denied access to startup control. No startup change has been confirmed.');
  }
  return unavailableStoreStartup();
}

export function mapStoreActivation(value: unknown): StoreLaunch {
  const result = record(value);
  const identityVerified = result?.taskId === STORE_STARTUP_TASK_ID && result.identityVerified === true;
  const known = identityVerified &&
    result?.activationKnown === true && typeof result?.startupActivation === 'boolean';
  return { identityVerified, activationKnown: known, startupActivation: known && result?.startupActivation === true };
}

export function isStartupSecondInstance(value: unknown): boolean {
  const data = record(value);
  return data?.bugPocketStartup === 1 && data.taskId === STORE_STARTUP_TASK_ID && data.identityVerified === true && data.startupActivation === true;
}

export function shouldShowLaunchWindow(storeExecution: boolean, launch: StoreLaunch, ordinaryBackgroundArgument: boolean): boolean {
  // Store startup is classified by Windows activation, never by a command-line
  // guess. Unknown activation retains normal manual-launch presentation.
  return storeExecution ? !(launch.activationKnown && launch.startupActivation) : !ordinaryBackgroundArgument;
}

export function createStoreStartupController(load: () => StoreStartupBridge) {
  let bridge: StoreStartupBridge | undefined;
  let accepting = true;
  let tail: Promise<unknown> = Promise.resolve();
  let status = unavailableStoreStartup('Reading Windows startup status...');
  const getBridge = (): StoreStartupBridge => bridge ??= load();
  const queue = <T>(action: () => Promise<T>): Promise<T> => {
    if (!accepting) return Promise.reject(new Error('Bug Pocket is shutting down.'));
    const operation = tail.then(action);
    tail = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const update = (action: 'read' | 'enable' | 'disable'): Promise<StartupStatus> => queue(async () => {
    try { status = mapStoreStartupResult(await getBridge()[action]()); }
    catch { status = unavailableStoreStartup(); }
    return status;
  });
  return {
    snapshot: (): StartupStatus => status,
    read: (): Promise<StartupStatus> => update('read'),
    set: (enabled: boolean): Promise<StartupStatus> => update(enabled ? 'enable' : 'disable'),
    activation: (): Promise<StoreLaunch> => queue(async () => {
      try { return mapStoreActivation(await getBridge().activation()); }
      catch { return { identityVerified: false, activationKnown: false, startupActivation: false }; }
    }),
    close: async (): Promise<void> => { accepting = false; await tail; },
    resume: (): void => { accepting = true; }
  };
}
