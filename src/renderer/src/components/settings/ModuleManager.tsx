import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Application, Module } from '../../../../shared/types';
import { getSettingsPreviewItems } from './settingsUtils';

export function ModuleManager({
  open,
  onToggle,
  applications,
  modules,
  mutationReady,
  refresh,
  showToast
}: {
  open: boolean;
  onToggle: () => void;
  applications: Application[];
  modules: Module[];
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(applications[0]?.id ?? null);
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editContext, setEditContext] = useState('');
  const editContextRef = useRef('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedApplicationId == null && applications[0]) setSelectedApplicationId(applications[0].id);
    if (selectedApplicationId != null && !applications.some((application) => application.id === selectedApplicationId)) {
      setSelectedApplicationId(applications[0]?.id ?? null);
    }
  }, [applications, selectedApplicationId]);

  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;
  const groupedModules = applications.map((application) => ({
    application,
    modules: modules.filter((module) => module.application_id === application.id)
  }));
  const unassignedModules = modules.filter((module) => module.application_id == null);
  const previewItems = getSettingsPreviewItems(modules, (module) => module.name);
  const hiddenCount = Math.max(0, modules.length - previewItems.length);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not update modules.';
      if (message.includes('active preset')) showToast('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.');
      setError(message);
    }
  };

  const addModule = async (): Promise<void> => {
    if (!mutationReady) { setError('Restart Bug Pocket to enable editing and removing settings.'); return; }
    if (!selectedApplicationId) { setError('Choose an application before adding a module.'); return; }
    if (!value.trim()) return;
    await window.bugPocket.addModule(value, selectedApplicationId);
    setValue('');
    await refresh();
  };

  const saveModule = async (module: Module, applicationId = module.application_id): Promise<void> => {
    await window.bugPocket.updateModule(module.id, editValue, applicationId ?? null, editContextRef.current);
    setEditingId(null);
    await refresh();
  };

  const startEdit = (module: Module): void => {
    if (!mutationReady) { setError('Restart Bug Pocket to enable editing and removing settings.'); return; }
    setEditingId(module.id);
    setEditValue(module.name);
    editContextRef.current = module.context_description ?? '';
    setEditContext(editContextRef.current);
    setError('');
  };

  const updateEditContext = (nextContext: string): void => {
    editContextRef.current = nextContext;
    setEditContext(nextContext);
  };

  const renderModuleRow = (module: Module, applicationId?: number) => (
    <div className="option-row module-option-row" key={module.id}>
      {editingId === module.id ? (
        <div className="option-edit-stack">
          <div className="option-edit-row">
            <input
              className="option-edit-input"
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run(async () => saveModule(module, applicationId));
                if (event.key === 'Escape') setEditingId(null);
              }}
            />
            <button className="icon-button" title="Save module" onClick={() => run(async () => saveModule(module, applicationId))}><Check size={15} /></button>
            <button className="icon-button" title="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
          </div>
          <label className="context-description-field">
            <span>Context / Business Logic</span>
            <textarea value={editContext} onChange={(event) => updateEditContext(event.target.value)} />
            <button className="context-save-button" type="button" onClick={() => run(async () => {
              await window.bugPocket.updateModuleContext(module.id, editContextRef.current);
              setEditingId(null);
              await refresh();
            })}>Save Context</button>
          </label>
        </div>
      ) : (
        <>
          <span className="option-name">{module.name}</span>
          <button className="icon-button" disabled={!mutationReady} title="Edit module" onClick={() => startEdit(module)}><Pencil size={15} /></button>
          <button className="icon-button danger" disabled={!mutationReady} title="Remove module" onClick={() => run(async () => { await window.bugPocket.deleteModule(module.id); await refresh(); })}><Trash2 size={15} /></button>
        </>
      )}
    </div>
  );

  return (
    <div className={open ? 'panel settings-option-panel module-settings-panel open' : 'panel settings-option-panel module-settings-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Modules</strong>
          <em>{modules.length} option{modules.length === 1 ? '' : 's'} nested under applications</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {previewItems.map((module) => <span className="chip settings-preview-chip" key={module.id}>{module.name}</span>)}
          {hiddenCount > 0 && <span className="chip settings-preview-chip muted-chip">+{hiddenCount} more</span>}
          {!modules.length && <span className="muted">No modules configured.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          <div className="module-add-row">
            <select value={selectedApplicationId ?? ''} onChange={(event) => setSelectedApplicationId(Number(event.target.value) || null)}>
              {applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
            </select>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={selectedApplication ? `Add module for ${selectedApplication.name}` : 'Choose an application'} />
            <button title="Add module" onClick={() => run(addModule)}><Plus size={16} /></button>
          </div>
          <div className="module-group-list">
            {groupedModules.map(({ application, modules: applicationModules }) => (
              <section className="module-group" key={application.id}>
                <h3>{application.name}</h3>
                <div className="option-list">
                  {applicationModules.map((module) => renderModuleRow(module, application.id))}
                  {!applicationModules.length && <p className="muted">No modules for this application yet.</p>}
                </div>
              </section>
            ))}
            {unassignedModules.length > 0 && (
              <section className="module-group">
                <h3>Unassigned modules</h3>
                <p className="muted module-group-note">Older modules without an application. Edit one to keep it here, or recreate it under an application.</p>
                <div className="option-list">
                  {unassignedModules.map((module) => renderModuleRow(module))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
