import type { TaxonomyId } from '../../../shared/types';

interface TaxonomyOption {
  id: TaxonomyId;
}

/** Restores the original ID type after an HTML select emits its string value. */
export function resolveTaxonomyId(rawValue: string, options: readonly TaxonomyOption[]): TaxonomyId | null {
  if (!rawValue) return null;
  return options.find((option) => String(option.id) === rawValue)?.id ?? rawValue;
}
