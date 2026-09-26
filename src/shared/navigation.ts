export const DASHBOARD_ROUTE = '/dashboard';

export function bugDetailsRoute(id: number): string {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Bug ID must be a positive integer.');
  return `/bugs/${id}`;
}

export type MainShellRouteState =
  | { view: 'dashboard'; bugId: null }
  | { view: 'bug'; bugId: number }
  | { view: 'settings'; bugId: null }
  | { view: 'unknown'; bugId: null };

export function resolveMainShellRoute(route: string): MainShellRouteState {
  if (route === DASHBOARD_ROUTE) return { view: 'dashboard', bugId: null };
  const bugMatch = route.match(/^\/bugs\/(\d+)$/);
  if (bugMatch) return { view: 'bug', bugId: Number(bugMatch[1]) };
  if (route.startsWith('/settings')) return { view: 'settings', bugId: null };
  return { view: 'unknown', bugId: null };
}
