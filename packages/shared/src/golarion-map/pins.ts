// Pin-layer primitives shared between the DM editor and the read-only
// player-portal view. The source + layer ids are shared too so both apps
// can target the same MapLibre layer for hit-testing / event handling.

import type { FeatureCollection } from 'geojson';
import type { Map as MlMap } from 'maplibre-gl';
import type { GlobePin } from '../types.js';
import { resolvePinIcon } from './icons.js';

export const PIN_SOURCE = 'globe-pins';
export const PIN_LAYER = 'globe-pins-symbol';

/** Icons shrink when the user zooms out past the pin's placement zoom so a
 *  dense cluster at z=5 doesn't become a blob of overlapping dots at z=2. */
export function pinDisplaySize(currentZoom: number, placedZoom: number): number {
  return Math.min(0.75, 0.75 * Math.pow(2, currentZoom - placedZoom));
}

/** Build a GeoJSON FeatureCollection for the pin source. Every pin's icon
 *  is pre-resolved to its MapLibre image key (and registered as a side
 *  effect if it hasn't been seen yet). */
export function pinsToGeoJson(pins: GlobePin[], map: MlMap): FeatureCollection {
  const zoom = map.getZoom();
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        label: p.label,
        icon: resolvePinIcon(map, p.icon),
        placedZoom: p.zoom,
        displaySize: pinDisplaySize(zoom, p.zoom),
        kind: p.kind,
      },
    })),
  };
}
