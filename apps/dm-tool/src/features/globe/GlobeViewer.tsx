import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { api } from '@/lib/api';
import type { GlobePin, GlobePinKind, MissionData } from '@dm-tool/shared/types';
import {
  PIN_LAYER,
  PIN_SOURCE,
  buildMapStyle,
  ensureDefaultImage,
  ensureIconImage,
  getIconBody,
  pinsToGeoJson,
} from '@dm-tool/shared/golarion-map';
import { IconPicker } from './IconPicker';
import { MissionBriefing } from '@dm-tool/shared/MissionBriefing';

const mapStyle = buildMapStyle();

// Register the PMTiles protocol once globally.
let protocolRegistered = false;

export function GlobeViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef<GlobePin[]>([]);
  const [pins, setPins] = useState<GlobePin[]>([]);
  const [selectedIcon, setSelectedIcon] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pinKind, setPinKind] = useState<GlobePinKind>('note');
  const [activeMission, setActiveMission] = useState<MissionData | null>(null);
  /** The pin behind the active mission briefing — needed for Link Note / Refresh. */
  const [activeMissionPin, setActiveMissionPin] = useState<GlobePin | null>(null);
  const [missionLinking, setMissionLinking] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  /** Tracks whether the pin was dragged (mouse moved) vs just clicked in place. */
  const dragMovedRef = useRef(false);
  /** Last click metadata for manual double-click detection — MapLibre's
   *  dblclick event is unreliable because the mousedown drag handler calls
   *  preventDefault, suppressing the browser's dblclick generation. */
  const lastPinClickRef = useRef<{ id: string; time: number } | null>(null);
  const selectedIconRef = useRef(selectedIcon);
  const pinKindRef = useRef(pinKind);

  useEffect(() => {
    selectedIconRef.current = selectedIcon;
  }, [selectedIcon]);

  useEffect(() => {
    pinKindRef.current = pinKind;
  }, [pinKind]);

  // Keep the ref in sync so map event handlers always see current pins.
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  // Load pins from the database on mount.
  useEffect(() => {
    api
      .globePinsList()
      .then(setPins)
      .catch((err) => {
        console.error('Failed to load globe pins:', err);
      });
  }, []);

  const syncSource = useCallback((updated: GlobePin[]) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(PIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(pinsToGeoJson(updated, map));
  }, []);

  const removePin = useCallback(
    (id: string) => {
      api.globePinsDelete(id).catch((err) => {
        console.error(`Failed to delete pin ${id}:`, err);
      });
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
      const pin: GlobePin = {
        id: crypto.randomUUID(),
        lng,
        lat,
        label: '',
        icon: selectedIconRef.current,
        zoom: currentZoom,
        note: '',
        kind: pinKindRef.current,
      };
      api.globePinsUpsert(pin).catch((err) => {
        console.error(`Failed to add pin ${pin.id}:`, err);
      });
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
      doubleClickZoom: false,
    });

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // When MapLibre encounters an icon-image that isn't loaded yet, load
    // it on demand. addImage() triggers a re-render automatically.
    map.on('styleimagemissing', (e: { id: string }) => {
      if (e.id === 'gi-default') {
        ensureDefaultImage(map);
      } else if (e.id.startsWith('gi-')) {
        ensureIconImage(map, e.id.slice(3));
      }
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
      map.on('zoom', () => {
        syncSource(pinsRef.current);
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

      // Drag: mousedown on pin starts, mousemove updates, mouseup commits.
      // Double-click detection is embedded here because the mousedown
      // preventDefault suppresses the browser's native dblclick event.
      map.on('mousedown', PIN_LAYER, (e) => {
        if (e.originalEvent.button !== 0) return; // left-click only
        e.preventDefault();
        dragIdRef.current = e.features![0].properties!.id as string;
        dragMovedRef.current = false;
        map.getCanvas().style.cursor = 'grabbing';
        map.dragPan.disable();
      });

      map.on('mousemove', (e) => {
        const id = dragIdRef.current;
        if (!id) return;
        dragMovedRef.current = true;
        const updated = pinsRef.current.map((p) => (p.id === id ? { ...p, lng: e.lngLat.lng, lat: e.lngLat.lat } : p));
        pinsRef.current = updated;
        syncSource(updated);
      });

      map.on('mouseup', () => {
        const id = dragIdRef.current;
        if (!id) return;
        dragIdRef.current = null;
        map.getCanvas().style.cursor = '';
        map.dragPan.enable();

        const wasDrag = dragMovedRef.current;
        dragMovedRef.current = false;

        if (wasDrag) {
          // Real drag — persist the new position
          const pin = pinsRef.current.find((p) => p.id === id);
          if (pin) {
            api.globePinsUpsert(pin).catch((err) => {
              console.error(`Failed to persist pin drag for ${pin.id}:`, err);
            });
            setPins([...pinsRef.current]);
          }
          lastPinClickRef.current = null;
          return;
        }

        // Click-in-place — check for double-click (two clicks on same pin within 400ms)
        const now = Date.now();
        const last = lastPinClickRef.current;
        if (last && last.id === id && now - last.time < 400) {
          // Double-click: open briefing / Obsidian note
          lastPinClickRef.current = null;
          const pin = pinsRef.current.find((p) => p.id === id);
          if (!pin) return;
          if (pin.kind === 'mission') {
            setActiveMissionPin(pin);
            api
              .globePinGetMission(pin)
              .then((mission) => {
                if (mission) setActiveMission(mission);
                return api.globePinsList();
              })
              .then(setPins)
              .catch((err) => {
                console.error(`Failed to load mission for pin ${pin.id}:`, err);
              });
          } else {
            api
              .globePinOpenNote(pin)
              .then(() => api.globePinsList())
              .then(setPins)
              .catch((err) => {
                console.error(`Failed to open note for pin ${pin.id}:`, err);
              });
          }
        } else {
          lastPinClickRef.current = { id, time: now };
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
          <span
            dangerouslySetInnerHTML={{
              __html: `<svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22">${selectedBody}</svg>`,
            }}
          />
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

      {/* Pin kind toggle — determines what kind of pin is placed on right-click */}
      <div
        className="absolute left-3 z-10 flex overflow-hidden rounded-lg border border-border bg-background/90 shadow-md backdrop-blur-sm"
        style={{ top: 52, height: 32 }}
      >
        <button
          type="button"
          onClick={() => setPinKind('note')}
          className={`px-3 text-xs transition-colors ${
            pinKind === 'note' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
          }`}
          title="Note pins open the linked Obsidian note on double-click"
        >
          Note
        </button>
        <button
          type="button"
          onClick={() => setPinKind('mission')}
          className={`px-3 text-xs transition-colors ${
            pinKind === 'mission' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
          }`}
          title="Mission pins open an in-universe briefing parchment on double-click"
        >
          Mission
        </button>
      </div>

      {pickerOpen && (
        <IconPicker selected={selectedIcon} onSelect={setSelectedIcon} onClose={() => setPickerOpen(false)} />
      )}

      {activeMission && (
        <MissionBriefing
          mission={activeMission}
          onClose={() => {
            setActiveMission(null);
            setActiveMissionPin(null);
          }}
          actions={
            activeMissionPin && (
              <button
                type="button"
                disabled={missionLinking}
                onClick={async () => {
                  if (!activeMissionPin) return;
                  setMissionLinking(true);
                  try {
                    const updated = await api.globePinLinkNote(activeMissionPin);
                    if (updated) {
                      setActiveMissionPin(updated);
                      const fresh = await api.globePinGetMission(updated);
                      if (fresh) setActiveMission(fresh);
                      const list = await api.globePinsList();
                      setPins(list);
                    }
                  } finally {
                    setMissionLinking(false);
                  }
                }}
                className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase text-white/80 hover:bg-white/20 disabled:opacity-50"
                style={{ letterSpacing: '0.1em' }}
                title="Associate this pin with an existing Obsidian note"
              >
                {missionLinking ? 'Linking\u2026' : 'Link Note'}
              </button>
            )
          }
        />
      )}
    </div>
  );
}
