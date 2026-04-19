// Centralized constants for the Electron main process.
// Keeps magic strings and numbers out of logic modules.

import type { ChatModel } from '@dm-tool/shared/types';

// --- Anthropic API -----------------------------------------------------------

export const DEFAULT_MODEL: ChatModel = 'claude-sonnet-4-6';

// --- Archives of Nethys ------------------------------------------------------

export const AON_ELASTICSEARCH_URL = 'https://elasticsearch.aonprd.com/aon/_search';
export const AON_BASE_URL = 'https://2e.aonprd.com';

// --- Foundry VTT MCP --------------------------------------------------------

export const MCP_PROTOCOL_VERSION = '2025-03-26';

// --- File conventions --------------------------------------------------------

export const THUMBNAIL_SUFFIX = '.thumb.jpg';
