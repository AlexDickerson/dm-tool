import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { api } from '@/lib/api';
import type { GlobePin } from '@shared/types';
import { ensureDefaultImage, resolvePinIcon, getIconBody } from './globe-icons';
import { IconPicker } from './IconPicker';

const PMTILES_URL = 'pmtiles://https://map.pathfinderwiki.com/golarion.pmtiles';
const PIN_SOURCE = 'globe-pins';
const PIN_LAYER = 'globe-pins-symbol';

function pinsToGeoJson(pins: GlobePin[], map: maplibregl.Map): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id, label: p.label, icon: resolvePinIcon(map, p.icon), placedZoom: p.zoom },
    })),
  };
}

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
  sprite: 'https://map.pathfinderwiki.com/sprites/sprites',
  glyphs: 'https://map.pathfinderwiki.com/fonts/{fontstack}/{range}.pbf',
  transition: { duration: 300, delay: 0 },
  sky: { 'atmosphere-blend': 0.5 },
  layers: [
    // Background (deep ocean)
    { id: 'background', type: 'background', paint: { 'background-color': colors.waterDeep } },

    // Land + terrain geometry
    layer('geometry', 'geometry', {
      type: 'fill',
      paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false },
    }),

    // Borders — nation
    layer('nation-borders', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 3],
      paint: {
        'line-color': colors.nationBorders,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 3, 0.375, 5, 2],
      },
      layout: { 'line-cap': 'round' },
    }),

    // Borders — subregion
    layer('subregion-borders', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 2],
      paint: {
        'line-color': colors.nationBorders,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0.375, 3, 2],
      },
      layout: { 'line-cap': 'round' },
    }),

    // Borders — region
    layer('borders-regions', 'borders', {
      type: 'line',
      filter: ['==', ['get', 'borderType'], 1],
      paint: {
        'line-color': [
          'interpolate',
          ['exponential', 2],
          ['zoom'],
          4,
          colors.regionBorders,
          5,
          colors.nationBorders,
        ],
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 4, 3, 5, 2],
      },
      layout: { 'line-cap': 'round' },
    }),

    // Borders — province (dashed)
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

    // Borders — district (dashed)
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

    // Line labels (rivers, roads, etc.)
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

    // Location icons
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

    // Area labels
    layer('labels', 'labels', {
      type: 'symbol',
      layout: {
        'text-field': ['get', 'label'],
        'text-rotate': ['get', 'angle'],
        'text-rotation-alignment': 'map',
        'text-font': ['NotoSans-Medium'],
        'text-size': 16,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': ['get', 'halo'],
        'text-halo-width': 1.5,
      },
    }),

    // Location labels (appear at higher zoom)
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
      paint: {
        'text-color': colors.white,
        'text-halo-color': colors.black,
        'text-halo-width': 0.8,
      },
    }),

    // Province labels
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

    // Nation labels
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

    // Subregion labels
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

    // Region labels (widest zoom)
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
      paint: {
        'text-color': colors.regionLabels,
        'text-halo-color': colors.regionLabelsOut,
        'text-halo-width': 1.5,
      },
    }),
  ],
};

// Register the PMTiles protocol once globally.
let protocolRegistered = false;

export function GlobeViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef<GlobePin[]>([]);
  const [pins, setPins] = useState<GlobePin[]>([]);
  const [selectedIcon, setSelectedIcon] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  const selectedIconRef = useRef(selectedIcon);

  useEffect(() => {
    selectedIconRef.current = selectedIcon;
  }, [selectedIcon]);

  // Keep the ref in sync so map event handlers always see current pins.
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  // Load pins from the database on mount.
  useEffect(() => {
    api.globePinsList().then(setPins);
  }, []);

  const syncSource = useCallback((updated: GlobePin[]) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(PIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(pinsToGeoJson(updated, map));
  }, []);

  const removePin = useCallback(
    (id: string) => {
      api.globePinsDelete(id);
      setPins((prev) => {
        const next = prev.filter((p) => p.id !== id);
        syncSource(next);
        return next;
      });
    },
    [syncSource],
  );

  const addPin = useCallback(
    (lng: number, lat: number) => {
      const currentZoom = mapRef.current?.getZoom() ?? 2;
      const pin: GlobePin = { id: crypto.randomUUID(), lng, lat, label: '', icon: selectedIconRef.current, zoom: currentZoom };
      api.globePinsUpsert(pin);
      setPins((prev) => {
        const next = [...prev, pin];
        syncSource(next);
        return next;
      });
    },
    [syncSource],
  );

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
          'icon-size': ['min', 0.75, ['*', 0.75, ['^', 2, ['-', ['zoom'], ['get', 'placedZoom']]]]] as
            maplibregl.ExpressionSpecification,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'map',
        },
      });

      // Pointer cursor on hover
      map.on('mouseenter', PIN_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', PIN_LAYER, () => {
        if (!dragIdRef.current) map.getCanvas().style.cursor = '';
      });

      // Right-click: place new pin, or remove existing one
      map.on('contextmenu', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [PIN_LAYER] });
        if (features.length > 0) {
          removePin(features[0].properties!.id as string);
        } else {
          addPin(e.lngLat.lng, e.lngLat.lat);
        }
      });

      // Drag: mousedown on pin starts, mousemove updates, mouseup commits
      map.on('mousedown', PIN_LAYER, (e) => {
        if (e.originalEvent.button !== 0) return; // left-click only
        e.preventDefault();
        dragIdRef.current = e.features![0].properties!.id as string;
        map.getCanvas().style.cursor = 'grabbing';
        map.dragPan.disable();
      });

      map.on('mousemove', (e) => {
        const id = dragIdRef.current;
        if (!id) return;
        const updated = pinsRef.current.map((p) =>
          p.id === id ? { ...p, lng: e.lngLat.lng, lat: e.lngLat.lat } : p,
        );
        pinsRef.current = updated;
        syncSource(updated);
      });

      map.on('mouseup', () => {
        const id = dragIdRef.current;
        if (!id) return;
        dragIdRef.current = null;
        map.getCanvas().style.cursor = '';
        map.dragPan.enable();
        const pin = pinsRef.current.find((p) => p.id === id);
        if (pin) {
          api.globePinsUpsert(pin);
          setPins([...pinsRef.current]);
        }
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-sync the source whenever React state changes (e.g. after initial DB load).
  useEffect(() => {
    syncSource(pins);
  }, [pins, syncSource]);

  const selectedBody = selectedIcon ? getIconBody(selectedIcon) : null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Active icon indicator */}
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        title={selectedIcon || 'Default pin (click to change)'}
        className="absolute left-3 top-3 z-10 flex items-center justify-center rounded-lg border border-border bg-background/90 shadow-md backdrop-blur-sm transition-colors hover:bg-accent"
        style={{ width: 40, height: 40 }}
      >
        {selectedBody ? (
          <span dangerouslySetInnerHTML={{
            __html: `<svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22">${selectedBody}</svg>`,
          }} />
        ) : (
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'hsl(32, 95%, 52%)',
              border: '2px solid white',
            }}
          />
        )}
      </button>
      {pickerOpen && (
        <IconPicker
          selected={selectedIcon}
          onSelect={setSelectedIcon}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
