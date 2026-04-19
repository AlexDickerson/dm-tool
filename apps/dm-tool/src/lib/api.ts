// Thin typed wrapper over window.electronAPI. Exists so feature code
// imports from a single module instead of sprinkling `window.electronAPI`
// calls, which makes it easier to mock in tests later.

import type { ElectronAPI } from '@dm-tool/shared/types';

export const api: ElectronAPI = window.electronAPI;
