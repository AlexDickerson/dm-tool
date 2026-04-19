/// <reference types="vite/client" />

import type { ElectronAPI } from '@dm-tool/shared/types';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
