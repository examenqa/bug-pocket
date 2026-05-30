import React from 'react';
import type { ConfigOption, ReferenceOption } from '../../../../shared/types';
import { fallbackOption } from '../../utils/display';

export function OptionSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: ConfigOption[];
  onChange: (value: string) => void;
}) {
  const visibleOptions = options.length ? options : [fallbackOption(value || 'Bug')];
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {visibleOptions.map((option) => (
          <option key={`${option.type}-${option.id}-${option.value}`} value={option.value}>
            {option.value}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReferenceSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: number | null;
  options: ReferenceOption[];
  onChange: (value: number | null) => void;
}) {
  return (
    <label>
      {label}
      <select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value) || null)}>
        <option value="">No {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.value}
          </option>
        ))}
      </select>
    </label>
  );
}
