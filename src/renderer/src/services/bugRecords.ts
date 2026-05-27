import type { Bug, QuickBugInput } from '../../../shared/types';

export async function createQuickBugRecord(input: QuickBugInput): Promise<Bug> {
  return window.bugPocket.createQuickBug(input);
}
