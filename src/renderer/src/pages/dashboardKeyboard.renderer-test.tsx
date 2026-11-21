import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { SettingsData } from '../../../shared/types';
import { Dashboard } from './DashboardPage';
import '../styles.css';

type TestInput = 'Tab' | 'Enter' | 'Space' | { x: number; y: number };

declare global {
  interface Window {
    dashboardKeyboardSteps: AsyncGenerator<TestInput>;
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForElement(parent: Element, selector: string): Promise<Element> {
  const deadline = performance.now() + 5000;
  do {
    const element = parent.querySelector(selector);
    if (element) return element;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${selector}`);
}

function clickPosition(element: Element) {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Each yield lets Chromium deliver native input before the next assertion.
async function* checkDashboard(): AsyncGenerator<TestInput> {
  const opened: number[] = [];
  const previewed: number[] = [];
  const bug = {
    id: 42, issue_key: '', title: 'Keyboard sample', note: '', status: 'Draft',
    severity: 'Medium', created_at: '2026-11-20T12:00:00Z', attachment_count: 1
  };
  const settings = {
    currentWorkspaceCanWrite: false, shortcuts: [], applications: [], modules: [],
    environments: [], entryTypes: [], severities: []
  } as unknown as SettingsData;
  window.bugPocket = {
    listBugs: async () => [bug],
    getBugStatusCounts: async () => ({ total: 1, draft: 1, reported: 0, discarded: 0 }),
    onBugsChanged: () => () => {},
    getAttachmentLineage: async () => [],
    getAttachmentPreview: async () => document.createElement('canvas').toDataURL('image/png'),
    getBug: async (id: number) => {
      previewed.push(id);
      return { ...bug, attachments: [{ id: 7, file_name: 'sample.png' }] };
    }
  } as unknown as typeof window.bugPocket;
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    root.render(<Dashboard settings={settings} onSelect={id => opened.push(id)} />);
    const preview = await waitForElement(container, 'button[aria-label="Preview 1 attachment"]');
    const row = preview.closest('tr');
    const open = row?.querySelector('button[aria-label="Open report BUG-42: Keyboard sample"]');
    check(row && open instanceof HTMLButtonElement && preview instanceof HTMLButtonElement, 'Missing native report or preview button');
    check(open.type === 'button' && !open.disabled && open.tabIndex === 0, 'Report button must be tabbable');
    check(!row.matches('[role=button], [tabindex]') && !row.querySelector('button button'), 'Row controls must be independent');

    container.querySelector<HTMLButtonElement>('.filter-toggle')!.focus();
    yield 'Tab';
    check(document.activeElement === open, 'Tab must reach the report button');
    yield 'Enter';
    check(opened.join() === '42', 'Enter must open the report once');
    yield 'Space';
    check(opened.join() === '42,42', 'Space must open the report once');

    const metadata = row.querySelectorAll<HTMLElement>('[data-tooltip]');
    check(metadata.length === 3, 'Expected severity, sync and creation time');
    for (const item of metadata) {
      yield 'Tab';
      check(document.activeElement === item, 'Tab must reach each metadata tooltip');
      yield 'Enter';
      yield clickPosition(item);
    }
    yield 'Tab';
    check(document.activeElement === preview, 'Tab must reach the separate attachment button');
    yield 'Space';
    await waitForElement(container, '[role=dialog] img[alt="sample.png"]');
    check(previewed.join() === '42', 'Space must open the attachment preview once');
    check(opened.join() === '42,42', 'Metadata and preview must leave report selection alone');

    flushSync(() => container.querySelector<HTMLButtonElement>('button[aria-label="Close preview"]')!.click());
    yield clickPosition(row.querySelector('.context-cell strong')!);
    check(opened.join() === '42,42,42', 'Clicking a plain row cell must open the report once');
    yield clickPosition(open);
    check(opened.join() === '42,42,42,42', 'Clicking the report button must open the report once');
  } finally {
    root.unmount();
    container.remove();
  }
}

window.dashboardKeyboardSteps = checkDashboard();
