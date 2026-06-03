// Utility functions shared across settings components.

export function hasSettingsMutationBridge(): boolean {
  const api = window.bugPocket as typeof window.bugPocket & Record<string, unknown>;
  return (
    typeof api.updateApplication === 'function' &&
    typeof api.updateApplicationContext === 'function' &&
    typeof api.updateApplicationSync === 'function' &&
    typeof api.deleteApplication === 'function' &&
    typeof api.updateModule === 'function' &&
    typeof api.updateModuleContext === 'function' &&
    typeof api.deleteModule === 'function' &&
    typeof api.updateEnvironment === 'function' &&
    typeof api.deleteEnvironment === 'function' &&
    typeof api.mergeReference === 'function' &&
    typeof api.updateDevice === 'function' &&
    typeof api.deleteDevice === 'function' &&
    typeof api.updateBrowser === 'function' &&
    typeof api.deleteBrowser === 'function' &&
    typeof api.updateUserRole === 'function' &&
    typeof api.deleteUserRole === 'function' &&
    typeof api.updateConfigOption === 'function' &&
    typeof api.deleteConfigOption === 'function' &&
    typeof api.createPreset === 'function' &&
    typeof api.updatePreset === 'function' &&
    typeof api.deletePreset === 'function' &&
    typeof api.updateSupabaseSettings === 'function' &&
    typeof api.testSupabaseConnection === 'function' &&
    typeof api.authSignIn === 'function' &&
    typeof api.authSignUp === 'function' &&
    typeof api.authSignOut === 'function' &&
    typeof api.getSyncSessionStatus === 'function'
  );
}

const VISIBLE_PILL_LIMIT = 6;

export function getSettingsPreviewItems<T>(items: T[]): T[] {
  return items.slice(0, VISIBLE_PILL_LIMIT);
}

