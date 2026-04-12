import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ChevronRight,
  List,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { pdfjsLib } from "@/lib/pdfjs";
import type { Book } from "@shared/types";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

interface ReaderProps {
  bookId: number;
  onClose: () => void;
  /** Called after phase-2 ingest completes so the catalog can refresh its
   *  cover images and page counts. */
  onIngestComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Zoom presets
// ---------------------------------------------------------------------------

type ZoomPreset = "fit-width" | "fit-page" | "100" | "150" | "200";

const ZOOM_PRESETS: Array<{ label: string; value: ZoomPreset }> = [
  { label: "Fit Width", value: "fit-width" },
  { label: "Fit Page", value: "fit-page" },
  { label: "100%", value: "100" },
  { label: "150%", value: "150" },
  { label: "200%", value: "200" },
];

/** Convert a ZoomPreset + container dimensions + page dimensions to a
 *  CSS-pixel scale factor. */
function resolveScale(
  preset: ZoomPreset,
  containerWidth: number,
  containerHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  switch (preset) {
    case "fit-width":
      return containerWidth / pageWidth;
    case "fit-page":
      return Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
    case "100":
      return 1;
    case "150":
      return 1.5;
    case "200":
      return 2;
  }
}

// ---------------------------------------------------------------------------
// Main reader component
// ---------------------------------------------------------------------------

export function BookReader({ bookId, onClose, onIngestComplete }: ReaderProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [tocOpen, setTocOpen] = useState(true);
  const [zoom, setZoom] = useState<ZoomPreset>("fit-width");
  const [error, setError] = useState<string | null>(null);

  // Page geometry: we read the first page's dimensions once and assume all
  // pages are the same size. Good enough for standard PDFs; mixed-size
  // pages would need per-page measurement but that's rare for RPG books.
  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerSizeRef = useRef({ width: 800, height: 600 });

  // Track container size for zoom calculations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      containerSizeRef.current = {
        width: el.clientWidth - 24, // subtract padding
        height: el.clientHeight,
      };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load book metadata + open PDF document.
  useEffect(() => {
    let cancelled = false;
    const loadingTask = { current: null as ReturnType<typeof pdfjsLib.getDocument> | null };

    (async () => {
      try {
        const b = await api.booksGet(bookId);
        if (cancelled || !b) return;
        setBook(b);

        const fileUrl = await api.booksGetFileUrl(bookId);
        if (cancelled) return;

        const task = pdfjsLib.getDocument({
          url: fileUrl,
          // Disable auto-fetch and streaming to reduce memory pressure —
          // the protocol handler supports range requests, so pdfjs will
          // pull chunks on demand as the user scrolls.
          disableAutoFetch: true,
          disableStream: true,
        });
        loadingTask.current = task;
        const pdfDoc = await task.promise;
        if (cancelled) return;
        setDoc(pdfDoc);

        // Read first page size.
        const page1 = await pdfDoc.getPage(1);
        if (cancelled) return;
        const vp = page1.getViewport({ scale: 1 });
        setPageSize({ width: vp.width, height: vp.height });

        // Load outline (TOC).
        const raw = await pdfDoc.getOutline();
        if (cancelled) return;
        setOutline((raw as OutlineNode[]) ?? []);

        // Phase-2 ingest: extract cover if not already done.
        if (!b.ingested) {
          runIngest(pdfDoc, b.id, onIngestComplete).catch(console.error);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      loadingTask.current?.destroy();
    };
    // Intentionally re-run only on bookId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Computed scale based on zoom preset + container + page dims.
  const scale = useMemo(() => {
    if (!pageSize) return 1;
    const c = containerSizeRef.current;
    return resolveScale(zoom, c.width, c.height, pageSize.width, pageSize.height);
  }, [zoom, pageSize]);

  const numPages = doc?.numPages ?? 0;

  // Keyboard shortcuts. Attached to the reader root div.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          cycleZoom(1, zoom, setZoom);
          break;
        case "-":
          e.preventDefault();
          cycleZoom(-1, zoom, setZoom);
          break;
        case "0":
          e.preventDefault();
          setZoom("fit-width");
          break;
        case "Home":
          e.preventDefault();
          el.scrollTop = 0;
          break;
        case "End":
          e.preventDefault();
          el.scrollTop = el.scrollHeight;
          break;
        case "ArrowDown":
        case "PageDown":
          // Let native scroll handle it.
          break;
        case "ArrowUp":
        case "PageUp":
          break;
      }
    },
    [zoom],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">Failed to open book: {error}</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to catalog
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-xs">Catalog</span>
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <span className="truncate text-xs font-medium">
          {book?.title ?? "Loading…"}
        </span>
        {numPages > 0 && (
          <span className="text-[10px] text-muted-foreground">
            ({numPages} pages)
          </span>
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
                "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                zoom === z.value
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50",
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
            title="Zoom out (−)"
            onClick={() => cycleZoom(-1, zoom, setZoom)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Zoom in (+)"
            onClick={() => cycleZoom(1, zoom, setZoom)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Reset zoom (0)"
            onClick={() => setZoom("fit-width")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content: TOC sidebar + page area */}
      <div className="flex min-h-0 flex-1">
        {tocOpen && outline.length > 0 && (
          <div className="w-64 shrink-0 border-r border-border">
            <ScrollArea className="h-full">
              <div className="p-2">
                <TocTree
                  nodes={outline}
                  doc={doc}
                  scrollRef={scrollRef}
                  pageSize={pageSize}
                  scale={scale}
                />
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Page scroll container */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-muted/30"
          style={{ outline: "none" }}
        >
          {doc && pageSize ? (
            <PageList
              doc={doc}
              numPages={numPages}
              pageSize={pageSize}
              scale={scale}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading PDF…
            </div>
          )}
        </div>

        {/* Right-side placeholder for future sidebar panels */}
        <div data-slot="reader-sidebar" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase-2 ingest: render cover + send to main
// ---------------------------------------------------------------------------

async function runIngest(
  doc: PDFDocumentProxy,
  bookId: number,
  onComplete?: () => void,
): Promise<void> {
  const page = await doc.getPage(1);
  const COVER_WIDTH = 300;
  const vp = page.getViewport({ scale: 1 });
  const scale = COVER_WIDTH / vp.width;
  const scaledVp = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaledVp.width;
  canvas.height = scaledVp.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return;
  const buf = new Uint8Array(await blob.arrayBuffer());

  await api.booksFinalizeIngest({
    id: bookId,
    pageCount: doc.numPages,
    coverPngBytes: buf,
  });
  onComplete?.();
}

// ---------------------------------------------------------------------------
// Page list — renders visible pages ± 1 with an IntersectionObserver
// ---------------------------------------------------------------------------

function PageList({
  doc,
  numPages,
  pageSize,
  scale,
}: {
  doc: PDFDocumentProxy;
  numPages: number;
  pageSize: { width: number; height: number };
  scale: number;
}) {
  const pageWidth = Math.round(pageSize.width * scale);
  const pageHeight = Math.round(pageSize.height * scale);
  const gap = 8;
  const totalHeight = numPages * (pageHeight + gap) - gap;

  return (
    <div
      style={{
        position: "relative",
        width: pageWidth,
        height: totalHeight,
        margin: "0 auto",
        paddingTop: gap,
      }}
    >
      {Array.from({ length: numPages }, (_, i) => (
        <PageSlot
          key={i}
          doc={doc}
          pageNum={i + 1}
          width={pageWidth}
          height={pageHeight}
          scale={scale}
          top={i * (pageHeight + gap)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual page slot: renders canvas + text layer when visible
// ---------------------------------------------------------------------------

function PageSlot({
  doc,
  pageNum,
  width,
  height,
  scale,
  top,
}: {
  doc: PDFDocumentProxy;
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  top: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const renderingRef = useRef(false);
  const renderedScaleRef = useRef<number | null>(null);

  // IntersectionObserver with 1-page margin for preloading neighbours.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry!.isIntersecting),
      { rootMargin: `${height}px 0px ${height}px 0px` },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [height]);

  // Render when visible (or when scale changes while visible).
  useEffect(() => {
    if (!visible) return;
    if (renderingRef.current) return;
    if (renderedScaleRef.current === scale) return;

    let cancelled = false;
    renderingRef.current = true;

    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        // Use devicePixelRatio for crisp rendering on HiDPI displays.
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        renderedScaleRef.current = scale;

        // Text layer — enables browser-native Ctrl+F and text selection.
        const textDiv = textLayerRef.current;
        if (!textDiv || cancelled) return;
        textDiv.innerHTML = "";
        // Set the text layer container dimensions to match the viewport
        // so pdfjs can position text spans correctly.
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
        if (!cancelled) console.error(`Page ${pageNum} render error:`, e);
      } finally {
        renderingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, scale, doc, pageNum]);

  // Cleanup: clear canvas when page scrolls out of view to release memory.
  useEffect(() => {
    if (visible) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
    const textDiv = textLayerRef.current;
    if (textDiv) textDiv.innerHTML = "";
    renderedScaleRef.current = null;
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top,
        left: 0,
        width,
        height,
        background: "white",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          // pdfjs TextLayer CSS must be loaded for text positioning to work.
          // We inject the necessary styles in index.css.
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOC tree
// ---------------------------------------------------------------------------

function TocTree({
  nodes,
  doc,
  scrollRef,
  pageSize,
  scale,
}: {
  nodes: OutlineNode[];
  doc: PDFDocumentProxy | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pageSize: { width: number; height: number } | null;
  scale: number;
}) {
  return (
    <ul className="space-y-0.5 text-xs">
      {nodes.map((node, i) => (
        <TocNode
          key={i}
          node={node}
          doc={doc}
          scrollRef={scrollRef}
          pageSize={pageSize}
          scale={scale}
          depth={0}
        />
      ))}
    </ul>
  );
}

function TocNode({
  node,
  doc,
  scrollRef,
  pageSize,
  scale,
  depth,
}: {
  node: OutlineNode;
  doc: PDFDocumentProxy | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pageSize: { width: number; height: number } | null;
  scale: number;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.items && node.items.length > 0;

  const handleClick = useCallback(async () => {
    if (!doc || !scrollRef.current || !pageSize || !node.dest) return;
    try {
      let dest: unknown[] | null = null;
      if (typeof node.dest === "string") {
        dest = await doc.getDestination(node.dest);
      } else if (Array.isArray(node.dest)) {
        dest = node.dest as unknown[];
      }
      if (!dest || dest.length === 0) return;
      // dest[0] is a page reference object that getPageIndex can resolve.
      const pageIndex = await doc.getPageIndex(
        dest[0] as { num: number; gen: number },
      );
      const gap = 8;
      const pageHeight = Math.round(pageSize.height * scale);
      const targetTop = pageIndex * (pageHeight + gap);
      scrollRef.current.scrollTop = targetTop;
    } catch (e) {
      console.error("TOC navigation error:", e);
    }
  }, [doc, node.dest, scrollRef, pageSize, scale]);

  return (
    <li>
      <div className="flex items-start">
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={handleClick}
          className="flex-1 truncate py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground"
          style={{ paddingLeft: depth * 8 }}
          title={node.title}
        >
          {node.title}
        </button>
      </div>
      {expanded && hasChildren && (
        <ul className="ml-2">
          {node.items.map((child, i) => (
            <TocNode
              key={i}
              node={child}
              doc={doc}
              scrollRef={scrollRef}
              pageSize={pageSize}
              scale={scale}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cycleZoom(
  dir: 1 | -1,
  current: ZoomPreset,
  set: (v: ZoomPreset) => void,
) {
  const idx = ZOOM_PRESETS.findIndex((p) => p.value === current);
  const next = idx + dir;
  if (next >= 0 && next < ZOOM_PRESETS.length) {
    set(ZOOM_PRESETS[next]!.value);
  }
}
