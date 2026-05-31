export function formatStepsAsNumberedList(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => cleanStepLine(line))
    .filter(Boolean);

  if (lines.length > 1) return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');

  const sentenceSteps = splitSingleLineSteps(lines[0] ?? normalized);
  if (sentenceSteps.length > 1) return sentenceSteps.map((line, index) => `${index + 1}. ${line}`).join('\n');

  return lines[0] ?? normalized;
}

function cleanStepLine(value: string): string {
  return value
    .trim()
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
    .trim();
}

function splitSingleLineSteps(value: string): string[] {
  return value
    .split(/\s*(?:>|=>|;|\bthen\b)\s*/i)
    .map((part) => cleanStepLine(part))
    .filter((part) => part.length > 0);
}
