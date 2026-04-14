import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

const PMTILES_URL = 'pmtiles://https://map.pathfinderwiki.com/golarion.pmtiles';
const PINS_STORAGE_KEY = 'dmtool.globe.pins';

interface GlobePin {
  id: string;
  lng: number;
  lat: number;
  label: string;
}

function loadPins(): GlobePin[] {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GlobePin[]) : [];
  } catch {
    return [];
  }
}

function savePins(pins: GlobePin[]) {
  localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
}

function createPinElement(pin: GlobePin, onRemove: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:14px;height:14px;border-radius:50%;background:hsl(32 95% 52%);border:2px solid white;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4);position:relative;';
  el.title = pin.label || 'Pin';

  const x = document.createElement('button');
  x.textContent = '\u00d7';
  x.style.cssText =
    'position:absolute;top:-10px;right:-10px;width:16px;height:16px;border-radius:50%;background:hsl(0 70% 50%);color:white;border:none;font-size:11px;line-height:16px;text-align:center;cursor:pointer;display:none;padding:0;';
  el.appendChild(x);

  el.addEventListener('mouseenter', () => (x.style.display = 'block'));
  el.addEventListener('mouseleave', () => (x.style.display = 'none'));
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    onRemove();
  });

  return el;
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
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [pins, setPins] = useState<GlobePin[]>(loadPins);

  const removePin = useCallback((id: string) => {
    setPins((prev) => {
      const next = prev.filter((p) => p.id !== id);
      savePins(next);
      return next;
    });
    const marker = markersRef.current.get(id);
    if (marker) {
      marker.remove();
      markersRef.current.delete(id);
    }
  }, []);

  const addPin = useCallback(
    (lng: number, lat: number) => {
      const pin: GlobePin = { id: crypto.randomUUID(), lng, lat, label: '' };
      setPins((prev) => {
        const next = [...prev, pin];
        savePins(next);
        return next;
      });
    },
    [],
  );

  // Sync markers to the map whenever pins or map changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove markers that no longer have a pin
    for (const [id, marker] of markersRef.current) {
      if (!pins.find((p) => p.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Add markers for new pins
    for (const pin of pins) {
      if (!markersRef.current.has(pin.id)) {
        const el = createPinElement(pin, () => removePin(pin.id));
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          setPins((prev) => {
            const next = prev.map((p) => (p.id === pin.id ? { ...p, lng: pos.lng, lat: pos.lat } : p));
            savePins(next);
            return next;
          });
        });

        markersRef.current.set(pin.id, marker);
      }
    }
  }, [pins, removePin]);

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

    map.on('contextmenu', (e) => {
      addPin(e.lngLat.lng, e.lngLat.lat);
    });

    mapRef.current = map;

    // Restore existing pins once the map is ready
    map.on('load', () => {
      for (const pin of loadPins()) {
        const el = createPinElement(pin, () => removePin(pin.id));
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          setPins((prev) => {
            const next = prev.map((p) => (p.id === pin.id ? { ...p, lng: pos.lng, lat: pos.lat } : p));
            savePins(next);
            return next;
          });
        });

        markersRef.current.set(pin.id, marker);
      }
    });

    return () => {
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
