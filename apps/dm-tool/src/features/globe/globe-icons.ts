import type { Map as MlMap } from 'maplibre-gl';
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

/** Return the raw SVG path body for an icon name, or null if not found. */
export function getIconBody(name: string): string | null {
  const entry = (iconsData.icons as Record<string, { body: string }>)[name];
  return entry?.body ?? null;
}

/** MapLibre image key for a game-icon name. */
export function iconKey(name: string): string {
  return `gi-${name}`;
}

const DEFAULT_KEY = 'gi-default';

/** Register the default dot image used for pins with no icon. */
export function ensureDefaultImage(map: MlMap): void {
  if (map.hasImage(DEFAULT_KEY)) return;
  const size = 48;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="hsl(32,95%,52%)" stroke="white" stroke-width="3"/>
  </svg>`;
  loadSvgImage(map, DEFAULT_KEY, svg, size);
}

/** Ensure a game-icon is registered as a MapLibre image. */
export function ensureIconImage(map: MlMap, name: string): void {
  const key = iconKey(name);
  if (map.hasImage(key)) return;
  const body = getIconBody(name);
  if (!body) return;
  const size = 48;
  const pad = size * 0.15;
  const scale = (size - pad * 2) / 512;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="hsl(32,95%,52%)" stroke="white" stroke-width="3"/>
    <g transform="translate(${pad},${pad}) scale(${scale})" fill="white">${body}</g>
  </svg>`;
  loadSvgImage(map, key, svg, size);
}

function loadSvgImage(map: MlMap, key: string, svg: string, size: number): void {
  const img = new Image(size, size);
  img.onload = () => {
    if (!map.hasImage(key)) map.addImage(key, img);
  };
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Resolve a pin's icon field to the MapLibre image key, ensuring the image is loaded. */
export function resolvePinIcon(map: MlMap, icon: string): string {
  if (!icon) {
    ensureDefaultImage(map);
    return DEFAULT_KEY;
  }
  ensureIconImage(map, icon);
  return iconKey(icon);
}

/** Render an icon as an inline SVG string for use in React (picker thumbnails). */
export function iconSvgHtml(name: string, size = 24): string {
  const body = getIconBody(name);
  if (!body) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" fill="currentColor">${body}</svg>`;
}
