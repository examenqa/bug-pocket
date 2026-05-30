import React from 'react';
import type { SyncStatus } from '../../../../shared/types';
import { syncClass } from '../../utils/display';

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

export function SyncBadge({ status }: { status: SyncStatus }) {
  return <span className={`sync-badge ${syncClass(status)}`}>{status || 'Local Only'}</span>;
}
