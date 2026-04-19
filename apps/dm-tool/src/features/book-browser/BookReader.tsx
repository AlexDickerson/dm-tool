import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, List, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { pdfjsLib } from '@/lib/pdfjs';
import { STORAGE_KEYS } from '@/lib/constants';
import { readNumber, readString, writeString } from '@/lib/storage-utils';
import { extractCover } from './useBooks';
import { partSubtitle, type ApGroup } from './ap-merge';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

/** A tagged outline node that knows which doc slot it belongs to. Used by
 *  the combined TOC so destination resolution targets the right PDF. */
interface TaggedOutlineNode extends OutlineNode {
  slotIndex: number;
  items: TaggedOutlineNode[];
}

interface ReaderProps {
  /** Single book mode — open one PDF. */
  bookId?: number;
  /** Merged AP mode — open all parts as one combined document. */
  apGroup?: ApGroup;
  onClose: () => void;
  /** Navigate back to catalog without closing the tab. Falls back to onClose. */
  onBack?: () => void;
  onIngestComplete?: () => void;
}

/** One document in a multi-doc view. */
interface DocSlot {
  bookId: number;
  partLabel: string;
  pageCount: number;
  globalPageOffset: number;
  doc: PDFDocumentProxy | null;
  outline: OutlineNode[];
}

// ---------------------------------------------------------------------------
// Zoom presets
// ---------------------------------------------------------------------------

type ZoomPreset = 'fit-width' | 'fit-page' | '100' | '150' | '200';

const ZOOM_PRESETS: Array<{ label: string; value: ZoomPreset }> = [
  { label: 'Fit Width', value: 'fit-width' },
  { label: 'Fit Page', value: 'fit-page' },
  { label: '100%', value: '100' },
  { label: '150%', value: '150' },
  { label: '200%', value: '200' },
];

function resolveScale(
  preset: ZoomPreset,
  containerWidth: number,
  containerHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  switch (preset) {
    case 'fit-width':
      return containerWidth / pageWidth;
    case 'fit-page':
      return Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
    case '100':
      return 1;
    case '150':
      return 1.5;
    case '200':
      return 2;
  }
}

const PAGE_GAP = 8;
const SEPARATOR_HEIGHT = 48;

// ---------------------------------------------------------------------------
// localStorage helpers for reader preferences
// ---------------------------------------------------------------------------

function loadZoom(): ZoomPreset {
  const v = readString(STORAGE_KEYS.readerZoom);
  if (v && ZOOM_PRESETS.some((p) => p.value === v)) return v as ZoomPreset;
  return 'fit-width';
}

function saveZoom(z: ZoomPreset) {
  writeString(STORAGE_KEYS.readerZoom, z);
}

/** Stable key for scroll position: single book uses the bookId, merged
 *  APs use "ap-<subcategory>". */
function scrollKey(bookId?: number, apGroup?: ApGroup): string | null {
  if (apGroup) return `${STORAGE_KEYS.readerScrollPrefix}ap-${apGroup.subcategory}`;
  if (bookId != null) return `${STORAGE_KEYS.readerScrollPrefix}${bookId}`;
  return null;
}

function loadScroll(key: string | null): number {
  if (!key) return 0;
  return readNumber(key, 0);
}

function saveScroll(key: string | null, top: number) {
  if (!key) return;
  writeString(key, String(Math.round(top)));
}

// ---------------------------------------------------------------------------
// Main reader component
// ---------------------------------------------------------------------------

export function BookReader({ bookId, apGroup, onClose, onBack, onIngestComplete }: ReaderProps) {
  const isMulti = !!apGroup;
  const [title, setTitle] = useState('');
  const [totalPages, setTotalPages] = useState(0);
  const [slots, setSlots] = useState<DocSlot[]>([]);
  const slotsRef = useRef<DocSlot[]>([]);
  slotsRef.current = slots;
  const [tocOpen, setTocOpen] = useState(true);
  const [zoom, setZoom] = useState<ZoomPreset>(loadZoom);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputOpen, setPageInputOpen] = useState(false);

  // Destroy all loaded PDFDocumentProxy objects on unmount so they don't
  // leak memory across open/close cycles.
  useEffect(() => {
    return () => {
      for (const s of slotsRef.current) {
        if (s.doc) s.doc.destroy();
      }
    };
  }, []);

  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({
        width: el.clientWidth - 24,
        height: el.clientHeight,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Single-book mode
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (isMulti || bookId == null) return;
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    (async () => {
      try {
        const b = await api.booksGet(bookId);
        if (cancelled || !b) return;
        setTitle(b.title);

        const fileUrl = await api.booksGetFileUrl(bookId);
        if (cancelled) return;

        const task = pdfjsLib.getDocument({
          url: fileUrl,
          disableAutoFetch: true,
          disableStream: true,
        });
        loadingTask = task;
        const doc = await task.promise;
        if (cancelled) return;

        const page1 = await doc.getPage(1);
        if (cancelled) return;
        const vp = page1.getViewport({ scale: 1 });
        setPageSize({ width: vp.width, height: vp.height });

        const outline = ((await doc.getOutline()) as OutlineNode[]) ?? [];
        if (cancelled) return;

        setSlots([
          {
            bookId,
            partLabel: b.title,
            pageCount: doc.numPages,
            globalPageOffset: 0,
            doc,
            outline,
          },
        ]);
        setTotalPages(doc.numPages);

        if (!b.ingested) {
          extractCover(b.id).then(onIngestComplete).catch(console.error);
        }
      } catch (e) {
        console.error('[BookReader] single-doc load failed:', e);
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [bookId, isMulti]);

  // -----------------------------------------------------------------------
  // Multi-doc AP mode
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!isMulti || !apGroup) return;
    let cancelled = false;

    setTitle(apGroup.subcategory);

    (async () => {
      try {
        // Build initial slots from DB page counts. Parts without a page
        // count get loaded eagerly to read numPages (fast with disableAutoFetch).
        const parts = apGroup.parts;
        const initialSlots: DocSlot[] = [];
        let offset = 0;

        for (const p of parts) {
          let pageCount = p.book.pageCount ?? 0;
          let doc: PDFDocumentProxy | null = null;

          if (!pageCount) {
            // Need to load this doc to learn its page count.
            const url = await api.booksGetFileUrl(p.book.id);
            if (cancelled) return;
            const task = pdfjsLib.getDocument({
              url,
              disableAutoFetch: true,
              disableStream: true,
            });
            doc = await task.promise;
            if (cancelled) {
              doc.destroy();
              return;
            }
            pageCount = doc.numPages;
          }

          initialSlots.push({
            bookId: p.book.id,
            partLabel: `Part ${p.partNumber} — ${partSubtitle(p.book.title)}`,
            pageCount,
            globalPageOffset: offset,
            doc,
            outline: [],
          });
          offset += pageCount;
        }
        if (cancelled) return;

        setSlots(initialSlots);
        setTotalPages(offset);

        // Read page size from first available doc.
        let firstDoc = initialSlots.find((s) => s.doc)?.doc;
        if (!firstDoc) {
          const url = await api.booksGetFileUrl(initialSlots[0]!.bookId);
          if (cancelled) return;
          const task = pdfjsLib.getDocument({
            url,
            disableAutoFetch: true,
            disableStream: true,
          });
          firstDoc = await task.promise;
          if (cancelled) {
            firstDoc.destroy();
            return;
          }
          initialSlots[0]!.doc = firstDoc;
          setSlots([...initialSlots]);
        }

        const page1 = await firstDoc.getPage(1);
        if (cancelled) return;
        const vp = page1.getViewport({ scale: 1 });
        setPageSize({ width: vp.width, height: vp.height });

        // Load outlines for docs we already have open.
        for (const s of initialSlots) {
          if (s.doc && cancelled) return;
          if (s.doc) {
            s.outline = ((await s.doc.getOutline()) as OutlineNode[]) ?? [];
          }
        }
        if (!cancelled) setSlots([...initialSlots]);

        // Ingest any un-ingested parts.
        for (const p of parts) {
          if (cancelled) break;
          if (!p.book.ingested) {
            extractCover(p.book.id).catch(console.error);
          }
        }
        onIngestComplete?.();
      } catch (e) {
        console.error('[BookReader] multi-doc load failed:', e);
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apGroup, isMulti]);

  // Lazy-load a doc when the user scrolls near it (called by PageSlot).
  // Uses slotsRef to avoid closing over a stale `slots` array, which
  // would make this callback recreate on every slots change and cause
  // unnecessary PageSlot re-renders.
  const loadSlotDoc = useCallback(async (slotIndex: number) => {
    const current = slotsRef.current[slotIndex];
    if (!current || current.doc) return current?.doc ?? null;

    const url = await api.booksGetFileUrl(current.bookId);
    const task = pdfjsLib.getDocument({
      url,
      disableAutoFetch: true,
      disableStream: true,
    });
    const doc = await task.promise;
    const outline = ((await doc.getOutline()) as OutlineNode[]) ?? [];

    setSlots((prev) => {
      const next = [...prev];
      const slot = next[slotIndex];
      if (slot && !slot.doc) {
        next[slotIndex] = { ...slot, doc, outline };
      }
      return next;
    });

    return doc;
  }, []);

  // Persist zoom preference.
  useEffect(() => {
    saveZoom(zoom);
  }, [zoom]);

  // Computed scale.
  const scale = useMemo(() => {
    if (!pageSize) return 1;
    return resolveScale(zoom, containerSize.width, containerSize.height, pageSize.width, pageSize.height);
  }, [zoom, pageSize, containerSize]);

  const pageHeight = pageSize ? Math.round(pageSize.height * scale) : 0;

  // Precompute the scroll-top offset of each slot's first page using the
  // same running-counter algorithm the page list layout uses. This is the
  // single source of truth for both rendering and TOC navigation — no
  // independent formula that could drift.
  const slotTopOffsets = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (let si = 0; si < slots.length; si++) {
      if (si > 0) y += SEPARATOR_HEIGHT;
      offsets.push(y);
      y += slots[si]!.pageCount * (pageHeight + PAGE_GAP);
    }
    return offsets;
  }, [slots, pageHeight]);

  // Combined outline for the TOC sidebar.
  const combinedOutline = useMemo((): TaggedOutlineNode[] => {
    if (slots.length === 1 && slots[0]?.outline.length) {
      return tagNodes(slots[0].outline, 0);
    }
    const nodes: TaggedOutlineNode[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      nodes.push({
        title: s.partLabel,
        dest: null,
        items: tagNodes(s.outline, i),
        slotIndex: i,
      });
    }
    return nodes;
  }, [slots]);

  // Resolve a TOC destination to an exact scroll position using the
  // precomputed slot offsets — no independent formula.
  const slotTopOffsetsRef = useRef(slotTopOffsets);
  slotTopOffsetsRef.current = slotTopOffsets;
  const pageHeightRef = useRef(pageHeight);
  pageHeightRef.current = pageHeight;

  // -----------------------------------------------------------------------
  // Current page tracking + scroll position save/restore
  // -----------------------------------------------------------------------
  const sKey = scrollKey(bookId, apGroup);

  // Derive current 1-based page number from scroll position.
  const computeCurrentPage = useCallback(
    (scrollTop: number) => {
      if (!pageHeight || slots.length === 0) return 1;
      for (let si = slots.length - 1; si >= 0; si--) {
        const slotTop = slotTopOffsets[si] ?? 0;
        if (scrollTop >= slotTop) {
          const local = Math.floor((scrollTop - slotTop) / (pageHeight + PAGE_GAP));
          const globalOffset = slots[si]!.globalPageOffset;
          return Math.min(globalOffset + local + 1, totalPages);
        }
      }
      return 1;
    },
    [slots, slotTopOffsets, pageHeight, totalPages],
  );

  // Track scroll → update current page + debounced save.
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      setCurrentPage(computeCurrentPage(el.scrollTop));
      // Debounce the localStorage write.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveScroll(sKey, el.scrollTop);
      }, 300);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [computeCurrentPage, sKey]);

  // Restore saved scroll position once pages are laid out.
  // Guard: el.clientHeight === 0 when the tab is hidden (display:none),
  // so setting scrollTop is a no-op. Defer until the tab becomes visible
  // (ResizeObserver will trigger a containerSize → pageHeight change).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !pageHeight || slots.length === 0) return;
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const saved = loadScroll(sKey);
    if (saved > 0) {
      el.scrollTop = saved;
      setCurrentPage(computeCurrentPage(saved));
    }
    restoredRef.current = true;
  }, [pageHeight, slots, sKey, computeCurrentPage, containerSize]);

  // Jump to a specific 1-based page number.
  const jumpToPage = useCallback(
    (page: number) => {
      const el = scrollRef.current;
      if (!el || !pageHeight || slots.length === 0) return;
      const clamped = Math.max(1, Math.min(page, totalPages));
      // Find which slot this page belongs to.
      let targetTop = 0;
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si]!;
        const slotEnd = slot.globalPageOffset + slot.pageCount;
        if (clamped <= slotEnd) {
          const local = clamped - 1 - slot.globalPageOffset;
          targetTop = (slotTopOffsets[si] ?? 0) + local * (pageHeight + PAGE_GAP);
          break;
        }
      }
      el.scrollTop = targetTop;
    },
    [slots, slotTopOffsets, pageHeight, totalPages],
  );

  const resolveDest = useCallback(
    async (dest: string | unknown[] | null, slotIndex: number): Promise<number | null> => {
      const offsets = slotTopOffsetsRef.current;
      const ph = pageHeightRef.current;
      const slotTop = offsets[slotIndex];
      if (slotTop == null || !ph) return null;
      const slot = slotsRef.current[slotIndex];
      if (!slot) return null;

      if (!dest) return slotTop;

      let doc = slot.doc;
      if (!doc) {
        doc = await loadSlotDoc(slotIndex);
        if (!doc) return null;
      }

      let resolved: unknown[] | null = null;
      if (typeof dest === 'string') {
        resolved = await doc.getDestination(dest);
      } else if (Array.isArray(dest)) {
        resolved = dest;
      }
      if (!resolved || resolved.length === 0) return null;

      const localPageIndex = await doc.getPageIndex(resolved[0] as { num: number; gen: number });
      return slotTop + localPageIndex * (ph + PAGE_GAP);
    },
    [loadSlotDoc],
  );

  // Keyboard shortcuts.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't capture keys when the page-number input is focused.
      if (pageInputOpen) return;
      const el = scrollRef.current;
      if (!el) return;
      const ph = pageHeightRef.current;
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          cycleZoom(1, zoom, setZoom);
          break;
        case '-':
          e.preventDefault();
          cycleZoom(-1, zoom, setZoom);
          break;
        case '0':
          e.preventDefault();
          setZoom('fit-width');
          break;
        case 'Home':
          e.preventDefault();
          el.scrollTop = 0;
          break;
        case 'End':
          e.preventDefault();
          el.scrollTop = el.scrollHeight;
          break;
        case 'PageDown':
          e.preventDefault();
          if (ph) el.scrollTop += ph + PAGE_GAP;
          break;
        case 'PageUp':
          e.preventDefault();
          if (ph) el.scrollTop -= ph + PAGE_GAP;
          break;
      }
    },
    [zoom, pageInputOpen],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">This PDF could not be opened.</p>
        <p className="max-w-md text-xs text-muted-foreground">
          The file may be corrupted, password-protected, or not a standard PDF. Common with pregenerated character
          sheets and form-fillable documents.
        </p>
        <p className="max-w-md text-[10px] font-mono text-muted-foreground/60 break-all">{error}</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to catalog
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button variant="ghost" size="sm" onClick={onBack ?? onClose} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-xs">Catalog</span>
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <span className="truncate text-xs font-medium">{title || 'Loading…'}</span>
        {totalPages > 0 && (
          <PageIndicator
            currentPage={currentPage}
            totalPages={totalPages}
            isMulti={isMulti}
            slotCount={slots.length}
            open={pageInputOpen}
            onOpenChange={setPageInputOpen}
            onJump={jumpToPage}
          />
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Toggle table of contents"
            onClick={() => setTocOpen((v) => !v)}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-5" />
          {ZOOM_PRESETS.map((z) => (
            <button
              key={z.value}
              type="button"
              onClick={() => setZoom(z.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                zoom === z.value ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {z.label}
            </button>
          ))}
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Zoom out"
            onClick={() => cycleZoom(-1, zoom, setZoom)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Zoom in"
            onClick={() => cycleZoom(1, zoom, setZoom)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Reset zoom"
            onClick={() => setZoom('fit-width')}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content: TOC sidebar + page area */}
      <div className="flex min-h-0 flex-1">
        {tocOpen && combinedOutline.length > 0 && (
          <div className="w-64 shrink-0 border-r border-border">
            <ScrollArea className="h-full">
              <div className="p-2">
                <TocTree nodes={combinedOutline} resolveDest={resolveDest} scrollRef={scrollRef} />
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Page scroll container — double-click toggles between
            fit-width and 100% for quick switching between reading
            and inspecting art/maps. */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-muted/30"
          style={{ outline: 'none' }}
          onDoubleClick={() => setZoom((z) => (z === 'fit-width' ? '100' : 'fit-width'))}
        >
          {slots.length > 0 && pageSize ? (
            <MultiDocPageList
              slots={slots}
              slotTopOffsets={slotTopOffsets}
              pageHeight={pageHeight}
              pageWidth={Math.round(pageSize.width * scale)}
              scale={scale}
              loadSlotDoc={loadSlotDoc}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading PDF…</div>
          )}
        </div>

        <div data-slot="reader-sidebar" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-doc page list
// ---------------------------------------------------------------------------

function MultiDocPageList({
  slots,
  slotTopOffsets,
  pageHeight,
  pageWidth,
  scale,
  loadSlotDoc,
}: {
  slots: DocSlot[];
  /** Precomputed scroll-top of each slot's first page — shared with the
   *  TOC resolver so both use identical positions. */
  slotTopOffsets: number[];
  pageHeight: number;
  pageWidth: number;
  scale: number;
  loadSlotDoc: (idx: number) => Promise<PDFDocumentProxy | null>;
}) {
  // Build a flat list of renderable items (pages + separators) using the
  // same slotTopOffsets the TOC resolver uses.
  const items = useMemo(() => {
    const list: Array<
      | { kind: 'page'; slotIndex: number; localPageNum: number; top: number }
      | { kind: 'separator'; label: string; top: number }
    > = [];
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!;
      const slotTop = slotTopOffsets[si] ?? 0;
      if (si > 0) {
        list.push({
          kind: 'separator',
          label: slot.partLabel,
          top: slotTop - SEPARATOR_HEIGHT,
        });
      }
      for (let p = 0; p < slot.pageCount; p++) {
        list.push({
          kind: 'page',
          slotIndex: si,
          localPageNum: p + 1,
          top: slotTop + p * (pageHeight + PAGE_GAP),
        });
      }
    }
    return list;
  }, [slots, slotTopOffsets, pageHeight]);

  // Total height from the last item's bottom edge.
  const lastItem = items[items.length - 1];
  const totalHeight = lastItem ? lastItem.top + (lastItem.kind === 'page' ? pageHeight : SEPARATOR_HEIGHT) : 0;

  return (
    <div
      style={{
        position: 'relative',
        width: pageWidth,
        height: totalHeight,
        margin: '0 auto',
        paddingTop: PAGE_GAP,
      }}
    >
      {items.map((item, i) =>
        item.kind === 'separator' ? (
          <div
            key={`sep-${i}`}
            style={{
              position: 'absolute',
              top: item.top,
              left: 0,
              width: pageWidth,
              height: SEPARATOR_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="h-px w-12 bg-border" />
              <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              <div className="h-px w-12 bg-border" />
            </div>
          </div>
        ) : (
          <PageSlot
            key={`${item.slotIndex}-${item.localPageNum}`}
            slots={slots}
            slotIndex={item.slotIndex}
            localPageNum={item.localPageNum}
            width={pageWidth}
            height={pageHeight}
            scale={scale}
            top={item.top}
            loadSlotDoc={loadSlotDoc}
          />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page slot — renders canvas + text layer when visible
// ---------------------------------------------------------------------------

function PageSlot({
  slots,
  slotIndex,
  localPageNum,
  width,
  height,
  scale,
  top,
  loadSlotDoc,
}: {
  slots: DocSlot[];
  slotIndex: number;
  localPageNum: number;
  width: number;
  height: number;
  scale: number;
  top: number;
  loadSlotDoc: (idx: number) => Promise<PDFDocumentProxy | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const renderingRef = useRef(false);
  const renderedScaleRef = useRef<number | null>(null);

  const doc = slots[slotIndex]?.doc ?? null;

  // IntersectionObserver with 1-page margin.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting), {
      rootMargin: `${height}px 0px ${height}px 0px`,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [height]);

  // Trigger lazy doc loading when this page becomes visible.
  useEffect(() => {
    if (visible && !doc) {
      loadSlotDoc(slotIndex).catch(console.error);
    }
  }, [visible, doc, slotIndex, loadSlotDoc]);

  // Render when visible + doc loaded + scale changed.
  useEffect(() => {
    if (!visible || !doc) return;
    if (renderingRef.current) return;
    if (renderedScaleRef.current === scale) return;

    let cancelled = false;
    renderingRef.current = true;

    (async () => {
      try {
        const page = await doc.getPage(localPageNum);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        renderedScaleRef.current = scale;

        const textDiv = textLayerRef.current;
        if (!textDiv || cancelled) return;
        textDiv.innerHTML = '';
        // pdfjs TextLayer uses the CSS variable --scale-factor to compute
        // span transforms. Without it, the text spans drift from the canvas.
        // See: https://github.com/mozilla/pdf.js/discussions/18068
        textDiv.style.setProperty('--scale-factor', String(scale));
        textDiv.style.width = `${viewport.width}px`;
        textDiv.style.height = `${viewport.height}px`;

        const { TextLayer } = pdfjsLib;
        const textContent = await page.getTextContent();
        if (cancelled) return;

        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        });
        await textLayer.render();
      } catch (e) {
        if (!cancelled) console.error(`Page render error:`, e);
      } finally {
        renderingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, scale, doc, localPageNum]);

  // Cleanup on scroll-out.
  useEffect(() => {
    if (visible) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
    const textDiv = textLayerRef.current;
    if (textDiv) textDiv.innerHTML = '';
    renderedScaleRef.current = null;
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top,
        left: 0,
        width,
        height,
        background: doc ? 'white' : undefined,
        boxShadow: doc ? '0 1px 4px rgba(0,0,0,0.15)' : undefined,
      }}
    >
      {doc ? (
        <>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
          <div ref={textLayerRef} className="textLayer" />
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOC tree — uses a resolveDest callback for cross-doc navigation
// ---------------------------------------------------------------------------

function TocTree({
  nodes,
  resolveDest,
  scrollRef,
}: {
  nodes: TaggedOutlineNode[];
  resolveDest: (dest: string | unknown[] | null, slotIndex: number) => Promise<number | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <ul className="space-y-0.5 text-xs">
      {nodes.map((node, i) => (
        <TocNode key={i} node={node} resolveDest={resolveDest} scrollRef={scrollRef} depth={0} />
      ))}
    </ul>
  );
}

function TocNode({
  node,
  resolveDest,
  scrollRef,
  depth,
}: {
  node: TaggedOutlineNode;
  resolveDest: (dest: string | unknown[] | null, slotIndex: number) => Promise<number | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.items && node.items.length > 0;

  const handleClick = useCallback(async () => {
    if (!scrollRef.current) return;
    const top = await resolveDest(node.dest, node.slotIndex);
    if (top != null) {
      scrollRef.current.scrollTop = top;
    }
  }, [node.dest, node.slotIndex, resolveDest, scrollRef]);

  return (
    <li>
      <div className="flex items-start">
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            'flex-1 truncate py-0.5 text-left transition-colors hover:text-foreground',
            depth === 0 && node.items.length > 0 ? 'font-medium text-foreground/80' : 'text-muted-foreground',
          )}
          style={{ paddingLeft: depth * 8 }}
          title={cleanTocTitle(node.title)}
        >
          {cleanTocTitle(node.title)}
        </button>
      </div>
      {expanded && hasChildren && (
        <ul className="ml-2">
          {node.items.map((child, i) => (
            <TocNode key={i} node={child} resolveDest={resolveDest} scrollRef={scrollRef} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page indicator — shows "Page N / M", click to open jump-to-page input
// ---------------------------------------------------------------------------

function PageIndicator({
  currentPage,
  totalPages,
  isMulti,
  slotCount,
  open,
  onOpenChange,
  onJump,
}: {
  currentPage: number;
  totalPages: number;
  isMulti: boolean;
  slotCount: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onJump: (page: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (open) {
      setInputValue(String(currentPage));
      // Focus after React renders the input.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, currentPage]);

  const handleSubmit = () => {
    const n = parseInt(inputValue, 10);
    if (Number.isFinite(n)) onJump(n);
    onOpenChange(false);
  };

  if (open) {
    return (
      <span className="flex items-center gap-1 text-[10px]">
        <span className="text-muted-foreground">Page</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onOpenChange(false);
            e.stopPropagation(); // don't trigger reader shortcuts
          }}
          onBlur={handleSubmit}
          className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-[10px] text-foreground outline-hidden focus:border-primary"
        />
        <span className="text-muted-foreground">/ {totalPages}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenChange(true)}
      className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      title="Click to jump to a page"
    >
      Page {currentPage} / {totalPages}
      {isMulti && ` · ${slotCount} parts`}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip Paizo bookmark noise from TOC titles. Common patterns:
 *    "018-031 PZO90152 Chapter 2" → "Chapter 2"
 *    "032 PZO90152 Appendix" → "Appendix"
 *    "PZO9015-2 Introduction" → "Introduction"
 *  Leading page ranges (\d+-\d+ or \d+), product codes (PZO\w+), and
 *  resulting whitespace are removed. */
function cleanTocTitle(raw: string): string {
  return (
    raw
      .replace(/^\d+(?:-\d+)?\s*/g, '') // leading page range "018-031 " or "032 "
      .replace(/^PZO[\w-]+\s*/gi, '') // product code "PZO90152 "
      .trim() || raw
  ); // fall back to original if nothing remains
}

function tagNodes(nodes: OutlineNode[], slotIndex: number): TaggedOutlineNode[] {
  return nodes.map((n) => ({
    ...n,
    slotIndex,
    items: tagNodes(n.items ?? [], slotIndex),
  }));
}

function cycleZoom(dir: 1 | -1, current: ZoomPreset, set: (v: ZoomPreset) => void) {
  const idx = ZOOM_PRESETS.findIndex((p) => p.value === current);
  const next = idx + dir;
  if (next >= 0 && next < ZOOM_PRESETS.length) {
    set(ZOOM_PRESETS[next]!.value);
  }
}
