import type { BugDetails, BugUpdateInput } from '../../../shared/types';
import { getEntryDisplay } from './display';

export type DetailsSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type AiTriageStatus = 'idle' | 'loading' | 'completed';

export function buildBugUpdateInput(bug: BugDetails): BugUpdateInput {
  const entryDisplay = getEntryDisplay(bug);
  const title = entryDisplay.isDerived ? entryDisplay.title : bug.title;
  return {
    entry_type: bug.entry_type || 'Bug',
    application_id: bug.application_id,
    module_id: bug.module_id,
    environment_id: bug.environment_id,
    device_id: bug.device_id,
    browser_id: bug.browser_id,
    user_role_id: bug.user_role_id,
    title,
    note: bug.note,
    other_details: bug.other_details,
    steps_to_reproduce: bug.steps_to_reproduce,
    expected_result: bug.expected_result,
    actual_result: bug.actual_result,
    status: bug.status,
    severity: bug.severity,
    reported: !!bug.reported,
    issue_platform: bug.issue_platform,
    issue_id: bug.issue_id,
    issue_url: bug.issue_url,
    tags: bug.tags
  };
}

export function serializeBugUpdateInput(input: BugUpdateInput): string {
  return JSON.stringify(input);
}
