import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface PillDropdownOption {
  value: string;
  label: string;
}

export function PillDropdown({
  label,
  value,
  options,
  colorClass,
  onChange,
  disabled = false
}: {
  label: string;
  value: string;
  options: PillDropdownOption[];
  colorClass: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const visibleOptions = options.length ? options : [{ value, label: value || 'Unset' }];
  const selectedLabel = visibleOptions.find((option) => option.value === value)?.label ?? value ?? 'Unset';
  const longestLabelLength = Math.max(...visibleOptions.map((option) => option.label.length), selectedLabel.length, label.length);
  const pillWidth = `calc(${longestLabelLength}ch + 46px)`;

  useEffect(() => {
    if (!open) return;
    const updatePosition = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        minWidth: rect.width
      });
    };
    const closeOnOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    updatePosition();
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="pill-dropdown">
      <span>{label}</span>
      <button
        ref={buttonRef}
        className={`state-pill ${colorClass}`}
        style={{ width: pillWidth }}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        {selectedLabel}
        <ChevronDown size={14} />
      </button>
      {open && createPortal(
        <div className="pill-dropdown-menu" role="listbox" ref={menuRef} style={menuStyle}>
          {visibleOptions.map((option) => (
            <button
              key={`${label}-${option.value}`}
              className={option.value === value ? 'active' : ''}
              role="option"
              aria-selected={option.value === value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
