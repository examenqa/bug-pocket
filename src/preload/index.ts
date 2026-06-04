import { contextBridge, ipcRenderer } from 'electron';
import type { AiByokConfig, AiConfigSaveInput, AiIssueProcessPayload, AiProvider, BugFilters, BugUpdateInput, CapturePresetInput, FeedbackPayload, QuickBugInput, ReferenceTable, ShortcutAction } from '../shared/types';

const api = {
  openQuickCapture: () => ipcRenderer.invoke('window:openQuickCapture'),
  hideQuickCapture: () => ipcRenderer.invoke('window:hideQuickCapture'),
  openMainWindow: (route?: string) => ipcRenderer.invoke('window:openMain', route),
  openSettings: (section?: string) => ipcRenderer.invoke('window:openSettings', section),
  expandQuickCaptureForReview: () => ipcRenderer.invoke('window:expandQuickCaptureForReview'),
  restoreQuickCaptureCompact: () => ipcRenderer.invoke('window:restoreQuickCaptureCompact'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  addApplication: (name: string, contextDescription = '') => ipcRenderer.invoke('settings:addApplication', name, contextDescription),
  updateApplication: (id: number, name: string, contextDescription = '') => ipcRenderer.invoke('settings:updateApplication', id, name, contextDescription),
  updateApplicationContext: (id: number, contextDescription: string) => ipcRenderer.invoke('settings:updateApplicationContext', id, contextDescription),
  updateApplicationSync: (id: number, isSynced: boolean) => ipcRenderer.invoke('settings:updateApplicationSync', id, isSynced),
  deleteApplication: (id: number) => ipcRenderer.invoke('settings:deleteApplication', id),
  addModule: (name: string, applicationId: number | null, contextDescription = '') => ipcRenderer.invoke('settings:addModule', name, applicationId, contextDescription),
  updateModule: (id: number, name: string, applicationId: number | null, contextDescription = '') => ipcRenderer.invoke('settings:updateModule', id, name, applicationId, contextDescription),
  updateModuleContext: (id: number, contextDescription: string) => ipcRenderer.invoke('settings:updateModuleContext', id, contextDescription),
  deleteModule: (id: number) => ipcRenderer.invoke('settings:deleteModule', id),
  addEnvironment: (name: string) => ipcRenderer.invoke('settings:addEnvironment', name),
  updateEnvironment: (id: number, name: string) => ipcRenderer.invoke('settings:updateEnvironment', id, name),
  deleteEnvironment: (id: number) => ipcRenderer.invoke('settings:deleteEnvironment', id),
  addDevice: (name: string) => ipcRenderer.invoke('settings:addDevice', name),
  updateDevice: (id: number, name: string) => ipcRenderer.invoke('settings:updateDevice', id, name),
  deleteDevice: (id: number) => ipcRenderer.invoke('settings:deleteDevice', id),
  addBrowser: (name: string) => ipcRenderer.invoke('settings:addBrowser', name),
  updateBrowser: (id: number, name: string) => ipcRenderer.invoke('settings:updateBrowser', id, name),
  deleteBrowser: (id: number) => ipcRenderer.invoke('settings:deleteBrowser', id),
  addUserRole: (name: string) => ipcRenderer.invoke('settings:addUserRole', name),
  updateUserRole: (id: number, name: string) => ipcRenderer.invoke('settings:updateUserRole', id, name),
  deleteUserRole: (id: number) => ipcRenderer.invoke('settings:deleteUserRole', id),
  addConfigOption: (type: string, value: string) => ipcRenderer.invoke('settings:addConfigOption', type, value),
  updateConfigOption: (id: number, value: string) => ipcRenderer.invoke('settings:updateConfigOption', id, value),
  deleteConfigOption: (id: number) => ipcRenderer.invoke('settings:deleteConfigOption', id),
  saveTemplate: (id: number | null, name: string, templateText: string) => ipcRenderer.invoke('settings:saveTemplate', id, name, templateText),
  updateShortcut: (action: ShortcutAction, accelerator: string, enabled: boolean) => ipcRenderer.invoke('settings:updateShortcut', action, accelerator, enabled),
  updateJiraWorkspaceUrl: (value: string) => ipcRenderer.invoke('settings:updateJiraWorkspaceUrl', value),
  updateAutoBackupDirectoryPath: (value: string) => ipcRenderer.invoke('settings:updateAutoBackupDirectoryPath', value),
  updateQuickCaptureAnnotationReview: (enabled: boolean) => ipcRenderer.invoke('settings:updateQuickCaptureAnnotationReview', enabled),
  updateAiTriageOptions: (enabled: boolean, modelName: string) => ipcRenderer.invoke('settings:updateAiTriageOptions', enabled, modelName),
  getAiConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (input: AiConfigSaveInput): Promise<AiByokConfig> => ipcRenderer.invoke('save-ai-config', input),
  updateSupabaseSettings: (projectUrl: string, anonKey: string) => ipcRenderer.invoke('settings:updateSupabaseSettings', projectUrl, anonKey),
  testSupabaseConnection: () => ipcRenderer.invoke('sync:testConnection'),
  authSignIn: (email: string, password: string) => ipcRenderer.invoke('sync:authSignIn', email, password),
  authSignUp: (email: string, password: string) => ipcRenderer.invoke('sync:authSignUp', email, password),
  authSignOut: () => ipcRenderer.invoke('sync:authSignOut'),
  getSyncSessionStatus: () => ipcRenderer.invoke('sync:getSessionStatus'),
  toggleStartup: (enabled: boolean) => ipcRenderer.invoke('settings:toggleStartup', enabled),
  mergeReference: (tableName: ReferenceTable, sourceId: number, targetId: number) => ipcRenderer.invoke('settings:mergeReference', tableName, sourceId, targetId),
  createPreset: (input: CapturePresetInput) => ipcRenderer.invoke('settings:createPreset', input),
  updatePreset: (id: number, input: CapturePresetInput) => ipcRenderer.invoke('settings:updatePreset', id, input),
  deletePreset: (id: number) => ipcRenderer.invoke('settings:deletePreset', id),
  suspendShortcuts: () => ipcRenderer.invoke('shortcuts:suspend'),
  resumeShortcuts: () => ipcRenderer.invoke('shortcuts:resume'),
  listBugs: (filters: BugFilters) => ipcRenderer.invoke('bugs:list', filters),
  getTotalBugCount: () => ipcRenderer.invoke('bugs:count'),
  getBug: (id: number) => ipcRenderer.invoke('bugs:get', id),
  createQuickBug: (input: QuickBugInput) => ipcRenderer.invoke('bugs:createQuick', input),
  updateBug: (id: number, input: BugUpdateInput) => ipcRenderer.invoke('bugs:update', id, input),
  deleteBug: (id: number) => ipcRenderer.invoke('bugs:delete', id),
  deleteAttachment: (id: number) => ipcRenderer.invoke('attachments:delete', id),
  downloadAttachment: (id: number) => ipcRenderer.invoke('attachments:download', id),
  saveAnnotatedAttachment: (parentId: number, dataUrl: string) => ipcRenderer.invoke('attachments:saveAnnotated', parentId, dataUrl),
  getAttachmentPreview: (id: number) => ipcRenderer.invoke('attachments:previewDataUrl', id),
  getAttachmentLineage: (id: number) => ipcRenderer.invoke('attachments:lineage', id),
  resolveAttachmentPath: (id: number) => ipcRenderer.invoke('attachments:resolvePath', id),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  sendFeedback: (payload: FeedbackPayload) => ipcRenderer.invoke('support:sendFeedback', payload),
  setDetailsDirty: (dirty: boolean) => ipcRenderer.invoke('details:setDirty', dirty),
  detailsFlushComplete: () => ipcRenderer.invoke('details:flushComplete'),
  startScreenshotCapture: (bugId?: number) => ipcRenderer.invoke('screenshot:start', bugId),
  getScreenshotSource: () => ipcRenderer.invoke('screenshot:getSource'),
  completeScreenshotCapture: (dataUrl: string) => ipcRenderer.invoke('screenshot:complete', dataUrl),
  cancelScreenshotCapture: () => ipcRenderer.invoke('screenshot:cancel'),
  getPendingQuickScreenshot: () => ipcRenderer.invoke('quickScreenshot:getPending'),
  attachPendingQuickScreenshot: (dataUrl: string) => ipcRenderer.invoke('quickScreenshot:attachPending', dataUrl),
  discardPendingQuickScreenshot: () => ipcRenderer.invoke('quickScreenshot:discardPending'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  chooseBackupDirectory: () => ipcRenderer.invoke('backup:chooseDirectory'),
  factoryReset: () => ipcRenderer.invoke('app:factoryReset'),
  triageBug: (bugData: unknown) => ipcRenderer.invoke('ai:triageBug', bugData),
  processIssueWithByokAi: (payload: AiIssueProcessPayload) => ipcRenderer.invoke('ai:processIssueWithByok', payload),
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
  onScreenshotSource: (callback: (dataUrl: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dataUrl: string): void => callback(dataUrl);
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
  onUpdaterEvent: (callback: (payload: { event: string; [key: string]: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { event: string; [key: string]: unknown }): void => callback(payload);
    ipcRenderer.on('updater:event', listener);
    return () => {
      ipcRenderer.removeListener('updater:event', listener);
    };
  },
  onDetailsFlushRequest: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('details:flush-save-request', listener);
    return () => {
      ipcRenderer.removeListener('details:flush-save-request', listener);
    };
  }
};

contextBridge.exposeInMainWorld('bugPocket', api);

export type BugPocketApi = typeof api;

