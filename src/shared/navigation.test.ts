import assert from 'node:assert/strict';
import test from 'node:test';
import { bugDetailsRoute, DASHBOARD_ROUTE, resolveMainShellRoute } from './navigation';

test('Ctrl+Alt+M navigation clears an open report by returning to the dashboard route', () => {
  const openReport = resolveMainShellRoute(bugDetailsRoute(42));
  assert.deepEqual(openReport, { view: 'bug', bugId: 42 });

  const afterMainPanelShortcut = resolveMainShellRoute(DASHBOARD_ROUTE);
  assert.deepEqual(afterMainPanelShortcut, { view: 'dashboard', bugId: null });
});

test('the dashboard list is rendered only for the exact dashboard route', () => {
  assert.equal(resolveMainShellRoute('/dashboard?bug=42').view, 'unknown');
  assert.equal(resolveMainShellRoute('/bugs/42').view, 'bug');
  assert.equal(resolveMainShellRoute('/dashboard').view, 'dashboard');
});
