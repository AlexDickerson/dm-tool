// MapLibre style for the Golarion PMTiles map. Identical between the DM
// tool and the player portal — keeping it here means both stay visually
// in sync automatically.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** Default upstream PMTiles URL — used by the DM tool directly. The
 *  player portal passes its nginx-proxied URL (e.g.
 *  `pmtiles://${origin}/map/golarion.pmtiles`) to avoid CORS on tile
 *  range requests. */
export const DEFAULT_PMTILES_URL = 'pmtiles://https://map.pathfinderwiki.com/golarion.pmtiles';

export const colors = {
  waterDeep: 'rgb(110, 160, 245)',
  nationBorders: 'rgb(170, 170, 170)',
  regionBorders: 'rgb(107, 42, 33)',
  regionLabels: 'rgb(17, 42, 97)',
  regionLabelsOut: 'rgb(213, 195, 138)',
  white: 'rgb(255, 255, 255)',
  black: 'rgb(10, 10, 10)',
} as const;

const filterMinzoom: ExpressionSpecification = ['get', 'filterMinzoom'];
const filterMaxzoom: ExpressionSpecification = ['get', 'filterMaxzoom'];

const defaultFilter: ExpressionSpecification = [
  'all',
  ['any', ['!', ['has', 'filterMinzoom']], ['>=', ['zoom'], filterMinzoom]],
  ['any', ['!', ['has', 'filterMaxzoom']], ['<=', ['zoom'], filterMaxzoom]],
];

function layer(id: string, sourceLayer: string, base: Partial<LayerSpecification>): LayerSpecification {
  return {
    id,
    source: 'golarion',
    'source-layer': sourceLayer,
    filter: defaultFilter,
    ...base,
  } as LayerSpecification;
}

/** Build the MapLibre style for a given PMTiles URL. Consumers pass
 *  their environment-specific URL (upstream for the DM app; proxied
 *  same-origin for the player portal). */
export function buildMapStyle(pmtilesUrl: string = DEFAULT_PMTILES_URL): StyleSpecification {
  return {
    version: 8,
    sources: {
      golarion: {
        type: 'vector',
        url: pmtilesUrl,
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
          'line-color': ['interpolate', ['exponential', 2], ['zoom'], 4, colors.regionBorders, 5, colors.nationBorders],
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
          ] as ExpressionSpecification,
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
}
