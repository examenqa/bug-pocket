import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import type { CapturePreset, CapturePresetInput, SettingsData } from '../../../../shared/types';
import { getModulesForApplication } from '../../utils/filters';
import { resolveTaxonomyId } from '../../utils/taxonomyIds';
import { getSettingsPreviewItems } from './settingsUtils';

const emptyPresetDraft: CapturePresetInput = {
  name: '',
  application_id: null,
  module_id: null,
  environment_id: null,
  user_role_id: null,
  entry_type_id: null
};

function presetSummary(preset: CapturePreset, settings: SettingsData): string {
  const parts = [
    settings.applications.find((application) => application.id === preset.application_id)?.name,
    settings.modules.find((module) => module.id === preset.module_id)?.name,
    settings.environments.find((environment) => environment.id === preset.environment_id)?.value,
    settings.userRoles.find((role) => role.id === preset.user_role_id)?.value
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'No fields mapped';
}

export function PresetManager({
  settings,
  mutationReady,
  refresh,
  showToast,
  open,
  onToggle
}: {
  settings: SettingsData;
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState<CapturePresetInput>(emptyPresetDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const presetLimitReached = settings.presets.length >= 3 && editingId == null;
  const moduleChoices = getModulesForApplication(settings, draft.application_id, draft.module_id);
  const bugEntryTypeId = useMemo(
    () => settings.entryTypes.find((entryType) => entryType.value.toLowerCase() === 'bug')?.id ?? null,
    [settings.entryTypes]
  );

  const updateDraft = <K extends keyof CapturePresetInput>(key: K, value: CapturePresetInput[K]): void => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'application_id' && !getModulesForApplication(settings, value as CapturePresetInput['application_id'], next.module_id).some((module) => module.id === next.module_id)) {
        next.module_id = null;
      }
      return next;
    });
  };

  const startCreate = (): void => {
    setEditingId(null);
    setDraft(emptyPresetDraft);
    setError('');
    setFormOpen(true);
  };

  const startEdit = (preset: CapturePreset): void => {
    setEditingId(preset.id);
    setDraft({
      name: preset.name,
      application_id: preset.application_id,
      module_id: preset.module_id,
      environment_id: preset.environment_id,
      user_role_id: preset.user_role_id,
      entry_type_id: bugEntryTypeId
    });
    setError('');
    setFormOpen(true);
  };

  const reset = (): void => {
    setEditingId(null);
    setDraft(emptyPresetDraft);
    setError('');
    setFormOpen(false);
  };

  const save = async (): Promise<void> => {
    setError('');
    const payload: CapturePresetInput = {
      ...draft,
      entry_type_id: bugEntryTypeId
    };
    try {
      if (editingId) await window.bugPocket.updatePreset(editingId, payload);
      else await window.bugPocket.createPreset(payload);
      await refresh();
      reset();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save preset.';
      setError(message);
      if (message.includes('3 Quick Capture presets')) showToast(message, 'error');
    }
  };

  const remove = async (id: number): Promise<void> => {
    setError('');
    await window.bugPocket.deletePreset(id);
    await refresh();
    if (editingId === id) reset();
  };

  const previewItems = getSettingsPreviewItems(settings.presets);
  const hiddenCount = Math.max(0, settings.presets.length - previewItems.length);
  const formDisabled = !mutationReady || presetLimitReached;

  return (
    <div className={open ? 'panel settings-option-panel preset-panel open' : 'panel settings-option-panel preset-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Quick Capture Presets</strong>
          <em>{settings.presets.length}/3 preset{settings.presets.length === 1 ? '' : 's'} configured</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {previewItems.map((preset) => <span className="chip settings-preview-chip" key={preset.id}>{preset.name}</span>)}
          {hiddenCount > 0 && <span className="chip settings-preview-chip muted-chip">+{hiddenCount} more</span>}
          {!settings.presets.length && <span className="muted">No presets yet.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          <div className="preset-utility-row">
            <p className="settings-helper">Up to 3 presets. Quick Panel shortcuts are Alt+1, Alt+2, and Alt+3.</p>
            {!formOpen && <button className="preset-save-button" type="button" disabled={!mutationReady || presetLimitReached} onClick={startCreate}>Create Preset</button>}
          </div>

          {formOpen && (
            <div className="preset-form preset-form-shell">
              <div className="preset-form-header-row">
                <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Preset name" disabled={formDisabled} />
                <div className="preset-form-actions">
                  <button className="preset-cancel-button" type="button" onClick={reset}>Cancel</button>
                  <button className="preset-save-button" type="button" disabled={formDisabled || !draft.name.trim()} onClick={() => void save()}>{editingId ? 'Save Preset' : 'Create Preset'}</button>
                </div>
              </div>
              <div className="preset-form-grid">
                <select value={draft.application_id ?? ''} onChange={(event) => updateDraft('application_id', resolveTaxonomyId(event.target.value, settings.applications))} disabled={formDisabled}>
                  <option value="">Application</option>
                  {settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
                </select>
                <select value={draft.module_id ?? ''} onChange={(event) => updateDraft('module_id', resolveTaxonomyId(event.target.value, moduleChoices))} disabled={formDisabled}>
                  <option value="">Module</option>
                  {moduleChoices.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
                </select>
                <select value={draft.environment_id ?? ''} onChange={(event) => updateDraft('environment_id', resolveTaxonomyId(event.target.value, settings.environments))} disabled={formDisabled}>
                  <option value="">Environment</option>
                  {settings.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.value}</option>)}
                </select>
                <select value={draft.user_role_id ?? ''} onChange={(event) => updateDraft('user_role_id', resolveTaxonomyId(event.target.value, settings.userRoles))} disabled={formDisabled}>
                  <option value="">User Role</option>
                  {settings.userRoles.map((role) => <option key={role.id} value={role.id}>{role.value}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="preset-list">
            {settings.presets.map((preset, index) => (
              <div className="preset-row" key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>{presetSummary(preset, settings)} [{`Alt+${index + 1}`}]</span>
                </div>
                <button className="icon-button" disabled={!mutationReady} title="Edit preset" onClick={() => startEdit(preset)}><Pencil size={15} /></button>
                <button className="icon-button danger" disabled={!mutationReady} title="Delete preset" onClick={() => void remove(preset.id)}><Trash2 size={15} /></button>
              </div>
            ))}
            {!settings.presets.length && <p className="muted">No presets yet.</p>}
          </div>

          {presetLimitReached && !formOpen && <p className="settings-helper">Preset limit reached. Edit or delete a preset to create another.</p>}
          {error && <p className="settings-error">{error}</p>}
        </div>
      )}
    </div>
  );
}


