import React, { useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { TaxonomyId } from '../../../../shared/types';
import { getSettingsPreviewItems } from './settingsUtils';

export interface SettingsOptionItem<TId extends TaxonomyId = TaxonomyId> {
  id: TId;
  label: string;
  contextDescription?: string;
  applicationId?: TaxonomyId | null;
  isSynced?: boolean;
}

interface OptionManagerProps<TId extends TaxonomyId> {
  title: string;
  open: boolean;
  onToggle: () => void;
  mutationReady: boolean;
  items: SettingsOptionItem<TId>[];
  onAdd: (value: string, contextDescription?: string) => Promise<void>;
  onUpdate: (id: TId, value: string, item: SettingsOptionItem<TId>) => Promise<void>;
  onUpdateContext?: (id: TId, contextDescription: string, item: SettingsOptionItem<TId>) => Promise<void>;
  onDelete: (id: TId, item: SettingsOptionItem<TId>) => Promise<void>;
  onMerge?: (sourceId: TId, targetId: TId, sourceItem: SettingsOptionItem<TId>, targetItem: SettingsOptionItem<TId>) => Promise<void>;
  onToggleSync?: (id: TId, isSynced: boolean, item: SettingsOptionItem<TId>) => Promise<void>;
  addPlaceholder?: string;
  addButtonLabel?: string;
  addContextLabel?: string;
  addContextRequired?: boolean;
  readOnly?: boolean;
  readOnlyMessage?: string;
}

export function OptionManager<TId extends TaxonomyId>({
  title,
  open,
  onToggle,
  mutationReady,
  items,
  onAdd,
  onUpdate,
  onUpdateContext,
  onDelete,
  onMerge,
  onToggleSync,
  addPlaceholder,
  addButtonLabel,
  addContextLabel,
  addContextRequired = false,
  readOnly = false,
  readOnlyMessage = 'Taxonomy is managed by workspace admins.'
}: OptionManagerProps<TId>) {
  const [value, setValue] = useState('');
  const [addContext, setAddContext] = useState('');
  const [editingId, setEditingId] = useState<TId | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editContext, setEditContext] = useState('');
  const editContextRef = useRef('');
  const [mergingId, setMergingId] = useState<TId | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<TId | null>(null);
  const [error, setError] = useState('');
  const previewItems = getSettingsPreviewItems(items);
  const hiddenCount = Math.max(0, items.length - previewItems.length);
  const addDisabled = !value.trim() || (addContextRequired && !addContext.trim());

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update setting.');
    }
  };

  const startEdit = (item: SettingsOptionItem<TId>): void => {
    if (readOnly) { setError(readOnlyMessage); return; }
    if (!mutationReady) { setError('Restart Bug Pocket to enable editing and removing settings.'); return; }
    setEditingId(item.id);
    setMergingId(null);
    setEditValue(item.label);
    editContextRef.current = item.contextDescription ?? '';
    setEditContext(editContextRef.current);
    setError('');
  };

  const updateEditContext = (nextContext: string): void => {
    editContextRef.current = nextContext;
    setEditContext(nextContext);
  };

  const saveEditedItem = async (item: SettingsOptionItem<TId>): Promise<void> => {
    await onUpdate(item.id, editValue, { ...item, contextDescription: editContextRef.current });
    setEditingId(null);
  };

  const saveContextOnly = async (item: SettingsOptionItem<TId>): Promise<void> => {
    if (onUpdateContext) {
      await onUpdateContext(item.id, editContextRef.current, item);
    } else {
      await saveEditedItem(item);
    }
    setEditingId(null);
  };

  const startMerge = (item: SettingsOptionItem<TId>): void => {
    if (readOnly) { setError(readOnlyMessage); return; }
    if (!mutationReady || !onMerge) { setError('Restart Bug Pocket to enable merging settings.'); return; }
    const firstTarget = items.find((option) => option.id !== item.id);
    if (!firstTarget) { setError('Add another option before merging.'); return; }
    setEditingId(null);
    setMergingId(item.id);
    setMergeTargetId(firstTarget.id);
    setError('');
  };

  return (
    <div className={open ? 'panel settings-option-panel open' : 'panel settings-option-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <em>{items.length} option{items.length === 1 ? '' : 's'}</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {previewItems.map((item) => <span className="chip settings-preview-chip" key={item.id}>{item.label}</span>)}
          {hiddenCount > 0 && <span className="chip settings-preview-chip muted-chip">+{hiddenCount} more</span>}
          {!items.length && <span className="muted">No options configured.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          {readOnly && <p className="settings-helper">{readOnlyMessage}</p>}
          {!readOnly && (
            <div className={[
              'add-row',
              addContextLabel ? 'add-row-with-context' : '',
              addButtonLabel ? 'add-row-with-text-button' : ''
            ].filter(Boolean).join(' ')}>
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={addPlaceholder ?? `Add ${title.toLowerCase()}`}
              />
              <button
                className={addButtonLabel ? 'add-option-text-button' : undefined}
                type="button"
                title={`Add ${title}`}
                disabled={addDisabled}
                onClick={() => run(async () => {
                  if (addDisabled) return;
                  await onAdd(value, addContext);
                  setValue('');
                  setAddContext('');
                })}
              >
                {addButtonLabel ?? <Plus size={16} />}
              </button>
              {addContextLabel && (
                <label className="context-description-field add-context-field">
                  <span>{addContextLabel}{addContextRequired ? ' *' : ''}</span>
                  <textarea value={addContext} onChange={(event) => setAddContext(event.target.value)} />
                </label>
              )}
            </div>
          )}
          <div className="option-list">
            {items.map((item) => (
              <div className={[onMerge ? 'has-merge' : '', onToggleSync ? 'has-sync-toggle' : '', 'option-row'].filter(Boolean).join(' ')} key={item.id}>
                {editingId === item.id ? (
                  <div className="option-edit-stack">
                    <div className="option-edit-row">
                      <input
                        className="option-edit-input"
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { void run(async () => { await saveEditedItem(item); }); }
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <button className="icon-button" title="Save option" onClick={() => run(async () => saveEditedItem(item))}><Check size={15} /></button>
                      <button className="icon-button" title="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
                    </div>
                    {item.contextDescription !== undefined && (
                      <label className="context-description-field">
                        <span>Context / Business Logic</span>
                        <textarea value={editContext} onChange={(event) => updateEditContext(event.target.value)} />
                        <button className="context-save-button" type="button" onClick={() => run(async () => saveContextOnly(item))}>Save Context</button>
                      </label>
                    )}
                  </div>
                ) : mergingId === item.id ? (
                  <>
                    <span className="option-name">Merge "{item.label}" into</span>
                    <select
                      className="option-merge-select"
                      value={mergeTargetId ?? ''}
                      onChange={(event) => setMergeTargetId(items.find((target) => String(target.id) === event.target.value)?.id ?? null)}
                    >
                      {items.filter((target) => target.id !== item.id).map((target) => (
                        <option key={target.id} value={target.id}>{target.label}</option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      title="Confirm merge"
                      onClick={() => run(async () => {
                        const target = items.find((candidate) => candidate.id === mergeTargetId);
                        if (!target || !onMerge) throw new Error('Choose a target option.');
                        await onMerge(item.id, target.id, item, target);
                        setMergingId(null);
                      })}
                    >
                      <Check size={15} />
                    </button>
                    <button className="icon-button" title="Cancel merge" onClick={() => setMergingId(null)}><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <span className="option-name">{item.label}</span>
                    {onToggleSync && !readOnly && (
                      <label className="option-sync-toggle" title="Allow this application's records to enter the future sync queue">
                        <input
                          type="checkbox"
                          checked={item.isSynced ?? true}
                          disabled={!mutationReady}
                          onChange={(event) => run(async () => onToggleSync(item.id, event.target.checked, item))}
                        />
                        Sync
                      </label>
                    )}
                    {!readOnly && <button className="icon-button" disabled={!mutationReady} title="Edit option" onClick={() => startEdit(item)}><Pencil size={15} /></button>}
                    {onMerge && !readOnly && <button className="icon-button" disabled={!mutationReady || items.length < 2} title="Merge option" onClick={() => startMerge(item)}><RefreshCw size={15} /></button>}
                    {!readOnly && <button className="icon-button danger" disabled={!mutationReady} title="Remove option" onClick={() => run(async () => onDelete(item.id, item))}><Trash2 size={15} /></button>}
                  </>
                )}
              </div>
            ))}
            {!items.length && <p className="muted">No options configured.</p>}
          </div>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
