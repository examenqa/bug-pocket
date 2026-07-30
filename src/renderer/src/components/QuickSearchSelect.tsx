import { Plus } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent } from 'react';

function quickPanelErrorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  if (typeof caught === 'string' && caught.trim()) return caught;
  return 'Could not create this item.';
}
export type QuickSelectValue = string | number | null;

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

export const QuickSearchSelect = forwardRef<HTMLInputElement, QuickSearchSelectProps>(
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
