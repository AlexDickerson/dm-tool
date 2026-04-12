import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Library, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useBookList, useBookScan } from "./useBooks";
import { BookReader } from "./BookReader";
import type { Book } from "@shared/types";

/** Top-level book browser. Manages state across the category rail, catalog
 *  grid, and reader. When no book is selected the grid fills the main area;
 *  clicking a card pushes the reader view, and a back button returns to the
 *  catalog. Single-window, no new BrowserWindow. */
export function BookBrowser() {
  const { data: books, loading, error, refetch } = useBookList();
  const { scan, scanning } = useBookScan();
  const [filter, setFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [openBookId, setOpenBookId] = useState<number | null>(null);

  const handleRescan = useCallback(async () => {
    await scan();
    refetch();
  }, [scan, refetch]);

  // Group books by category for the left rail.
  const categories = useMemo(() => {
    if (!books) return [];
    const map = new Map<string, { sub: Map<string | null, Book[]> }>();
    for (const b of books) {
      let entry = map.get(b.category);
      if (!entry) {
        entry = { sub: new Map() };
        map.set(b.category, entry);
      }
      let list = entry.sub.get(b.subcategory);
      if (!list) {
        list = [];
        entry.sub.set(b.subcategory, list);
      }
      list.push(b);
    }
    return Array.from(map.entries()).map(([name, v]) => ({
      name,
      subcategories: Array.from(v.sub.entries()).map(([sub, bks]) => ({
        name: sub,
        books: bks,
      })),
      count: Array.from(v.sub.values()).reduce((n, bks) => n + bks.length, 0),
    }));
  }, [books]);

  // Filter books by category selection + text filter.
  const filtered = useMemo(() => {
    if (!books) return [];
    let list = books;
    if (selectedCategory) {
      list = list.filter((b) => b.category === selectedCategory);
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => b.title.toLowerCase().includes(q));
    }
    return list;
  }, [books, selectedCategory, filter]);

  // If a book is open, show the reader instead of the catalog.
  if (openBookId !== null) {
    return (
      <BookReader
        bookId={openBookId}
        onClose={() => setOpenBookId(null)}
        onIngestComplete={refetch}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Category rail */}
        <div className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
          <div className="flex h-12 items-center justify-between px-3">
            <span className="text-sm font-semibold text-foreground">
              Categories
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title="Rescan PDF folder"
              onClick={handleRescan}
              disabled={scanning}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", scanning && "animate-spin")}
              />
            </Button>
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="py-1">
              <CategoryItem
                name="All Books"
                count={books?.length ?? 0}
                active={selectedCategory === null}
                onClick={() => setSelectedCategory(null)}
              />
              {categories.map((cat) => (
                <CategoryGroup
                  key={cat.name}
                  category={cat}
                  active={selectedCategory === cat.name}
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === cat.name ? null : cat.name,
                    )
                  }
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main area: search bar + grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-border px-3 py-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by title…"
              className="max-w-sm"
            />
            <span className="text-xs text-muted-foreground">
              {loading && "Loading…"}
              {!loading && error && (
                <span className="text-destructive">Error: {error}</span>
              )}
              {!loading && !error && (
                <>
                  {filtered.length} book{filtered.length !== 1 ? "s" : ""}
                  {selectedCategory && (
                    <span className="ml-1 text-muted-foreground/70">
                      in {selectedCategory}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            {filtered.length === 0 && !loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Library className="h-8 w-8 opacity-50" />
                <span className="text-sm">
                  {error
                    ? "Could not load the book catalog."
                    : "No books match the current filter."}
                </span>
              </div>
            ) : (
              <BookGrid
                books={filtered}
                onSelect={(b) => setOpenBookId(b.id)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category rail components
// ---------------------------------------------------------------------------

function CategoryItem({
  name,
  count,
  active,
  onClick,
  indent = false,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
        indent && "pl-6",
        active
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="truncate">{name}</span>
      <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">
        {count}
      </span>
    </button>
  );
}

function CategoryGroup({
  category,
  active,
  onClick,
}: {
  category: {
    name: string;
    subcategories: Array<{ name: string | null; books: Book[] }>;
    count: number;
  };
  active: boolean;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSubs = category.subcategories.some((s) => s.name !== null);

  return (
    <div>
      <div className="flex items-center">
        {hasSubs && (
          <button
            type="button"
            className="flex h-6 w-5 items-center justify-center text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        )}
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex flex-1 items-center justify-between py-1.5 pr-3 text-left text-xs transition-colors",
            !hasSubs && "pl-3",
            active
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <span className="truncate">{category.name}</span>
          <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">
            {category.count}
          </span>
        </button>
      </div>
      {expanded &&
        hasSubs &&
        category.subcategories
          .filter((s) => s.name !== null)
          .map((s) => (
            <CategoryItem
              key={s.name}
              name={s.name!}
              count={s.books.length}
              active={false}
              onClick={onClick}
              indent
            />
          ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized book grid
// ---------------------------------------------------------------------------

const CARD_WIDTH = 160;
const CARD_HEIGHT = 240; // portrait aspect for book covers
const GAP = 12;

function BookGrid({
  books,
  onSelect,
}: {
  books: Book[];
  onSelect: (b: Book) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setColumnCount(Math.max(1, Math.floor((w + GAP) / (CARD_WIDTH + GAP))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(books.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 3,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      gap: `${GAP}px`,
    }),
    [columnCount],
  );

  return (
    <div ref={parentRef} className="h-full overflow-auto p-3">
      <div style={{ height: totalSize, position: "relative" }}>
        {virtualItems.map((vRow) => {
          const start = vRow.index * columnCount;
          const row = books.slice(start, start + columnCount);
          return (
            <div
              key={vRow.key}
              className="absolute left-0 right-0 grid"
              style={{
                ...gridStyle,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {row.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onClick={() => onSelect(book)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Book card
// ---------------------------------------------------------------------------

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  const [coverError, setCoverError] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    setCoverError(false);
    setCoverUrl(null);
    if (book.ingested) {
      api.booksGetCoverUrl(book.id).then(setCoverUrl).catch(() => {});
    }
  }, [book.id, book.ingested]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-all hover:border-primary/60"
      style={{ height: CARD_HEIGHT }}
      title={book.title}
    >
      {/* Cover area — fills most of the card height */}
      <div
        className="relative overflow-hidden bg-muted"
        style={{ height: CARD_HEIGHT - 46, width: "100%" }}
      >
        {coverUrl && !coverError ? (
          <img
            src={coverUrl}
            alt={book.title}
            loading="lazy"
            onError={() => setCoverError(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            className="transition-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
            <Library className="h-6 w-6 text-muted-foreground/40" />
            <span className="text-[9px] leading-tight text-muted-foreground/60">
              {book.ingested ? "Cover unavailable" : "Not yet opened"}
            </span>
          </div>
        )}

        {/* Ruleset badge */}
        {book.ruleset && (
          <div
            className={cn(
              "pointer-events-none absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase shadow-sm",
              book.ruleset === "remastered"
                ? "bg-primary/90 text-primary-foreground"
                : "bg-muted-foreground/80 text-background",
            )}
          >
            {book.ruleset === "remastered" ? "R" : "L"}
          </div>
        )}
      </div>

      {/* Title + page count */}
      <div className="flex flex-1 flex-col justify-center px-2">
        <div className="truncate text-xs font-medium leading-tight">
          {book.title}
        </div>
        {book.pageCount && (
          <div className="text-[10px] text-muted-foreground">
            {book.pageCount} pages
          </div>
        )}
      </div>
    </button>
  );
}
