// Player-facing read-only Golarion globe. Pins stream live from the
// portal's /api/globe endpoint (pushed by the DM tool on every edit).
// Mission pins open a parchment briefing overlay on click; note pins
// show a label popup.

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import {
  PIN_LAYER,
  PIN_SOURCE,
  buildMapStyle,
  ensureDefaultImage,
  ensureIconImage,
  pinsToGeoJson,
} from '@dm-tool/shared/golarion-map';
import { MissionBriefing } from '@dm-tool/shared/MissionBriefing';
import type { GlobePin, MissionData } from '@dm-tool/shared/types';
import { useLiveStream } from '../lib/live';

interface GlobeSnapshot {
  pins: GlobePin[];
  updatedAt: string;
}

// Tile URLs go through nginx's /map/ reverse proxy (same-origin) so the
// browser doesn't hit CORS on range requests against map.pathfinderwiki.com.
const mapStyle = buildMapStyle(`pmtiles://${window.location.origin}/map/golarion.pmtiles`);

// ---- Protocol registration ------------------------------------------------

let protocolRegistered = false;

// ---- Component ------------------------------------------------------------

export function Globe() {
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

  // Live-stream pin data from the portal server. The DM pushes on every
  // edit; we re-render whenever a new snapshot arrives.
  const live = useLiveStream<GlobeSnapshot>('/api/globe/stream');
  useEffect(() => {
    if (!live.data) return;
    setPins(live.data.pins);
    pinsRef.current = live.data.pins;
    syncSource(live.data.pins);
  }, [live.data, syncSource]);

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
