import type { IpcMain, IpcMainInvokeEvent } from 'electron';

type ValueValidator = (value: unknown, path: string) => void;
export type IpcArgumentValidator = (args: readonly unknown[]) => void;

export interface SecureIpcRegistrar {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
}

const maxTextLength = 100_000;
const maxDataUrlLength = 50 * 1024 * 1024;

function fail(path: string, expectation: string): never {
  throw new TypeError(`Invalid IPC payload at ${path}: expected ${expectation}.`);
}

const stringValue = (maxLength = maxTextLength): ValueValidator => (value, path) => {
  if (typeof value !== 'string' || value.length > maxLength) fail(path, `a string no longer than ${maxLength} characters`);
};

const nonEmptyString = (maxLength = maxTextLength): ValueValidator => (value, path) => {
  stringValue(maxLength)(value, path);
  if (!(value as string).trim()) fail(path, 'a non-empty string');
};

const booleanValue: ValueValidator = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'a boolean');
};

const integerValue: ValueValidator = (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, 'a safe integer');
};

const positiveInteger: ValueValidator = (value, path) => {
  integerValue(value, path);
  if ((value as number) <= 0) fail(path, 'a positive integer');
};

const idValue: ValueValidator = (value, path) => {
  if (typeof value === 'number') return positiveInteger(value, path);
  if (typeof value === 'string' && value.trim() && value.length <= 128) return;
  fail(path, 'a positive integer or non-empty identifier string');
};

function nullable(validator: ValueValidator): ValueValidator {
  return (value, path) => {
    if (value !== null) validator(value, path);
  };
}

function optional(validator: ValueValidator): ValueValidator {
  return (value, path) => {
    if (value !== undefined) validator(value, path);
  };
}

const maxDiagnosticLength = 5_000;

function optionalNullableDiagnosticString(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  stringValue(maxDiagnosticLength)(value, path);
}

function optionalNullableText(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  stringValue(maxTextLength)(value, path);
}

function optionalNullableShortId(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.length === 0) return;
  if (typeof value === 'string' && value.length > 50) fail(path, 'a short taxonomy identifier');
  idValue(value, path);
}

function enumeration(values: readonly string[]): ValueValidator {
  return (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) fail(path, `one of: ${values.join(', ')}`);
  };
}

function arrayOf(validator: ValueValidator, maxItems = 1_000): ValueValidator {
  return (value, path) => {
    if (!Array.isArray(value) || value.length > maxItems) fail(path, `an array with at most ${maxItems} items`);
    value.forEach((item, index) => validator(item, `${path}[${index}]`));
  };
}

function plainObject(
  required: Record<string, ValueValidator>,
  optionalFields: Record<string, ValueValidator> = {}
): ValueValidator {
  return (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      fail(path, 'a plain object');
    }
    const record = value as Record<string, unknown>;
    const allowed = new Set([...Object.keys(required), ...Object.keys(optionalFields)]);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) fail(`${path}.${key}`, 'a recognized field');
    }
    for (const [key, validator] of Object.entries(required)) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`, 'a required field');
      validator(record[key], `${path}.${key}`);
    }
    for (const [key, validator] of Object.entries(optionalFields)) {
      if (Object.prototype.hasOwnProperty.call(record, key)) validator(record[key], `${path}.${key}`);
    }
  };
}

function oneOf(...validators: ValueValidator[]): ValueValidator {
  return (value, path) => {
    for (const validator of validators) {
      try {
        validator(value, path);
        return;
      } catch {
        // Try the next explicitly permitted shape.
      }
    }
    fail(path, 'one of the permitted value shapes');
  };
}

function args(...validators: ValueValidator[]): IpcArgumentValidator {
  return (values) => {
    if (values.length !== validators.length) fail('arguments', `${validators.length} argument(s)`);
    validators.forEach((validator, index) => validator(values[index], `arguments[${index}]`));
  };
}

function optionalSingleArg(validator: ValueValidator): IpcArgumentValidator {
  return (values) => {
    if (values.length > 1) fail('arguments', 'zero or one argument');
    if (values.length === 1) optional(validator)(values[0], 'arguments[0]');
  };
}

function twoOrThreeArgs(first: ValueValidator, second: ValueValidator, third: ValueValidator): IpcArgumentValidator {
  return (values) => {
    if (values.length !== 2 && values.length !== 3) fail('arguments', 'two or three arguments');
    first(values[0], 'arguments[0]');
    second(values[1], 'arguments[1]');
    if (values.length === 3) third(values[2], 'arguments[2]');
  };
}

function threeOrFourArgs(first: ValueValidator, second: ValueValidator, third: ValueValidator, fourth: ValueValidator): IpcArgumentValidator {
  return (values) => {
    if (values.length !== 3 && values.length !== 4) fail('arguments', 'three or four arguments');
    first(values[0], 'arguments[0]');
    second(values[1], 'arguments[1]');
    third(values[2], 'arguments[2]');
    if (values.length === 4) fourth(values[3], 'arguments[3]');
  };
}

const nullableInteger = nullable(positiveInteger);
const nullableId = nullable(idValue);
const internalRoute: ValueValidator = (value, path) => {
  nonEmptyString(512)(value, path);
  if (!/^\/[A-Za-z0-9_/?=&.%-]*$/.test(value as string) || (value as string).startsWith('//')) {
    fail(path, 'an internal hash route');
  }
};
const webUrl: ValueValidator = (value, path) => {
  nonEmptyString(2_048)(value, path);
  try {
    const parsed = new URL(value as string);
    if (!['http:', 'https:'].includes(parsed.protocol)) fail(path, 'an HTTP or HTTPS URL');
  } catch {
    fail(path, 'a valid HTTP or HTTPS URL');
  }
};
const emailAddress: ValueValidator = (value, path) => {
  nonEmptyString(320)(value, path);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value as string)) fail(path, 'a valid email address');
};
const pngDataUrl: ValueValidator = (value, path) => {
  stringValue(maxDataUrlLength)(value, path);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value as string)) fail(path, 'a PNG data URL');
};

const capturePresetInput = plainObject({
  name: nonEmptyString(200),
  application_id: nullableId,
  module_id: nullableId,
  environment_id: nullableId,
  user_role_id: nullableId,
  entry_type_id: nullableInteger
});

const captureContext = plainObject({ workspaceId: nullable(nonEmptyString(128)), draftId: nonEmptyString(128) });
const quickBugInput = plainObject({
  capture_context: captureContext,
  entry_type: nonEmptyString(100),
  application_id: nullableId,
  module_id: nullableId,
  user_role_id: nullableId,
  note: stringValue(maxTextLength),
  attachment_ids: arrayOf(positiveInteger, 100)
}, {
  environment_id: optionalNullableShortId,
  device_id: optionalNullableShortId,
  browser_id: optionalNullableShortId,
  workspace_id: optional(nullableId),
  created_by: optional(nullableId)
});

const bugUpdateInput = plainObject({
  entry_type: nonEmptyString(100),
  application_id: nullableId,
  module_id: nullableId,
  device_id: optionalNullableShortId,
  browser_id: optionalNullableShortId,
  user_role_id: nullableId,
  title: stringValue(1_000),
  note: stringValue(maxTextLength),
  other_details: stringValue(maxTextLength),
  steps_to_reproduce: stringValue(maxTextLength),
  expected_result: stringValue(maxTextLength),
  actual_result: stringValue(maxTextLength),
  status: enumeration(['Draft', 'Reported', 'Discarded']),
  severity: stringValue(100),
  reported: booleanValue,
  issue_platform: stringValue(100),
  issue_id: stringValue(500),
  issue_url: stringValue(2_048),
  tags: stringValue(10_000)
}, {
  environment_id: optionalNullableShortId
});

const bugFilters = plainObject({}, {
  search: optional(stringValue(1_000)),
  entryType: optional(stringValue(100)),
  applicationId: optional(oneOf(idValue, enumeration(['all']))),
  moduleId: optional(oneOf(idValue, enumeration(['all']))),
  environmentId: optional(oneOf(idValue, enumeration(['all']))),
  status: optional(stringValue(100)),
  severity: optional(stringValue(100)),
  syncStatus: optional(enumeration(['Local Only', 'Sync Pending', 'Synced', 'Sync Failed', 'all'])),
  reported: optional(enumeration(['all', 'reported', 'unreported']))
});

const provider = enumeration(['OpenAI', 'Grok', 'OpenRouter', 'Gemini', 'Custom/Local']);
const aiConfigInput = plainObject({
  provider,
  baseUrl: stringValue(2_048),
  modelId: stringValue(500),
  customSystemPrompt: stringValue(maxTextLength)
}, {
  apiKeyOperation: optional(oneOf(
    plainObject({ action: enumeration(['clear']) }),
    plainObject({ action: enumeration(['replace']), value: nonEmptyString(20_000) })
  ))
});

const syncRolePermission = plainObject({
  role: nonEmptyString(80),
  canRead: booleanValue,
  canWrite: booleanValue
});

const syncAccountSetup = plainObject({
  accountMode: enumeration(['single', 'team']),
  rolePermissions: arrayOf(syncRolePermission, 20)
});

const aiIssuePayload = plainObject({
  rawInput: stringValue(maxTextLength),
  taxonomy: plainObject({}, {
    application: optional(stringValue(500)),
    module: optional(stringValue(500)),
    environment: optionalNullableDiagnosticString,
    user_role: optional(stringValue(500)),
    device: optionalNullableDiagnosticString,
    browser: optionalNullableDiagnosticString,
    os: optionalNullableDiagnosticString,
    entry_type: optional(stringValue(500)),
    severity: optional(stringValue(500))
  })
});

const aiTriagePayload = plainObject({ note: stringValue(maxTextLength) }, {
  id: optional(positiveInteger),
  title: optional(stringValue(1_000)),
  application: optional(stringValue(500)),
  application_context: optional(stringValue(maxTextLength)),
  module: optional(stringValue(500)),
  module_context: optional(stringValue(maxTextLength)),
  environment: optionalNullableDiagnosticString,
  device: optionalNullableDiagnosticString,
  browser: optionalNullableDiagnosticString,
  os: optionalNullableDiagnosticString,
  user_role: optional(stringValue(500)),
  entry_type: optional(stringValue(500)),
  severity: optional(stringValue(500)),
  status: optional(stringValue(100)),
  steps_to_reproduce: optionalNullableText,
  expected_result: optional(stringValue(maxTextLength)),
  actual_result: optional(stringValue(maxTextLength)),
  other_details: optional(stringValue(maxTextLength)),
  attachment_id: optional(nonEmptyString(32)),
  refinement_note: optional(stringValue(maxTextLength))
});

const feedbackPayload = plainObject({
  type: enumeration(['Bug', 'Feature']),
  message: nonEmptyString(maxTextLength)
}, {
  user_email: optional(stringValue(500)),
  image_base64: optional(stringValue(maxDataUrlLength)),
  image_mime_type: optional(enumeration(['image/png', 'image/jpeg']))
});

export function createIpcArgumentValidators(): Record<string, IpcArgumentValidator> {
  const validators: Record<string, IpcArgumentValidator> = {};
  const noArgs = [
    'window:openQuickCapture', 'window:expandQuickCaptureForReview',
    'window:restoreQuickCaptureCompact', 'settings:get', 'get-ai-config', 'shortcuts:suspend',
    'shortcuts:resume', 'bugs:count', 'bugs:statusCounts', 'capture:context', 'screenshot:getSource',
    'screenshot:cancel',
    'backup:export', 'backup:import', 'backup:chooseDirectory', 'app:clearCurrentWorkspace', 'app:factoryReset',
    'sync:testConnection', 'sync:authSignOut', 'sync:getSessionStatus', 'sync:listWorkspaces',
    'sync:getDiagnostics', 'sync:getRuntimeStatus', 'sync:retryNow', 'sync:forceRetry'
  ];
  noArgs.forEach((channel) => { validators[channel] = args(); });

  validators['window:openMain'] = optionalSingleArg(internalRoute);
  validators['window:openSettings'] = optionalSingleArg(stringValue(100));
  validators['settings:addApplication'] = twoOrThreeArgs(nonEmptyString(200), nullable(stringValue(maxTextLength)), stringValue(8));
  validators['settings:updateApplication'] = threeOrFourArgs(idValue, nonEmptyString(200), stringValue(maxTextLength), stringValue(8));
  validators['settings:updateApplicationContext'] = args(idValue, stringValue(maxTextLength));
  validators['settings:updateApplicationSync'] = args(idValue, booleanValue);
  validators['settings:deleteApplication'] = args(idValue);
  validators['settings:addModule'] = args(nonEmptyString(200), nullableId, stringValue(maxTextLength));
  validators['settings:updateModule'] = args(idValue, nonEmptyString(200), nullableId, stringValue(maxTextLength));
  validators['settings:updateModuleContext'] = args(idValue, stringValue(maxTextLength));
  validators['settings:deleteModule'] = args(idValue);
  for (const noun of ['Environment', 'Device', 'Browser', 'UserRole']) {
    validators[`settings:add${noun}`] = args(nonEmptyString(200));
    validators[`settings:update${noun}`] = args(idValue, nonEmptyString(200));
    validators[`settings:delete${noun}`] = args(idValue);
  }
  validators['settings:addConfigOption'] = args(nonEmptyString(100), nonEmptyString(500));
  validators['settings:updateConfigOption'] = args(positiveInteger, nonEmptyString(500));
  validators['settings:deleteConfigOption'] = args(positiveInteger);
  validators['settings:saveTemplate'] = args(nullableInteger, nonEmptyString(200), stringValue(maxTextLength));
  validators['settings:updateJiraWorkspaceUrl'] = args(stringValue(2_048));
  validators['settings:updateAutoBackupDirectoryPath'] = args(stringValue(4_096));
  validators['settings:updateQuickCaptureAnnotationReview'] = args(booleanValue);
  validators['settings:updateAiTriageOptions'] = args(booleanValue, nonEmptyString(500));
  validators['save-ai-config'] = args(aiConfigInput);
  validators['settings:updateSupabaseSettings'] = twoOrThreeArgs(stringValue(2_048), stringValue(20_000), emailAddress);
  validators['settings:toggleStartup'] = args(booleanValue);
  validators['settings:mergeReference'] = args(enumeration(['environment', 'device', 'browser', 'user_role']), idValue, idValue);
  validators['settings:createPreset'] = args(capturePresetInput);
  validators['settings:updatePreset'] = args(positiveInteger, capturePresetInput);
  validators['settings:deletePreset'] = args(positiveInteger);
  validators['settings:updateShortcut'] = args(enumeration(['quick_capture', 'main_panel', 'global_screenshot']), stringValue(200), booleanValue);
  validators['bugs:list'] = args(bugFilters);
  validators['bugs:get'] = args(positiveInteger);
  validators['bugs:createQuick'] = args(quickBugInput);
  validators['bugs:update'] = args(positiveInteger, bugUpdateInput);
  validators['bugs:delete'] = args(positiveInteger);
  for (const channel of ['attachments:delete', 'attachments:download', 'attachments:previewDataUrl', 'attachments:lineage']) {
    validators[channel] = args(positiveInteger);
  }
  validators['attachments:saveAnnotated'] = args(positiveInteger, pngDataUrl);
  validators['clipboard:copy'] = args(stringValue(maxTextLength));
  validators['shell:openExternal'] = args(webUrl);
  validators['support:sendFeedback'] = args(feedbackPayload);
  validators['details:flushComplete'] = args(nonEmptyString(128), booleanValue);
  for (const channel of ['capture:listPending','capture:discardPending','window:hideQuickCapture','quickScreenshot:getPending','quickScreenshot:discardPending']) {
    validators[channel] = args(nullable(captureContext));
  }
  validators['details:setDirty'] = args(booleanValue);
  validators['screenshot:start'] = args(optional(positiveInteger), nullable(captureContext));
  validators['screenshot:complete'] = args(pngDataUrl);
  validators['quickScreenshot:attachPending'] = args(pngDataUrl, nullable(captureContext));
  validators['sync:authSignIn'] = args(nonEmptyString(500), nonEmptyString(20_000));
  validators['sync:authSignUp'] = args(nonEmptyString(500), nonEmptyString(20_000), syncAccountSetup);
  validators['sync:generateInvite'] = args(nonEmptyString(512), emailAddress, nonEmptyString(80));
  validators['sync:decodeInvite'] = args(nonEmptyString(50_000), nonEmptyString(512));
  validators['sync:updateWorkspaceName'] = args(nonEmptyString(128), nonEmptyString(200));
  validators['sync:getWorkspaceRole'] = args(nullable(nonEmptyString(128)));
  validators['sync:claimIssueUserCode'] = args(nonEmptyString(3));
  validators['sync:switchWorkspace'] = args(nonEmptyString(128));
  validators['ai:triageBug'] = args(aiTriagePayload);
  validators['ai:processIssueWithByok'] = args(aiIssuePayload);
  return validators;
}

export function createSecureIpcRegistrar(
  ipc: Pick<IpcMain, 'handle'>,
  validators: Record<string, IpcArgumentValidator>,
  isTrustedEvent: (event: IpcMainInvokeEvent) => boolean
): SecureIpcRegistrar {
  return {
    handle(channel, listener) {
      const validate = validators[channel];
      if (!validate) throw new Error(`No IPC argument schema is registered for channel '${channel}'.`);
      ipc.handle(channel, (event, ...incomingArgs) => {
        if (!isTrustedEvent(event)) throw new Error(`Rejected IPC '${channel}' from an untrusted renderer frame.`);
        validate(incomingArgs);
        return listener(event, ...incomingArgs);
      });
    }
  };
}
