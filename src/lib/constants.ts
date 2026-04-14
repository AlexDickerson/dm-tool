// Centralized constants for the React renderer.
// Keeps magic strings and numbers out of component files.

import type { ChatModel } from '@shared/types';

// --- localStorage keys -------------------------------------------------------

export const STORAGE_KEYS = {
  uiScale: 'dmtool.uiScale',
  thumbScale: 'dmtool.thumbScale',
  fontFamily: 'dmtool.fontFamily',
  theme: 'dmtool.theme',
  chatModel: 'dmtool.chatModel',
  readerZoom: 'dmtool.reader.zoom',
  readerScrollPrefix: 'dmtool.reader.scroll.',
  toolUrls: 'dmtool.toolUrls',
  toolFavicons: 'dmtool.toolFavicons',
} as const;

// --- External tool iframes ---------------------------------------------------

export interface ToolEntry {
  id: string;
  label: string;
  url: string;
}

export const DEFAULT_TOOLS: ToolEntry[] = [
  { id: 'names', label: 'Name Generator', url: 'https://www.fantasynamegenerators.com/' },
  { id: 'aon', label: 'Archives of Nethys', url: 'https://2e.aonprd.com/' },
];

// --- UI scale ----------------------------------------------------------------

export const UI_SCALE = { default: 18, min: 14, max: 24 } as const;
/** Header is `h-12` = 3rem; the native overlay must match in pixels. */
export const HEADER_REMS = 3;

// --- Thumbnail scale ---------------------------------------------------------

export const THUMB_SCALE = { default: 1, min: 0.7, max: 2 } as const;

// --- Font families -----------------------------------------------------------

export type FontFamily = 'sans-serif' | 'serif';
export const FONT_STACKS: Record<FontFamily, string> = {
  'sans-serif': "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Crimson Pro', 'Palatino Linotype', Georgia, serif",
};

// --- Color themes ------------------------------------------------------------

export type ThemeId = 'ember' | 'arcane' | 'verdant' | 'frost' | 'parchment';
export const THEME_DEFAULT: ThemeId = 'ember';
export const THEMES: Array<{ id: ThemeId; label: string; swatch: string }> = [
  { id: 'ember', label: 'Ember', swatch: 'hsl(32 95% 52%)' },
  { id: 'arcane', label: 'Arcane', swatch: 'hsl(265 85% 60%)' },
  { id: 'verdant', label: 'Verdant', swatch: 'hsl(145 70% 45%)' },
  { id: 'frost', label: 'Frost', swatch: 'hsl(210 80% 55%)' },
  { id: 'parchment', label: 'Parchment', swatch: 'hsl(25 85% 40%)' },
];

// --- Chat models -------------------------------------------------------------

export const DEFAULT_CHAT_MODEL: ChatModel = 'claude-sonnet-4-6';
export const CHAT_MODELS: Array<{ id: ChatModel; label: string }> = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast, cheap' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — balanced' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6 — smartest, slowest' },
];

// --- File conventions --------------------------------------------------------

export const THUMBNAIL_SUFFIX = '.thumb.jpg';
