// MapLibre image registration for game-icons.net markers. Both the DM
// tool and the player portal share the same icon encoding + default-dot
// treatment — the DM tool adds its own IconPicker layer on top
// (ALL_ICON_NAMES + SUGGESTED_ICONS stay dm-tool-side).

import type { Map as MlMap } from 'maplibre-gl';
import iconsData from '@iconify-json/game-icons/icons.json';

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

function loadSvgImage(map: MlMap, key: string, svg: string, size: number): void {
  const img = new Image(size, size);
  img.onload = () => {
    if (!map.hasImage(key)) map.addImage(key, img);
  };
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
