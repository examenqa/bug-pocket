import type { Bug, CaptureStatus, ConfigOption, ShortcutSetting, SyncStatus } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Sync & severity class helpers
// ---------------------------------------------------------------------------

export function syncClass(status: SyncStatus): string {
  if (status === 'Synced') return 'synced';
  if (status === 'Sync Pending') return 'pending';
  if (status === 'Sync Failed') return 'failed';
  return 'local';
}

export function severityClass(value: string): string {
  return (value || 'medium').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function severityPillClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'critical') return 'severity-critical';
  if (normalized === 'high') return 'severity-high';
  if (normalized === 'medium') return 'severity-medium';
  return 'severity-low';
}

export function statusPillClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'reported') return 'status-reported';
  if (normalized === 'discarded') return 'status-muted';
  return 'status-new';
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatTableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit' }).format(new Date(value));
}

// ---------------------------------------------------------------------------
// Entry title / preview derivation
// ---------------------------------------------------------------------------

export function normalizeEntryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizedCompare(value: string): string {
  return normalizeEntryText(value).toLowerCase();
}

function getLegacyGeneratedTitle(note: string): string {
  const firstLine = note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Untitled bug';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function deriveEntryTitle(note: string): string {
  const normalized = normalizeEntryText(note);
  if (!normalized) return 'Untitled entry';

  const colonIndex = normalized.indexOf(':');
  if (colonIndex > -1) {
    const beforeColon = normalized.slice(0, colonIndex).trim();
    if (beforeColon.length >= 6 && beforeColon.length <= 80) return beforeColon;
  }

  const sentence = normalized.match(/^(.{12,90}?[.!?])(?:\s|$)/)?.[1]?.trim();
  if (sentence) return sentence.replace(/[.!?]+$/, '');

  const words = normalized.split(/\s+/).slice(0, 8).join(' ');
  if (!words) return 'Untitled entry';
  return words.length > 70 ? `${words.slice(0, 67).trimEnd()}...` : words;
}

function removeTitlePrefix(note: string, title: string): string {
  const lowerNote = note.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (!lowerNote.startsWith(lowerTitle)) return note;
  return note
    .slice(title.length)
    .replace(/^\s*[:.!?-]\s*/, '')
    .trim();
}

function deriveEntryPreview(note: string, title: string): string {
  const normalized = normalizeEntryText(note);
  const cleanedTitle = normalizeEntryText(title);
  if (!normalized || normalizedCompare(normalized) === normalizedCompare(cleanedTitle)) return '';

  const withoutPrefix = removeTitlePrefix(normalized, cleanedTitle);
  if (!withoutPrefix || normalizedCompare(withoutPrefix) === normalizedCompare(cleanedTitle)) return '';
  return withoutPrefix;
}

export function getEntryDisplay(bug: Bug): { title: string; preview: string; isDerived: boolean } {
  const note = normalizeEntryText(bug.note);
  const savedTitle = normalizeEntryText(bug.title);
  const oldGeneratedTitle = getLegacyGeneratedTitle(bug.note);
  const isDerived =
    !savedTitle ||
    savedTitle === 'Untitled bug' ||
    normalizedCompare(savedTitle) === normalizedCompare(note) ||
    normalizedCompare(savedTitle) === normalizedCompare(oldGeneratedTitle);
  const title = isDerived ? deriveEntryTitle(bug.note) : savedTitle;
  return { title, preview: deriveEntryPreview(bug.note, title), isDerived };
}

// ---------------------------------------------------------------------------
// Shortcut display
// ---------------------------------------------------------------------------

export function shortcutDisplay(shortcut: ShortcutSetting | undefined, fallback = 'Not set'): string {
  if (!shortcut?.accelerator) return fallback;
  return shortcut.accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, '+');
}

// ---------------------------------------------------------------------------
// Config option helpers
// ---------------------------------------------------------------------------

export const syncStatuses: SyncStatus[] = ['Local Only', 'Sync Pending', 'Synced', 'Sync Failed'];

export const captureStatusOptions: ConfigOption[] = (['Draft', 'Reported', 'Discarded'] as CaptureStatus[]).map(
  (value, index) => ({ id: index + 1, type: 'status', value, sort_order: index, is_active: 1 })
);

export function fallbackOption(value: string): ConfigOption {
  return { id: 0, type: 'entry_type', value, sort_order: 0, is_active: 1 };
}

export function uniqueOptions(options: ConfigOption[]): ConfigOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

export function statusOptionsForEntryType(_entryType: string, _settings: unknown): ConfigOption[] {
  return captureStatusOptions;
}

export function getWorkflowStatusOptions(statusOptions: ConfigOption[], currentStatus: string): ConfigOption[] {
  const current = statusOptions.find((status) => status.value === currentStatus);
  return current ? statusOptions : captureStatusOptions;
}
