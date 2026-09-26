import { contextBridge, ipcRenderer } from 'electron';
import type { AiByokConfig, AiConfigSaveInput, AiIssueProcessPayload, AiProvider, BugFilters, BugStatusCounts, BugUpdateInput, CapturePresetInput, FeedbackPayload, QuickBugInput, ReferenceTable, ShortcutAction, SyncAccountSetup, SyncRuntimeStatus, TaxonomyId, TeamInvitePayload } from '../shared/types';

let captureContext: import('../shared/types').CaptureContext | null = null;
const api = {
  getCaptureContext: async (): Promise<import('../shared/types').CaptureContext | null> => {
    captureContext = await ipcRenderer.invoke('capture:context');
    return captureContext;
  },
  openQuickCapture: () => ipcRenderer.invoke('window:openQuickCapture'),
  getPendingCaptures: (): Promise<import('../shared/types').ScreenshotResult[]> => ipcRenderer.invoke('capture:listPending', captureContext),
  discardPendingCaptures: (): Promise<void> => ipcRenderer.invoke('capture:discardPending', captureContext),
  hideQuickCapture: () => ipcRenderer.invoke('window:hideQuickCapture', captureContext),
  openMainWindow: (route?: string) => ipcRenderer.invoke('window:openMain', route),
  openSettings: (section?: string) => ipcRenderer.invoke('window:openSettings', section),
  expandQuickCaptureForReview: () => ipcRenderer.invoke('window:expandQuickCaptureForReview'),
  restoreQuickCaptureCompact: () => ipcRenderer.invoke('window:restoreQuickCaptureCompact'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  addApplication: (name: string, contextDescription?: string | null, issuePrefix = '') => ipcRenderer.invoke('settings:addApplication', name, contextDescription ?? '', issuePrefix),
  updateApplication: (id: TaxonomyId, name: string, contextDescription = '', issuePrefix = '') => ipcRenderer.invoke('settings:updateApplication', id, name, contextDescription, issuePrefix),
  updateApplicationContext: (id: TaxonomyId, contextDescription: string) => ipcRenderer.invoke('settings:updateApplicationContext', id, contextDescription),
  updateApplicationSync: (id: TaxonomyId, isSynced: boolean) => ipcRenderer.invoke('settings:updateApplicationSync', id, isSynced),
  deleteApplication: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteApplication', id),
  addModule: (name: string, applicationId: TaxonomyId | null, contextDescription = '') => ipcRenderer.invoke('settings:addModule', name, applicationId, contextDescription),
  updateModule: (id: TaxonomyId, name: string, applicationId: TaxonomyId | null, contextDescription = '') => ipcRenderer.invoke('settings:updateModule', id, name, applicationId, contextDescription),
  updateModuleContext: (id: TaxonomyId, contextDescription: string) => ipcRenderer.invoke('settings:updateModuleContext', id, contextDescription),
  deleteModule: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteModule', id),
  addEnvironment: (name: string) => ipcRenderer.invoke('settings:addEnvironment', name),
  updateEnvironment: (id: TaxonomyId, name: string) => ipcRenderer.invoke('settings:updateEnvironment', id, name),
  deleteEnvironment: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteEnvironment', id),
  addDevice: (name: string) => ipcRenderer.invoke('settings:addDevice', name),
  updateDevice: (id: TaxonomyId, name: string) => ipcRenderer.invoke('settings:updateDevice', id, name),
  deleteDevice: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteDevice', id),
  addBrowser: (name: string) => ipcRenderer.invoke('settings:addBrowser', name),
  updateBrowser: (id: TaxonomyId, name: string) => ipcRenderer.invoke('settings:updateBrowser', id, name),
  deleteBrowser: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteBrowser', id),
  addUserRole: (name: string) => ipcRenderer.invoke('settings:addUserRole', name),
  updateUserRole: (id: TaxonomyId, name: string) => ipcRenderer.invoke('settings:updateUserRole', id, name),
  deleteUserRole: (id: TaxonomyId) => ipcRenderer.invoke('settings:deleteUserRole', id),
  addConfigOption: (type: string, value: string) => ipcRenderer.invoke('settings:addConfigOption', type, value),
  updateConfigOption: (id: number, value: string) => ipcRenderer.invoke('settings:updateConfigOption', id, value),
  deleteConfigOption: (id: number) => ipcRenderer.invoke('settings:deleteConfigOption', id),
  saveTemplate: (id: number | null, name: string, templateText: string) => ipcRenderer.invoke('settings:saveTemplate', id, name, templateText),
  updateShortcut: (action: ShortcutAction, accelerator: string, enabled: boolean) => ipcRenderer.invoke('settings:updateShortcut', action, accelerator, enabled),
  updateJiraWorkspaceUrl: (value: string) => ipcRenderer.invoke('settings:updateJiraWorkspaceUrl', value),
  updateAutoBackupDirectoryPath: (value: string) => ipcRenderer.invoke('settings:updateAutoBackupDirectoryPath', value),
  updateQuickCaptureAnnotationReview: (enabled: boolean) => ipcRenderer.invoke('settings:updateQuickCaptureAnnotationReview', enabled),
  updateAiTriageOptions: (enabled: boolean, modelName: string) => ipcRenderer.invoke('settings:updateAiTriageOptions', enabled, modelName),
  getAiConfig: (): Promise<AiByokConfig> => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (input: AiConfigSaveInput): Promise<AiByokConfig> => ipcRenderer.invoke('save-ai-config', input),
  updateSupabaseSettings: (projectUrl: string, anonKey: string, inviteEmail?: string) =>
    inviteEmail === undefined
      ? ipcRenderer.invoke('settings:updateSupabaseSettings', projectUrl, anonKey)
      : ipcRenderer.invoke('settings:updateSupabaseSettings', projectUrl, anonKey, inviteEmail),
  testSupabaseConnection: () => ipcRenderer.invoke('sync:testConnection'),
  authSignIn: (email: string, password: string) => ipcRenderer.invoke('sync:authSignIn', email, password),
  authSignUp: (email: string, password: string, setup: SyncAccountSetup) => ipcRenderer.invoke('sync:authSignUp', email, password, setup),
  generateInvite: (passphrase: string, targetEmail: string, targetRole: string): Promise<string> => ipcRenderer.invoke('sync:generateInvite', passphrase, targetEmail, targetRole),
  decodeInvite: (token: string, passphrase: string): Promise<TeamInvitePayload> => ipcRenderer.invoke('sync:decodeInvite', token, passphrase),
  authSignOut: () => ipcRenderer.invoke('sync:authSignOut'),
  getSyncSessionStatus: () => ipcRenderer.invoke('sync:getSessionStatus'),
  listWorkspaces: () => ipcRenderer.invoke('sync:listWorkspaces'),
  updateWorkspaceName: (workspaceId: string, name: string) => ipcRenderer.invoke('sync:updateWorkspaceName', workspaceId, name),
  getWorkspaceRole: (workspaceId: string | null) => ipcRenderer.invoke('sync:getWorkspaceRole', workspaceId),
  claimIssueUserCode: (userCode: string): Promise<string> => ipcRenderer.invoke('sync:claimIssueUserCode', userCode),
  getSyncDiagnostics: () => ipcRenderer.invoke('sync:getDiagnostics'),
  getSyncRuntimeStatus: (): Promise<SyncRuntimeStatus | null> => ipcRenderer.invoke('sync:getRuntimeStatus'),
  syncNow: (): Promise<SyncRuntimeStatus | null> => ipcRenderer.invoke('sync:retryNow'),
  forceRetrySyncQueue: () => ipcRenderer.invoke('sync:forceRetry'),
  switchWorkspace: (workspaceId: string) => ipcRenderer.invoke('sync:switchWorkspace', workspaceId),
  toggleStartup: (enabled: boolean) => ipcRenderer.invoke('settings:toggleStartup', enabled),
  mergeReference: (tableName: ReferenceTable, sourceId: TaxonomyId, targetId: TaxonomyId) => ipcRenderer.invoke('settings:mergeReference', tableName, sourceId, targetId),
  createPreset: (input: CapturePresetInput) => ipcRenderer.invoke('settings:createPreset', input),
  updatePreset: (id: number, input: CapturePresetInput) => ipcRenderer.invoke('settings:updatePreset', id, input),
  deletePreset: (id: number) => ipcRenderer.invoke('settings:deletePreset', id),
  suspendShortcuts: () => ipcRenderer.invoke('shortcuts:suspend'),
  resumeShortcuts: () => ipcRenderer.invoke('shortcuts:resume'),
  listBugs: (filters: BugFilters) => ipcRenderer.invoke('bugs:list', filters),
  getTotalBugCount: () => ipcRenderer.invoke('bugs:count'),
  getBugStatusCounts: (): Promise<BugStatusCounts> => ipcRenderer.invoke('bugs:statusCounts'),
  getBug: (id: number) => ipcRenderer.invoke('bugs:get', id),
  createQuickBug: (input: QuickBugInput) => ipcRenderer.invoke('bugs:createQuick', input),
  updateBug: (id: number, input: BugUpdateInput) => ipcRenderer.invoke('bugs:update', id, input),
  deleteBug: (id: number) => ipcRenderer.invoke('bugs:delete', id),
  deleteAttachment: (id: number) => ipcRenderer.invoke('attachments:delete', id),
  downloadAttachment: (id: number) => ipcRenderer.invoke('attachments:download', id),
  saveAnnotatedAttachment: (parentId: number, dataUrl: string) => ipcRenderer.invoke('attachments:saveAnnotated', parentId, dataUrl),
  getAttachmentPreview: (id: number) => ipcRenderer.invoke('attachments:previewDataUrl', id),
  getAttachmentLineage: (id: number) => ipcRenderer.invoke('attachments:lineage', id),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  sendFeedback: (payload: FeedbackPayload) => ipcRenderer.invoke('support:sendFeedback', payload),
  setDetailsDirty: (dirty: boolean) => ipcRenderer.invoke('details:setDirty', dirty),
  detailsFlushComplete: (requestId: string, success: boolean) => ipcRenderer.invoke('details:flushComplete', requestId, success),
  startScreenshotCapture: (bugId?: number) => ipcRenderer.invoke('screenshot:start', bugId, captureContext),
  getScreenshotSource: (): Promise<Uint8Array | null> => ipcRenderer.invoke('screenshot:getSource'),
  completeScreenshotCapture: (dataUrl: string) => ipcRenderer.invoke('screenshot:complete', dataUrl),
  cancelScreenshotCapture: () => ipcRenderer.invoke('screenshot:cancel'),
  getPendingQuickScreenshot: () => ipcRenderer.invoke('quickScreenshot:getPending', captureContext),
  attachPendingQuickScreenshot: (dataUrl: string) => ipcRenderer.invoke('quickScreenshot:attachPending', dataUrl, captureContext),
  discardPendingQuickScreenshot: () => ipcRenderer.invoke('quickScreenshot:discardPending', captureContext),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  chooseBackupDirectory: () => ipcRenderer.invoke('backup:chooseDirectory'),
  clearCurrentWorkspace: () => ipcRenderer.invoke('app:clearCurrentWorkspace'),
  factoryReset: () => ipcRenderer.invoke('app:factoryReset'),
  onSyncStatus: (callback: (status: SyncRuntimeStatus | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SyncRuntimeStatus | null): void => callback(status);
    ipcRenderer.on('sync-status', listener);
    return () => {
      ipcRenderer.removeListener('sync-status', listener);
    };
  },
  triageBug: (bugData: unknown, requestId: string): Promise<import('../shared/aiRequest').AiRequestResult<string>> => ipcRenderer.invoke('ai:triageBug', bugData, requestId),
  processIssueWithByokAi: (payload: AiIssueProcessPayload, requestId: string): Promise<import('../shared/aiRequest').AiRequestResult<import('../shared/types').AiIssueProcessResult>> => ipcRenderer.invoke('ai:processIssueWithByok', payload, requestId),
  cancelAiRequest: (requestId: string): Promise<void> => ipcRenderer.invoke('ai:cancel', requestId),
  onAppShutdownStarted: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('app:shutdown-started', listener);
    return () => ipcRenderer.removeListener('app:shutdown-started', listener);
  },
  onQuickScreenshotReviewReady: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('quickScreenshot:reviewReady', listener);
    return () => {
      ipcRenderer.removeListener('quickScreenshot:reviewReady', listener);
    };
  },
  onScreenshotCaptured: (callback: (result: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown): void => callback(result);
    ipcRenderer.on('screenshot:captured', listener);
    return () => {
      ipcRenderer.removeListener('screenshot:captured', listener);
    };
  },
  onScreenshotSource: (callback: (pngBytes: Uint8Array) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pngBytes: Uint8Array): void => callback(pngBytes);
    ipcRenderer.on('screenshot:source', listener);
    return () => {
      ipcRenderer.removeListener('screenshot:source', listener);
    };
  },
  onOpenQuickCapture: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('app:quickCaptureOpened', listener);
    return () => {
      ipcRenderer.removeListener('app:quickCaptureOpened', listener);
    };
  },
  onNavigate: (callback: (route: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, route: string): void => callback(route);
    ipcRenderer.on('app:navigate', listener);
    return () => {
      ipcRenderer.removeListener('app:navigate', listener);
    };
  },
  onBugsChanged: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('bugs:changed', listener);
    return () => {
      ipcRenderer.removeListener('bugs:changed', listener);
    };
  },
  onShortcutsChanged: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('shortcuts:changed', listener);
    return () => {
      ipcRenderer.removeListener('shortcuts:changed', listener);
    };
  },
  onSettingsChanged: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('settings:changed', listener);
    return () => {
      ipcRenderer.removeListener('settings:changed', listener);
    };
  },
  onToast: (callback: (message: string, variant?: 'success' | 'info' | 'error') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string, variant?: 'success' | 'info' | 'error'): void => callback(message, variant);
    ipcRenderer.on('app:toast', listener);
    return () => {
      ipcRenderer.removeListener('app:toast', listener);
    };
  },
  onDetailsResume: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('details:resume', listener);
    return () => { ipcRenderer.removeListener('details:resume', listener); };
  },
  onDetailsFlushRequest: (callback: (requestId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string): void => callback(requestId);
    ipcRenderer.on('details:flush-save-request', listener);
    return () => {
      ipcRenderer.removeListener('details:flush-save-request', listener);
    };
  }
};

contextBridge.exposeInMainWorld('bugPocket', api);

export type BugPocketApi = typeof api;


