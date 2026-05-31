import React from 'react';

export function Select({
  label,
  value,
  onChange,
  children,
  disabled = false
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="compact-select">
      {label}
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
