const issuePrefixPattern = /^[A-Z0-9]{2,8}$/;
const issueUserCodePattern = /^[A-Z0-9]{3}$/;

export function deriveIssuePrefix(applicationName: string): string {
  const normalized = applicationName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (normalized.slice(0, 3) || 'BUG').padEnd(3, 'X');
}

export function normalizeIssuePrefix(value: string, applicationName = ''): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = normalized || deriveIssuePrefix(applicationName);
  if (!issuePrefixPattern.test(prefix)) {
    throw new Error('Application prefix must contain 2 to 8 letters or numbers.');
  }
  return prefix;
}

export function normalizeIssueUserCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!issueUserCodePattern.test(normalized)) {
    throw new Error('User code must be exactly 3 letters or numbers.');
  }
  return normalized;
}

export function formatIssueKey(prefix: string, issueNumber: number, userCode?: string | null): string {
  const normalizedPrefix = normalizeIssuePrefix(prefix);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new Error('Issue number must be a positive integer.');
  }
  const normalizedUserCode = userCode ? normalizeIssueUserCode(userCode) : '';
  return normalizedUserCode
    ? `${normalizedPrefix}-${normalizedUserCode}-${issueNumber}`
    : `${normalizedPrefix}-${issueNumber}`;
}

export function isIssueUserCode(value: unknown): value is string {
  return typeof value === 'string' && issueUserCodePattern.test(value.trim().toUpperCase());
}
