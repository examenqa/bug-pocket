import type { BugFilters, Module, SettingsData } from '../../../shared/types';

export function getModulesForApplication(settings: SettingsData, applicationId: number | null, currentModuleId?: number | null): Module[] {
  const modules = settings.modules.filter((module) => (applicationId ? module.application_id === applicationId : true));
  if (currentModuleId && !modules.some((module) => module.id === currentModuleId)) {
    const currentModule = settings.modules.find((module) => module.id === currentModuleId);
    if (currentModule) return [...modules, currentModule];
  }
  return modules;
}

export function getActiveFilterChips(filters: BugFilters, settings: SettingsData): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = [];
  if (filters.entryType && filters.entryType !== 'all') chips.push({ label: 'Type', value: filters.entryType });
  if (filters.applicationId && filters.applicationId !== 'all') chips.push({ label: 'App', value: settings.applications.find((item) => item.id === filters.applicationId)?.name ?? String(filters.applicationId) });
  if (filters.moduleId && filters.moduleId !== 'all') chips.push({ label: 'Module', value: settings.modules.find((item) => item.id === filters.moduleId)?.name ?? String(filters.moduleId) });
  if (filters.environmentId && filters.environmentId !== 'all') chips.push({ label: 'Env', value: settings.environments.find((item) => item.id === filters.environmentId)?.value ?? String(filters.environmentId) });
  if (filters.status && filters.status !== 'all') chips.push({ label: 'Status', value: filters.status });
  if (filters.severity && filters.severity !== 'all') chips.push({ label: 'Severity', value: filters.severity });
  if (filters.syncStatus && filters.syncStatus !== 'all') chips.push({ label: 'Sync', value: filters.syncStatus });
  if (filters.reported && filters.reported !== 'all') chips.push({ label: 'Reported', value: filters.reported === 'reported' ? 'Yes' : 'No' });
  return chips;
}
