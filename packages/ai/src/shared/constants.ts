import type { ChatModel } from '@dm-tool/shared/types';

export const DEFAULT_MODEL: ChatModel = 'claude-sonnet-4-6';

export const AON_ELASTICSEARCH_URL = 'https://elasticsearch.aonprd.com/aon/_search';
export const AON_BASE_URL = 'https://2e.aonprd.com';

/** Maximum tool-use round-trips before the draft pass stops. */
export const CHAT_STEP_LIMIT = 3;
