import { Camera, Plus, Save } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { CapturePreset, ScreenshotResult, SettingsData, TaxonomyId } from '../../../shared/types';
import { ScreenshotAnnotator } from './ScreenshotAnnotator';
import type { ScreenshotAnnotatorHandle } from './ScreenshotAnnotator';
import { BrandMark } from './shared/BrandMark';

const quickPanelShortcuts = {
  presets: ['Alt+1', 'Alt+2', 'Alt+3'],
  application: 'Alt+A',
  module: 'Alt+M',
  environment: 'Alt+E',
  userRole: 'Alt+R',
  note: 'Alt+N',
  screenshot: 'Alt+S',
  save: 'Ctrl+Enter',
  cancel: 'Esc'
} as const;

function quickPanelErrorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  if (typeof caught === 'string' && caught.trim()) return caught;
  return 'Could not create this item.';
}

export interface QuickCaptureDraft {
  applicationId: TaxonomyId | null;
  moduleId: TaxonomyId | null;
  environmentId: TaxonomyId | null;
  userRoleId: TaxonomyId | null;
  note: string;
}

interface QuickCaptureFormProps {
  settings: SettingsData;
  attachments: ScreenshotResult[];
  saving: boolean;
  focusToken: number;
  onTakeScreenshot: () => Promise<void>;
  onConfigurePresets: () => Promise<void>;
  onSave: (draft: QuickCaptureDraft) => Promise<void>;
  onCancel: () => Promise<void>;
  onCreateApplication: (name: string) => Promise<TaxonomyId>;
  onCreateModule: (name: string, applicationId: TaxonomyId | null) => Promise<TaxonomyId>;
  onCreateEnvironment: (value: string) => Promise<TaxonomyId>;
  onCreateUserRole: (value: string) => Promise<TaxonomyId>;
}

export function QuickCaptureForm({
  settings,
  attachments,
  saving,
  focusToken,
  onTakeScreenshot,
  onConfigurePresets,
  onSave,
  onCancel,
  onCreateApplication,
  onCreateModule,
  onCreateEnvironment,
  onCreateUserRole
}: QuickCaptureFormProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [applicationId, setApplicationId] = useState<TaxonomyId | null>(null);
  const [moduleId, setModuleId] = useState<TaxonomyId | null>(null);
  const [environmentId, setEnvironmentId] = useState<TaxonomyId | null>(null);
  const [userRoleId, setUserRoleId] = useState<TaxonomyId | null>(null);
  const [note, setNote] = useState('');
  const [reviewScreenshot, setReviewScreenshot] = useState('');
  const [presetNotice, setPresetNotice] = useState('');
  const applicationRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<HTMLInputElement>(null);
  const environmentRef = useRef<HTMLInputElement>(null);
  const userRoleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const screenshotButtonRef = useRef<HTMLButtonElement>(null);
  const quickWindowRef = useRef<HTMLDivElement>(null);
  const screenshotAnnotatorRef = useRef<ScreenshotAnnotatorHandle>(null);
  const presetNoticeTimerRef = useRef<number | null>(null);
  const wasReviewingScreenshotRef = useRef(false);

  const applicationOptions = useMemo(
    () => settings.applications.map((application) => ({ key: String(application.id), value: application.id, label: application.name })),
    [settings.applications]
  );
  const moduleOptions = useMemo(
    () => settings.modules
      .filter((module) => module.application_id === applicationId || (!applicationId && module.application_id == null))
      .map((module) => ({ key: String(module.id), value: module.id, label: module.name })),
    [applicationId, settings.modules]
  );
  const environmentOptions = useMemo(
    () => settings.environments.map((item) => ({ key: String(item.id), value: item.id, label: item.value })),
    [settings.environments]
  );
  const userRoleOptions = useMemo(
    () => settings.userRoles.map((item) => ({ key: String(item.id), value: item.id, label: item.value })),
    [settings.userRoles]
  );
  const presetOptions = useMemo(() => settings.presets.slice(0, 3), [settings.presets]);
  const developerReadOnly = settings.currentWorkspaceRole === 'developer';
  const taxonomyReadOnly = developerReadOnly;

  useEffect(() => {
    if (applicationId == null && settings.applications[0]) setApplicationId(settings.applications[0].id);
    if ((moduleId == null || !moduleOptions.some((module) => module.value === moduleId)) && moduleOptions[0]) setModuleId(moduleOptions[0].value);
    if (moduleId != null && !moduleOptions.length) setModuleId(null);
    if (environmentId == null && settings.environments[0]) setEnvironmentId(settings.environments[0].id);
    if (userRoleId == null && settings.userRoles[0]) setUserRoleId(settings.userRoles[0].id);
  }, [applicationId, moduleId, environmentId, userRoleId, moduleOptions, settings.applications, settings.environments, settings.userRoles]);

  useEffect(() => {
    if (selectedPresetId != null && !presetOptions.some((preset) => preset.id === selectedPresetId)) setSelectedPresetId(null);
  }, [presetOptions, selectedPresetId]);

  useEffect(() => {
    setTimeout(() => noteRef.current?.focus(), 50);
  }, [focusToken]);

  useEffect(() => {
    let mounted = true;
    const loadPendingReview = async (): Promise<void> => {
      const pending = String((await window.bugPocket.getPendingQuickScreenshot()) || '');
      if (!mounted || !pending) return;
      setReviewScreenshot(pending);
      await window.bugPocket.expandQuickCaptureForReview();
    };
    void loadPendingReview();
    const unsubscribe = window.bugPocket.onQuickScreenshotReviewReady(() => {
      void loadPendingReview();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (reviewScreenshot) {
      wasReviewingScreenshotRef.current = true;
      return;
    }
    if (!wasReviewingScreenshotRef.current) return;
    wasReviewingScreenshotRef.current = false;
    void window.bugPocket.restoreQuickCaptureCompact();
    window.setTimeout(() => void window.bugPocket.restoreQuickCaptureCompact(), 100);
  }, [reviewScreenshot]);

  const applyPreset = (preset: CapturePreset): void => {
    setPresetNotice('');
    setSelectedPresetId(preset.id);
    setApplicationId(preset.application_id);
    setModuleId(preset.module_id);
    setEnvironmentId(preset.environment_id);
    setUserRoleId(preset.user_role_id);
    window.setTimeout(() => noteRef.current?.focus(), 0);
  };

  const showUnassignedPresetNotice = (index: number): void => {
    if (presetNoticeTimerRef.current) window.clearTimeout(presetNoticeTimerRef.current);
    setPresetNotice(`No preset assigned to ${quickPanelShortcuts.presets[index]}. Click the slot to configure one.`);
    presetNoticeTimerRef.current = window.setTimeout(() => {
      setPresetNotice('');
      presetNoticeTimerRef.current = null;
    }, 2600);
  };

  const save = async (): Promise<void> => {
    if (developerReadOnly || !note.trim()) return;
    await onSave({ applicationId, moduleId, environmentId, userRoleId, note });
    setNote('');
  };

  const takeScreenshot = (): void => {
    if (developerReadOnly) return;
    screenshotButtonRef.current?.focus();
    void onTakeScreenshot();
  };

  const attachReviewedScreenshot = async (dataUrl: string): Promise<void> => {
    if (developerReadOnly) return;
    await window.bugPocket.attachPendingQuickScreenshot(dataUrl);
    setReviewScreenshot('');
    await window.bugPocket.restoreQuickCaptureCompact();
    window.setTimeout(() => void window.bugPocket.restoreQuickCaptureCompact(), 100);
    window.setTimeout(() => {
      quickWindowRef.current?.focus();
      noteRef.current?.focus();
    }, 40);
  };

  const discardReviewedScreenshot = async (): Promise<void> => {
    setReviewScreenshot('');
    await window.bugPocket.discardPendingQuickScreenshot();
    await window.bugPocket.restoreQuickCaptureCompact();
    window.setTimeout(() => void window.bugPocket.restoreQuickCaptureCompact(), 100);
    window.setTimeout(() => {
      quickWindowRef.current?.focus();
      noteRef.current?.focus();
    }, 40);
  };

  const openPresetSettings = (): void => {
    void onConfigurePresets();
  };

  const attachReviewedScreenshotFromHeader = (): void => {
    void screenshotAnnotatorRef.current?.save();
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (reviewScreenshot) {
      if (event.key === 'Escape') {
        event.preventDefault();
        void discardReviewedScreenshot();
      }
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (/^[1-3]$/.test(event.key)) {
        event.preventDefault();
        const presetIndex = Number(event.key) - 1;
        const preset = presetOptions[presetIndex];
        if (preset) applyPreset(preset);
        else showUnassignedPresetNotice(presetIndex);
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'a':
          event.preventDefault();
          applicationRef.current?.focus();
          return;
        case 'm':
          event.preventDefault();
          moduleRef.current?.focus();
          return;
        case 'e':
          event.preventDefault();
          environmentRef.current?.focus();
          return;
        case 'r':
          event.preventDefault();
          userRoleRef.current?.focus();
          return;
        case 'n':
          event.preventDefault();
          noteRef.current?.focus();
          return;
        case 's':
          event.preventDefault();
          takeScreenshot();
          return;
      }
    }

    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      if (!saving && note.trim()) void save();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      void onCancel();
    }
  };

  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const root = quickWindowRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (root && target && root.contains(target)) return;
      event.preventDefault();
      if (reviewScreenshot) void discardReviewedScreenshot();
      else void onCancel();
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [reviewScreenshot, onCancel]);

  return (
    <div ref={quickWindowRef} tabIndex={-1} className={reviewScreenshot ? 'quick-window review-mode' : 'quick-window'} onKeyDown={handlePanelKeyDown}>
      <header className="quick-header">
        <div className="quick-brand-patch">
          <BrandMark className="quick-logo" />
          <div className="quick-brand-text">
            <span className="quick-title-logo" aria-hidden="true">Bug Pocket</span>
            <p>Quick Capture</p>
          </div>
        </div>
        {!reviewScreenshot && <span className="quick-cancel-hint"><kbd>{quickPanelShortcuts.cancel}</kbd> Cancel</span>}
      </header>
      {reviewScreenshot ? (
        <section className="quick-inline-review" aria-label="Review screenshot before attaching">
          <div className="quick-inline-review-heading">
            <div>
              <h2>Review Screenshot</h2>
              <p>Annotate this snip, then attach it to the current draft.</p>
            </div>
            <div className="quick-review-actions">
              <button className="quick-review-discard" type="button" onClick={() => void discardReviewedScreenshot()}>Discard</button>
              <button className="quick-review-attach" type="button" disabled={developerReadOnly} onClick={attachReviewedScreenshotFromHeader}>Attach</button>
            </div>
          </div>
          <ScreenshotAnnotator
            ref={screenshotAnnotatorRef}
            imageDataUrl={reviewScreenshot}
            fileName="Quick Panel screenshot"
            showSaveButton={false}
            onSave={attachReviewedScreenshot}
          />
        </section>
      ) : (
        <>
          <div className="quick-field-grid">
        <div className="quick-preset-section">
          <span className="quick-label-row">Presets</span>
          {presetNotice && <div className="quick-preset-notice" role="status">{presetNotice}</div>}
          <div className="quick-preset-slots" aria-label="Quick capture presets">
            {[0, 1, 2].map((index) => {
              const preset = presetOptions[index];
              return (
                <div className="quick-preset-item" key={preset?.id ?? `empty-${index}`}>
                  <kbd>{quickPanelShortcuts.presets[index]}</kbd>
                  {preset ? (
                    <button
                      className={selectedPresetId === preset.id ? 'quick-preset-slot active' : 'quick-preset-slot'}
                      title={`Apply ${preset.name} (${quickPanelShortcuts.presets[index]})`}
                      type="button"
                      onClick={() => applyPreset(preset)}
                    >
                      <span>{preset.name}</span>
                    </button>
                  ) : (
                    <button
                      className="quick-preset-slot empty"
                      title="Configure Quick Capture presets"
                      type="button"
                      onClick={openPresetSettings}
                    >
                      <span>[+] Unassigned</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <QuickSearchSelect
          ref={applicationRef}
          label="Application"
          shortcut={quickPanelShortcuts.application}
          value={applicationId}
          options={applicationOptions}
          onChange={(value) => { setSelectedPresetId(null); setApplicationId(value); }}
          onCreate={taxonomyReadOnly ? undefined : onCreateApplication}
        />
        <QuickSearchSelect
          ref={moduleRef}
          label="Module"
          shortcut={quickPanelShortcuts.module}
          value={moduleId}
          options={moduleOptions}
          onChange={(value) => { setSelectedPresetId(null); setModuleId(value); }}
          onCreate={taxonomyReadOnly ? undefined : (name) => onCreateModule(name, applicationId)}
        />
        <QuickSearchSelect
          ref={environmentRef}
          label="Environment"
          shortcut={quickPanelShortcuts.environment}
          value={environmentId}
          options={environmentOptions}
          onChange={(value) => { setSelectedPresetId(null); setEnvironmentId(value); }}
          onCreate={taxonomyReadOnly ? undefined : onCreateEnvironment}
        />
        <QuickSearchSelect
          ref={userRoleRef}
          label="User Role"
          shortcut={quickPanelShortcuts.userRole}
          value={userRoleId}
          options={userRoleOptions}
          onChange={(value) => { setSelectedPresetId(null); setUserRoleId(value); }}
          onCreate={taxonomyReadOnly ? undefined : onCreateUserRole}
        />
          </div>
          <label className="grow">
            <span className="quick-label-row">Bug Note <kbd>{quickPanelShortcuts.note}</kbd></span>
            <textarea ref={noteRef} value={note} disabled={developerReadOnly} onChange={(event) => setNote(event.target.value)} placeholder="Short note. Clean it up later." />
          </label>
          {developerReadOnly && <p className="quick-read-only-notice">Developer access is read-only. Captures and taxonomy changes are disabled.</p>}
          {attachments.length > 0 && <div className="attachment-strip">{attachments.length} screenshot attached</div>}
          <div className="quick-actions">
            <div className="quick-action-item">
              <button className="screenshot-button" ref={screenshotButtonRef} disabled={developerReadOnly} title={developerReadOnly ? 'Developer access is read-only' : 'Take screenshot (Alt+S)'} onClick={takeScreenshot}><Camera size={16} /> Screenshot</button>
              <span className="button-shortcut"><kbd>{quickPanelShortcuts.screenshot}</kbd></span>
            </div>
            <div className="quick-action-item">
              <button className="primary" disabled={developerReadOnly || !note.trim() || saving} onClick={save}><Save size={17} /> Save</button>
              <span className="button-shortcut"><kbd>{quickPanelShortcuts.save}</kbd></span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type QuickSelectValue = string | number | null;

interface QuickSelectOption {
  key: string;
  value: QuickSelectValue;
  label: string;
}

interface QuickSearchSelectProps {
  label: string;
  shortcut?: string;
  value: QuickSelectValue;
  options: QuickSelectOption[];
  onChange: (value: QuickSelectValue) => void;
  onCreate?: (label: string) => Promise<QuickSelectValue>;
}

const QuickSearchSelect = forwardRef<HTMLInputElement, QuickSearchSelectProps>(
  ({ label, shortcut, value, options, onChange, onCreate }, forwardedRef) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
    const [open, setOpen] = useState(false);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const selected = options.find((option) => option.value === value) ?? options[0] ?? null;
    const cleanedQuery = query.trim();
    const filteredOptions = useMemo(() => {
      const needle = searching ? cleanedQuery.toLowerCase() : '';
      if (!needle) return options;
      return options.filter((option) => option.label.toLowerCase().includes(needle));
    }, [options, cleanedQuery, searching]);
    const canCreate =
      Boolean(onCreate && searching && cleanedQuery) &&
      !options.some((option) => option.label.trim().toLowerCase() === cleanedQuery.toLowerCase());
    const createIndex = filteredOptions.length;
    const optionCount = filteredOptions.length + (canCreate ? 1 : 0);

    useEffect(() => {
      setHighlightedIndex(0);
    }, [query, options]);

    useEffect(() => {
      if (!open) {
        setQuery('');
        setSearching(false);
      }
    }, [open, value]);

    useEffect(() => {
      if (!open) return;
      const updatePosition = (): void => {
        const rect = inputRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenuStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          maxHeight: 122
        });
      };
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [open, filteredOptions.length, canCreate]);

    const choose = (option: QuickSelectOption): void => {
      onChange(option.value);
      setCreateError('');
      setQuery('');
      setSearching(false);
      setOpen(false);
      inputRef.current?.focus();
    };

    const create = async (): Promise<void> => {
      if (!onCreate || !cleanedQuery || creating) return;
      setCreating(true);
      setCreateError('');
      try {
        const createdValue = await onCreate(cleanedQuery);
        onChange(createdValue);
        setQuery('');
        setSearching(false);
        setOpen(false);
        inputRef.current?.focus();
      } catch (caught) {
        setCreateError(quickPanelErrorMessage(caught));
        setOpen(true);
        inputRef.current?.focus();
      } finally {
        setCreating(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setSearching(false);
        setQuery('');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
        setHighlightedIndex((current) => Math.min(current + 1, Math.max(optionCount - 1, 0)));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
        setHighlightedIndex((current) => Math.max(current - 1, 0));
      }
      if (event.key === 'Enter' && open) {
        event.preventDefault();
        const option = filteredOptions[highlightedIndex];
        if (option) {
          choose(option);
          return;
        }
        if (canCreate && highlightedIndex === createIndex) void create();
      }
    };

    return (
      <label className={open ? 'quick-select open' : 'quick-select'}>
        <span className="quick-label-row">{label} {shortcut ? <kbd>{shortcut}</kbd> : null}</span>
        <div className="quick-combo">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={open && searching ? query : selected?.label ?? ''}
            placeholder={options.length ? `Search ${label.toLowerCase()}` : `No ${label.toLowerCase()} configured`}
            onFocus={() => {
              setOpen(true);
              setSearching(false);
              setQuery('');
              setCreateError('');
              window.setTimeout(() => inputRef.current?.select(), 0);
            }}
            onChange={(event) => {
              setSearching(true);
              setQuery(event.target.value);
              setCreateError('');
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          />
          {open && createPortal(
            <div className="quick-options" role="listbox" style={menuStyle}>
              {filteredOptions.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={index === highlightedIndex ? 'quick-option highlighted' : 'quick-option'}
                  key={option.key}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              ))}
              {canCreate && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={highlightedIndex === createIndex ? 'quick-option create-option highlighted' : 'quick-option create-option'}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(createIndex)}
                  onClick={() => void create()}
                  disabled={creating}
                >
                  <Plus size={14} /> {creating ? 'Adding...' : `Add "${cleanedQuery}"`}
                </button>
              )}
              {!filteredOptions.length && !canCreate && <div className="quick-option empty-option">No matches</div>}
            </div>,
            document.body
          )}
        </div>
        {createError && <small className="quick-select-error" role="alert">{createError}</small>}
      </label>
    );
  }
);

QuickSearchSelect.displayName = 'QuickSearchSelect';
