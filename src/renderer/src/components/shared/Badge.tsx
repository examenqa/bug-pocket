import React from 'react';
import type { SyncStatus } from '../../../../shared/types';
import { effectiveSyncStatus, syncClass } from '../../utils/display';

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

export function SyncBadge({ status, cloudSyncActive = false }: { status: SyncStatus; cloudSyncActive?: boolean }) {
  const visibleStatus = effectiveSyncStatus(status, cloudSyncActive);
  return <span className={`sync-badge ${syncClass(visibleStatus)}`}>{visibleStatus}</span>;
}
