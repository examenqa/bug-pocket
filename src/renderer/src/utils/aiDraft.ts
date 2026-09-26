import type { BugDetails } from '../../../shared/types';
import { AiCancelledError } from '../../../shared/aiRequest';
import { formatStepsAsNumberedList } from './formatSteps';

export const AI_FIELDS = ['title', 'note', 'steps_to_reproduce', 'expected_result', 'actual_result'] as const;
export type AiField = typeof AI_FIELDS[number];
export type AiFieldVersions = Partial<Record<AiField, number>>;
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n').trim() : '';
}
export function aiPatch(raw: string, base: BugDetails): Partial<Pick<BugDetails, AiField>> {
  try {
    const data = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    const patch: Partial<Pick<BugDetails, AiField>> = {};
    for (const [key, field] of Object.entries({title:'title',bugNote:'note',stepsToReproduce:'steps_to_reproduce',expectedResult:'expected_result',actualResult:'actual_result'}) as Array<[string,AiField]>) {
      const value = text(data?.[key]);
      if (value) patch[field] = field === 'steps_to_reproduce' ? formatStepsAsNumberedList(value) : value;
    }
    return patch;
  } catch {
    return { note: [base.note.trim(), raw.trim()].filter(Boolean).join('\n\n') };
  }
}
export function mergeAiPatch(base: BugDetails, current: BugDetails, patch: Partial<Pick<BugDetails, AiField>>, started: AiFieldVersions, versions: AiFieldVersions): { bug: BugDetails; conflicts: AiField[]; changed: boolean } {
  if (base.id !== current.id) return { bug: current, conflicts: [], changed: false };
  const next = { ...current }, conflicts: AiField[] = [];
  let changed = false;
  for (const field of AI_FIELDS) {
    if (patch[field] === undefined) continue;
    if (base[field] !== current[field] || (started[field] ?? 0) !== (versions[field] ?? 0)) { conflicts.push(field); continue; }
    if (next[field] !== patch[field]) { next[field] = patch[field]!; changed = true; }
  }
  return { bug: changed ? next : current, conflicts, changed };
}

export class LatestAiRequest {
  private current: { id: string; controller: AbortController } | null = null;
  constructor(private cancelRemote: (id: string) => void) {}
  start() {
    this.cancel();
    const request = { id: crypto.randomUUID(), controller: new AbortController() };
    this.current = request;
    return request;
  }
  isCurrent(request: { id: string }): boolean { return this.current?.id === request.id && !this.current.controller.signal.aborted; }
  cancel(): void {
    const old = this.current; this.current = null;
    if (old) { old.controller.abort(new AiCancelledError()); this.cancelRemote(old.id); }
  }
}
