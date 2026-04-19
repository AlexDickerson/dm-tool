// Centralized constants for the Electron main process.
// Keeps magic strings and numbers out of logic modules.

import type { ChatModel } from '@dm-tool/shared/types';

// --- Anthropic API -----------------------------------------------------------

export const DEFAULT_MODEL: ChatModel = 'claude-sonnet-4-6';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const ENCOUNTER_HOOK_MAX_TOKENS = 1024;
export const CLASSIFY_MAX_TOKENS = 256;

// --- Archives of Nethys ------------------------------------------------------

export const AON_ELASTICSEARCH_URL = 'https://elasticsearch.aonprd.com/aon/_search';
export const AON_BASE_URL = 'https://2e.aonprd.com';

// --- Foundry VTT MCP --------------------------------------------------------

export const MCP_PROTOCOL_VERSION = '2025-03-26';

// --- File conventions --------------------------------------------------------

export const THUMBNAIL_SUFFIX = '.thumb.jpg';

