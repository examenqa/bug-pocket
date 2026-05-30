export function isModifierOnlyKey(key: string): boolean {
  return ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS'].includes(key);
}

function normalizeShortcutKey(key: string, code = ''): string {
  if (isModifierOnlyKey(key)) return '';
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  const letterCode = code.match(/^Key([A-Z])$/);
  if (letterCode) return letterCode[1];
  const digitCode = code.match(/^Digit([0-9])$/);
  if (digitCode) return digitCode[1];
  const numpadCode = code.match(/^Numpad([0-9])$/);
  if (numpadCode) return `num${numpadCode[1]}`;
  const aliases: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  };
  return aliases[key] ?? '';
}

export function eventToAccelerator(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const key = normalizeShortcutKey(event.key, event.code);
  if (!key || !modifiers.length) return '';
  return [...modifiers, key].join('+');
}
