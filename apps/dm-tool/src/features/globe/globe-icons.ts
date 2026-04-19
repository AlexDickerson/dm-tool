// IconPicker-only exports. MapLibre image registration + SVG helpers
// moved to @dm-tool/shared/golarion-map — see that module if you need
// getIconBody, resolvePinIcon, etc. for map rendering.

import iconsData from '@iconify-json/game-icons/icons.json';

/** All available icon names from game-icons.net. */
export const ALL_ICON_NAMES: string[] = Object.keys(iconsData.icons);

/** Quick-access icons for common TTRPG map markers. */
export const SUGGESTED_ICONS: string[] = [
  'crossed-swords',
  'shield',
  'castle',
  'campfire',
  'cave-entrance',
  'dragon-head',
  'crown',
  'skull-crossed-bones',
  'open-treasure-chest',
  'scroll-unfurled',
  'compass',
  'mountains',
  'forest',
  'house',
  'galleon',
  'evil-tower',
  'stone-bridge',
  'church',
  'village',
  'black-flag',
  'crossbow',
  'battle-axe',
  'fairy-wand',
  'spell-book',
  'key',
  'wolf-head',
  'horse-head',
  'raven',
  'wooden-door',
  'round-star',
];

// Re-export for IconPicker (thumbnails need the raw SVG body).
export { getIconBody } from '@dm-tool/shared/golarion-map';
