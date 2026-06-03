import type { BugDetails, ReportTemplate } from '../../../shared/types';
import { formatStepsAsNumberedList } from '../utils/formatSteps';

export type IssuePlatformLink = 'Linear' | 'Jira';

interface IssueDeepLinkOptions {
  jiraWorkspaceUrl?: string | null;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function generateReport(bug: BugDetails, template?: ReportTemplate): string {
  const attachments = bug.attachments.length ? `${bug.attachments.length} attachment${bug.attachments.length === 1 ? '' : 's'} included in Bug Pocket.` : '[No attachments]';
  const values: Record<string, string> = {
    title: bug.title || bug.note.split(/\r?\n/)[0] || 'Untitled bug',
    entry_type: bug.entry_type || 'Bug',
    note: bug.note || '[No summary provided]',
    application: bug.application_name || '',
    module: bug.module_name || '',
    environment: bug.environment || '',
    device: bug.device || '',
    browser: bug.browser || '',
    user_role: bug.user_role || '',
    steps: formatStepsAsNumberedList(bug.steps_to_reproduce) || '[Add steps to reproduce]',
    expected: bug.expected_result || '[Add expected result]',
    actual: bug.actual_result || bug.note || '[Add actual result]',
    status: bug.status,
    severity: bug.severity,
    reported: bug.reported ? 'Yes' : 'No',
    issue_id: bug.issue_id || '[Not reported yet]',
    attachments
  };

  return (template?.template_text ?? '').replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? '');
}

export function buildIssueDeepLink(platform: IssuePlatformLink, bug: BugDetails, body: string, options: IssueDeepLinkOptions = {}): string | null {
  const title = bug.title || bug.note.split(/\r?\n/)[0] || 'Untitled bug';
  const environmentLine = bug.environment ? `Environment: ${bug.environment}` : 'Environment: Not specified';
  const description = [body || bug.note, '', environmentLine].filter(Boolean).join('\n');

  if (platform === 'Linear') {
    const params = new URLSearchParams({ title, description });
    return `https://linear.new?${params.toString()}`;
  }

  const jiraBaseUrl = getJiraBaseUrl(bug.issue_url) ?? getJiraBaseUrl(options.jiraWorkspaceUrl ?? '');
  if (!jiraBaseUrl) return null;
  const params = new URLSearchParams({ summary: title, description });
  return `${jiraBaseUrl}/secure/CreateIssueDetails!init.jspa?${params.toString()}`;
}

function getJiraBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostnameParts = url.hostname.split('.');

    // Matches standard Atlassian Cloud instances (e.g. mycompany.atlassian.net)
    const isAtlassianCloud = url.hostname.endsWith('.atlassian.net');

    // Matches exact segments like 'jira.company.com', preventing 'attacker-jira.com'
    const isSelfHostedJira = hostnameParts.includes('jira');

    if (!isAtlassianCloud && !isSelfHostedJira) return null;

    return url.origin;
  } catch {
    return null; // Fails safely if the URL is completely malformed or empty
  }
}



