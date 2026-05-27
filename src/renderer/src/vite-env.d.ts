/// <reference types="vite/client" />

import type { BugPocketApi } from '../../preload';

declare global {
  interface Window {
    bugPocket: BugPocketApi;
  }
}
