// Player-facing read-only Golarion globe. Loads pins from a static
// data.json exported from the DM tool. Mission pins open a parchment
// briefing overlay on click; note pins show a label popup.

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { ensureDefaultImage, ensureIconImage, resolvePinIcon } from './globe-icons';
import { MissionBriefing } from './MissionBriefing';
import type { ExportData, GlobePin, MissionData } from '@shared/types';

// Tile URLs go through the nginx reverse proxy at /map/ to avoid CORS issues
// (map.pathfinderwiki.com doesn't send Access-Control-Allow-Origin headers).
const PMTILES_URL = `pmtiles://${window.location.origin}/map/golarion.pmtiles`;
const PIN_SOURCE = 'globe-pins';
const PIN_LAYER = 'globe-pins-symbol';

function pinDisplaySize(currentZoom: number, placedZoom: number): number {
  return Math.min(0.75, 0.75 * Math.pow(2, currentZoom - placedZoom));
}

function pinsToGeoJson(pins: GlobePin[], map: maplibregl.Map): GeoJSON.FeatureCollection {
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
        displaySize: pinDisplaySize(zoom, p.zoom),
        kind: p.kind,
      },
    })),
  };
}

// ---- Map style (identical to DM tool) ------------------------------------

const colors = {
  waterDeep: 'rgb(110, 160, 245)',
  nationBorders: 'rgb(170, 170, 170)',
  regionBorders: 'rgb(107, 42, 33)',
  regionLabels: 'rgb(17, 42, 97)',
  regionLabelsOut: 'rgb(213, 195, 138)',
  white: 'rgb(255, 255, 255)',
  black: 'rgb(10, 10, 10)',
};

const filterMinzoom: maplibregl.ExpressionSpecification = ['get', 'filterMinzoom'];
const filterMaxzoom: maplibregl.ExpressionSpecification = ['get', 'filterMaxzoom'];

const defaultFilter: maplibregl.ExpressionSpecification = [
  'all',
  ['any', ['!', ['has', 'filterMinzoom']], ['>=', ['zoom'], filterMinzoom]],
  ['any', ['!', ['has', 'filterMaxzoom']], ['<=', ['zoom'], filterMaxzoom]],
];

function layer(
  id: string,
  sourceLayer: string,
  base: Partial<maplibregl.LayerSpecification>,
): maplibregl.LayerSpecification {
  return {
    id,
    source: 'golarion',
    'source-layer': sourceLayer,
    filter: defaultFilter,
    ...base,
  } as maplibregl.LayerSpecification;
}

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    golarion: {
      type: 'vector',
      url: PMTILES_URL,
      attribution:
        '<a href="https://paizo.com/licenses/communityuse">Paizo CUP</a>, <a href="https://github.com/pf-wikis/mapping#acknowledgments">Acknowledgments</a>',
    },
  },
  sprite: '/map/sprites/sprites',
  glyphs: '/map/fonts/{fontstack}/{range}.pbf',
  transition: { duration: 300, delay: 0 },
  sky: { 'atmosphere-blend': 0.5 },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': colors.waterDeep } },
    layer('geometry', 'geometry', { type: 'fill', paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false } }),
    layer('nation-borders', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 3],
      paint: {
        'line-color': colors.nationBorders,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 3, 0.375, 5, 2],
      },
      layout: { 'line-cap': 'round' },
    }),
    layer('subregion-borders', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 2],
      paint: {
        'line-color': colors.nationBorders,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0.375, 3, 2],
      },
      layout: { 'line-cap': 'round' },
    }),
    layer('borders-regions', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 1],
      paint: {
        'line-color': ['interpolate', ['exponential', 2], ['zoom'], 4, colors.regionBorders, 5, colors.nationBorders],
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 4, 3, 5, 2],
      },
      layout: { 'line-cap': 'round' },
    }),
    layer('province-borders', 'borders', {
      type: 'line',
      minzoom: 4,
      filter: ['==', ['get', 'borderType'], 4],
      paint: {
        'line-color': colors.nationBorders,
        'line-opacity': ['interpolate', ['exponential', 2], ['zoom'], 4, 0, 6, 1],
        'line-dasharray': [5, 10],
      },
      layout: { 'line-cap': 'round' },
    }),
    layer('district-borders', 'borders', {
      type: 'line',
      minzoom: 8,
      filter: ['==', ['get', 'borderType'], 5],
      paint: {
        'line-color': colors.nationBorders,
        'line-opacity': ['interpolate', ['exponential', 2], ['zoom'], 8, 0, 10, 1],
        'line-dasharray': [2, 4],
      },
      layout: { 'line-cap': 'round' },
    }),
    layer('line-labels', 'line-labels', {
      type: 'symbol',
      layout: {
        'symbol-placement': 'line',
        'text-max-angle': 20,
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'symbol-spacing': 300,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 16],
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': ['get', 'halo'],
        'text-halo-width': ['interpolate', ['linear'], ['zoom'], 5, 0.125, 10, 1],
      },
    }),
    layer('location-icons', 'locations', {
      type: 'symbol',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-pitch-alignment': 'map',
        'icon-overlap': 'always',
        'icon-ignore-placement': true,
        'icon-size': [
          'interpolate',
          ['exponential', 2],
          ['zoom'],
          0,
          ['^', 2, ['-', -3, filterMinzoom]],
          1,
          ['^', 2, ['-', -2, filterMinzoom]],
          2,
          ['min', 1, ['^', 2, ['-', -1, filterMinzoom]]],
          3,
          ['min', 1, ['^', 2, ['-', 0, filterMinzoom]]],
          4,
          ['min', 1, ['^', 2, ['-', 1, filterMinzoom]]],
          5,
          ['min', 1, ['^', 2, ['-', 2, filterMinzoom]]],
          6,
          ['min', 1, ['^', 2, ['-', 3, filterMinzoom]]],
          7,
          ['min', 1, ['^', 2, ['-', 4, filterMinzoom]]],
          8,
          ['min', 1, ['^', 2, ['-', 5, filterMinzoom]]],
          9,
          ['min', 1, ['^', 2, ['-', 6, filterMinzoom]]],
          10,
          ['min', 1, ['^', 2, ['-', 7, filterMinzoom]]],
        ] as maplibregl.ExpressionSpecification,
      },
    }),
    layer('labels', 'labels', {
      type: 'symbol',
      layout: {
        'text-field': ['get', 'label'],
        'text-rotate': ['get', 'angle'],
        'text-rotation-alignment': 'map',
        'text-font': ['NotoSans-Medium'],
        'text-size': 16,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': ['get', 'halo'], 'text-halo-width': 1.5 },
    }),
    layer('location-labels', 'locations', {
      type: 'symbol',
      filter: [
        'all',
        ['>', ['zoom'], ['+', filterMinzoom, 3]],
        ['any', ['!', ['has', 'filterMaxzoom']], ['<=', ['zoom'], filterMaxzoom]],
      ],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'text-size': 14,
        'text-variable-anchor': ['left', 'right'],
        'text-radial-offset': 0.5,
        'text-rotation-alignment': 'map',
      },
      paint: { 'text-color': colors.white, 'text-halo-color': colors.black, 'text-halo-width': 0.8 },
    }),
    layer('province-labels', 'province-labels', {
      type: 'symbol',
      minzoom: 4,
      maxzoom: 7,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 5, 7, 20],
        'text-rotation-alignment': 'map',
        'text-variable-anchor': ['center', 'top', 'bottom'],
        'symbol-z-order': 'source',
      },
      paint: {
        'text-color': colors.white,
        'text-halo-color': colors.regionLabels,
        'text-halo-width': ['interpolate', ['linear'], ['zoom'], 5, 0.375, 7, 1.5],
      },
    }),
    layer('nation-labels', 'nation-labels', {
      type: 'symbol',
      minzoom: 3,
      maxzoom: 6,
      filter: ['any', ['!', ['get', 'inSubregion']], ['>', ['zoom'], 4]],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 5, 25],
        'text-rotation-alignment': 'map',
        'text-variable-anchor': ['center', 'top', 'bottom'],
        'symbol-z-order': 'source',
      },
      paint: {
        'text-color': colors.white,
        'text-halo-color': colors.regionLabels,
        'text-halo-width': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 5, 1.875],
      },
    }),
    layer('subregion-labels', 'subregion-labels', {
      type: 'symbol',
      minzoom: 3,
      maxzoom: 5,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 5, 25],
        'text-rotation-alignment': 'map',
        'text-variable-anchor': ['center', 'top', 'bottom'],
        'symbol-z-order': 'source',
      },
      paint: {
        'text-color': colors.white,
        'text-halo-color': colors.regionLabels,
        'text-halo-width': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 5, 1.875],
      },
    }),
    layer('region-labels', 'region-labels', {
      type: 'symbol',
      minzoom: 1,
      maxzoom: 3,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['NotoSans-Medium'],
        'text-size': 20,
        'text-rotation-alignment': 'map',
        'text-variable-anchor': ['center', 'top', 'bottom'],
        'symbol-z-order': 'source',
      },
      paint: { 'text-color': colors.regionLabels, 'text-halo-color': colors.regionLabelsOut, 'text-halo-width': 1.5 },
    }),
  ],
};

// ---- Protocol registration ------------------------------------------------

let protocolRegistered = false;

// ---- Component ------------------------------------------------------------

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef<GlobePin[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [pins, setPins] = useState<GlobePin[]>([]);
  const [activeMission, setActiveMission] = useState<MissionData | null>(null);

  const syncSource = useCallback((updated: GlobePin[]) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(PIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(pinsToGeoJson(updated, map));
  }, []);

  // Load pin data from the static JSON export.
  useEffect(() => {
    fetch('/data.json')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<ExportData>;
      })
      .then((data) => {
        setPins(data.pins);
        pinsRef.current = data.pins;
        syncSource(data.pins);
      })
      .catch((err) => console.warn('No pin data loaded:', err));
  }, [syncSource]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    if (!protocolRegistered) {
      const protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      protocolRegistered = true;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: [0, 30],
      zoom: 2,
      attributionControl: {},
    });

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('styleimagemissing', (e: { id: string }) => {
      if (e.id === 'gi-default') ensureDefaultImage(map);
      else if (e.id.startsWith('gi-')) ensureIconImage(map, e.id.slice(3));
    });

    map.on('load', () => {
      ensureDefaultImage(map);

      map.addSource(PIN_SOURCE, {
        type: 'geojson',
        data: pinsToGeoJson(pinsRef.current, map),
      });

      map.addLayer({
        id: PIN_LAYER,
        type: 'symbol',
        source: PIN_SOURCE,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['get', 'displaySize'] as maplibregl.ExpressionSpecification,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'map',
        },
      });

      // Recompute icon sizes continuously during zoom
      map.on('zoom', () => syncSource(pinsRef.current));

      // Pointer cursor on hover
      map.on('mouseenter', PIN_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', PIN_LAYER, () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
        popupRef.current = null;
      });

      // Hover: show label popup
      map.on('mousemove', PIN_LAYER, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const label = feature.properties?.label as string;
        if (!label) {
          popupRef.current?.remove();
          return;
        }
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 20,
          });
        }
        popupRef.current.setLngLat(coords).setHTML(`<strong>${label}</strong>`).addTo(map);
      });

      // Click: mission pins open the briefing
      map.on('click', PIN_LAYER, (e) => {
        const pinId = e.features?.[0]?.properties?.id as string | undefined;
        if (!pinId) return;
        const pin = pinsRef.current.find((p) => p.id === pinId);
        if (!pin) return;
        if (pin.kind === 'mission' && pin.mission) {
          setActiveMission(pin.mission);
        }
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-sync when pins state changes
  useEffect(() => {
    pinsRef.current = pins;
    syncSource(pins);
  }, [pins, syncSource]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {activeMission && <MissionBriefing mission={activeMission} onClose={() => setActiveMission(null)} />}
    </div>
  );
}
