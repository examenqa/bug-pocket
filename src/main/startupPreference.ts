import type { StartupStatus } from '../shared/types';

export const STORE_APP_USER_MODEL_ID = 'ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket';
export const STORE_STARTUP_TASK_ID = 'BugPocketStartup';

interface RuntimeIdentity {
  platform: string;
  windowsStore?: boolean;
}

interface LoginItemApi {
  getLoginItemSettings(options: { args: string[] }): {
    openAtLogin: boolean;
    launchItems?: { name: string; args: string[]; scope: string; enabled: boolean }[];
  };
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
}

export function isStoreExecution(identity: RuntimeIdentity): boolean {
  return identity.platform === 'win32' && identity.windowsStore === true;
}

export function getAppUserModelId(identity: RuntimeIdentity): string {
  return isStoreExecution(identity) ? STORE_APP_USER_MODEL_ID : 'com.bugpocket.app';
}

export function readStartupStatus(identity: RuntimeIdentity, loginItems: LoginItemApi, backgroundArg: string): StartupStatus {
  if (isStoreExecution(identity)) {
    // Electron 45.2.1's login-item APIs only address registry entries. The
    // separate package-bound Store controller owns WinRT StartupTask access.
    // Do not substitute a registry value name or infer the Windows task state.
    return {
      mode: 'store',
      taskId: STORE_STARTUP_TASK_ID,
      state: 'unsupported',
      enabled: null,
      message: 'Store startup must be read through the package-bound startup controller.'
    };
  }

  try {
    const settings = loginItems.getLoginItemSettings({ args: [backgroundArg] });
    // executableWillLaunchAtLogin aggregates other entries/arguments. Only
    // our current-user AUMID entry can establish approval of this preference.
    const ownItem = settings.launchItems?.find(item =>
      item.scope === 'user' && item.name === getAppUserModelId(identity)
    );
    if (identity.platform === 'win32' && settings.openAtLogin &&
        (!ownItem || ownItem.args.length !== 1 || ownItem.args[0] !== backgroundArg)) {
      return {
        mode: 'ordinary', state: 'unavailable', enabled: null,
        message: 'Windows startup approval could not be verified. No startup change has been confirmed.'
      };
    }
    const enabled = settings.openAtLogin && (identity.platform !== 'win32' || ownItem?.enabled === true);
    // The same registry value can have different arguments. Its disabled
    // approval still belongs to the user and must not be reset by restoration.
    const blocked = identity.platform === 'win32' && ownItem?.enabled === false;
    return {
      mode: 'ordinary',
      state: enabled ? 'enabled' : blocked ? 'blocked' : 'disabled',
      enabled,
      message: enabled
        ? 'Windows reports Bug Pocket is enabled to start in the background.'
        : blocked
          ? 'Windows has disabled startup for Bug Pocket. Review Startup apps in Windows Settings to enable it.'
          : 'Bug Pocket is not registered to start in the background.'
    };
  } catch {
    return {
      mode: 'ordinary', state: 'unavailable', enabled: null,
      message: 'Startup status could not be read. No startup change has been confirmed.'
    };
  }
}

export function requestStartupPreference(identity: RuntimeIdentity, loginItems: LoginItemApi, backgroundArg: string, enabled: boolean): StartupStatus {
  const before = readStartupStatus(identity, loginItems, backgroundArg);
  if (before.mode === 'store' || before.state === 'unavailable') return before;
  // Do not clear Windows' disabled approval state, including on explicit retry.
  if (enabled && before.state === 'blocked') return before;
  try {
    loginItems.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? [backgroundArg] : [] });
  } catch {
    return {
      mode: 'ordinary', state: 'unavailable', enabled: null,
      message: 'The startup change could not be confirmed. Check Windows Settings and try again.'
    };
  }
  // Issuing the setter is not success: expose the OS read-back result.
  const after = readStartupStatus(identity, loginItems, backgroundArg);
  return after.enabled !== null && after.enabled !== enabled
    ? { ...after, message: `Windows did not confirm ${enabled ? 'enabling' : 'disabling'} startup. ${after.message}` }
    : after;
}

export function restoreStartupPreference(identity: RuntimeIdentity, loginItems: LoginItemApi, backgroundArg: string, enabled: boolean): void {
  const current = readStartupStatus(identity, loginItems, backgroundArg);
  if (current.mode === 'store' || current.state === 'unavailable') return;
  if (current.enabled !== enabled || (!enabled && current.state === 'blocked')) {
    requestStartupPreference(identity, loginItems, backgroundArg, enabled);
  }
}
