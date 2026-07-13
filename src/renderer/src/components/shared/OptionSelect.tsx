import React from 'react';
import type { ConfigOption, ReferenceOption, TaxonomyId } from '../../../../shared/types';
import { fallbackOption } from '../../utils/display';
import { resolveTaxonomyId } from '../../utils/taxonomyIds';

export function OptionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false
}: {
  label: string;
  value: string;
  options: ConfigOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const visibleOptions = options.length ? options : [fallbackOption(value || 'Bug')];
  return (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
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
  onChange,
  disabled = false
}: {
  label: string;
  value: TaxonomyId | null;
  options: ReferenceOption[];
  onChange: (value: TaxonomyId | null) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <select value={value ?? ''} disabled={disabled} onChange={(event) => onChange(resolveTaxonomyId(event.target.value, options))}>
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
