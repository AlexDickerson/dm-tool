// Single source of truth lives in @dm-tool/shared/types. Re-exported here under
// the name agents already import (DEFAULT_MODEL) to keep call sites unchanged.
export { DEFAULT_CHAT_MODEL as DEFAULT_MODEL } from '@dm-tool/shared/types';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';

export const AON_ELASTICSEARCH_URL = 'https://elasticsearch.aonprd.com/aon/_search';
export const AON_BASE_URL = 'https://2e.aonprd.com';

/** Maximum tool-use round-trips before the chat draft pass stops. */
export const CHAT_STEP_LIMIT = 3;

/** Token ceiling for the book classifier response. JSON-only, short. */
export const CLASSIFY_MAX_TOKENS = 256;

/** Token ceiling for encounter-hook generation (JSON array of 3 strings). */
export const ENCOUNTER_HOOK_MAX_TOKENS = 1024;

/** Token ceiling for loot generation (JSON object with items array). */
export const LOOT_MAX_TOKENS = 2048;
