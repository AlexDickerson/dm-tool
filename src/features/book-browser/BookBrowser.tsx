import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Library, Layers, RefreshCw } from 'lucide-react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useBackgroundIngest, useBookList, useBookScan } from './useBooks';
import { BookReader } from './BookReader';
import { groupAdventurePaths, apTotalPages, type ApGroup } from './ap-merge';
import type { Book } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CatalogEntry = { kind: 'book'; book: Book } | { kind: 'ap'; group: ApGroup } | { kind: 'section'; label: string };

type OpenTarget = { kind: 'book'; bookId: number } | { kind: 'ap'; group: ApGroup } | null;

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function BookBrowser({ keywords = '' }: { keywords?: string }) {
  const { data: books, loading, error, refetch } = useBookList();
  const { scan, scanning } = useBookScan();
  // Hook triggers background cover extraction — side-effect only.
  useBackgroundIngest(books, refetch);
  const filter = keywords;
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [openTarget, setOpenTarget] = useState<OpenTarget>(null);

  const handleRescan = useCallback(async () => {
    await scan();
    refetch();
  }, [scan, refetch]);

  // Split books into merged AP groups + everything else.
  const { apGroups, otherBooks } = useMemo(
    () => (books ? groupAdventurePaths(books) : { apGroups: [], otherBooks: [] }),
    [books],
  );

  // Group books by category for the left rail. For Adventure Paths, count
  // the number of AP groups (not individual PDFs) so the rail reads "8"
  // for 8 APs rather than "42" for all individual parts.
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
    const CATEGORY_ORDER = ['Rulebooks', 'Adventure Paths', 'Adventures', 'Lost Omens', 'Beginner Box'];
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        subcategories: Array.from(v.sub.entries()).map(([sub, bks]) => ({
          name: sub,
          books: bks,
        })),
        count:
          name === 'Adventure Paths'
            ? apGroups.length
            : Array.from(v.sub.values()).reduce((n, bks) => n + bks.length, 0),
      }))
      .sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.name);
        const bi = CATEGORY_ORDER.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
  }, [books, apGroups]);

  // Build catalog entries grouped by category with section dividers.
  const entries = useMemo((): CatalogEntry[] => {
    const q = filter.trim().toLowerCase();
    const out: CatalogEntry[] = [];

    // Collect entries per category, preserving CATEGORY_ORDER.
    const CATEGORY_ORDER = ['Rulebooks', 'Adventure Paths', 'Adventures', 'Lost Omens', 'Beginner Box'];

    // Group non-AP books by category.
    const byCat = new Map<string, Book[]>();
    for (const b of otherBooks) {
      if (selectedCategory && b.category !== selectedCategory) continue;
      if (selectedSubcategory && b.subcategory !== selectedSubcategory) continue;
      if (q && !b.title.toLowerCase().includes(q)) continue;
      let list = byCat.get(b.category);
      if (!list) {
        list = [];
        byCat.set(b.category, list);
      }
      list.push(b);
    }

    // Collect AP entries if they pass the filter.
    const apEntries: CatalogEntry[] = [];
    for (const g of apGroups) {
      if (selectedCategory && selectedCategory !== 'Adventure Paths') continue;
      if (selectedSubcategory && selectedSubcategory !== g.subcategory) continue;
      if (q && !g.subcategory.toLowerCase().includes(q)) continue;
      apEntries.push({ kind: 'ap', group: g });
      for (const s of g.supplements) {
        if (q && !s.title.toLowerCase().includes(q)) continue;
        apEntries.push({ kind: 'book', book: s });
      }
    }

    // Emit entries in category order with section headers.
    const allCats = new Set([...CATEGORY_ORDER, ...byCat.keys()]);
    if (apEntries.length > 0) allCats.add('Adventure Paths');
    const sorted = [...allCats].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (const cat of sorted) {
      const catEntries: CatalogEntry[] = [];
      if (cat === 'Adventure Paths') {
        catEntries.push(...apEntries);
      }
      const books = byCat.get(cat);
      if (books) {
        for (const b of books) catEntries.push({ kind: 'book', book: b });
      }
      if (catEntries.length === 0) continue;
      // Only show section headers when viewing "All Books" (no category filter).
      if (!selectedCategory) {
        out.push({ kind: 'section', label: cat });
      }
      out.push(...catEntries);
    }

    return out;
  }, [apGroups, otherBooks, selectedCategory, selectedSubcategory, filter]);

  // Open target → reader.
  if (openTarget) {
    if (openTarget.kind === 'ap') {
      return <BookReader apGroup={openTarget.group} onClose={() => setOpenTarget(null)} onIngestComplete={refetch} />;
    }
    return <BookReader bookId={openTarget.bookId} onClose={() => setOpenTarget(null)} onIngestComplete={refetch} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Category rail */}
        <ResizableSidebar storageKey="dmtool.sidebar.books">
          <div className="flex h-full flex-col border-r border-border bg-card">
            <div className="flex h-12 items-center justify-between px-3">
              <span className="text-sm text-foreground" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
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
                <RefreshCw className={cn('h-3.5 w-3.5', scanning && 'animate-spin')} />
              </Button>
            </div>
            <Separator variant="ornate" />
            <ScrollArea className="flex-1">
              <div className="py-1">
                <CategoryItem
                  name="All Books"
                  count={apGroups.length + apGroups.reduce((n, g) => n + g.supplements.length, 0) + otherBooks.length}
                  active={selectedCategory === null}
                  onClick={() => {
                    setSelectedCategory(null);
                    setSelectedSubcategory(null);
                  }}
                />
                {categories.map((cat) => (
                  <CategoryGroup
                    key={cat.name}
                    category={cat}
                    activeCategory={selectedCategory}
                    activeSubcategory={selectedSubcategory}
                    onSelectCategory={() => {
                      if (selectedCategory === cat.name && !selectedSubcategory) {
                        setSelectedCategory(null);
                      } else {
                        setSelectedCategory(cat.name);
                        setSelectedSubcategory(null);
                      }
                    }}
                    onSelectSubcategory={(sub) => {
                      setSelectedCategory(cat.name);
                      if (selectedSubcategory === sub) {
                        setSelectedSubcategory(null);
                      } else {
                        setSelectedSubcategory(sub);
                      }
                    }}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        </ResizableSidebar>

        {/* Main area: grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-hidden">
            {entries.length === 0 && !loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Library className="h-8 w-8 opacity-50" />
                <span className="text-sm">
                  {error ? 'Could not load the book catalog.' : 'No books match the current filter.'}
                </span>
              </div>
            ) : (
              <CatalogGrid
                entries={entries}
                onSelect={(entry) => {
                  if (entry.kind === 'ap') {
                    setOpenTarget({ kind: 'ap', group: entry.group });
                  } else if (entry.kind === 'book') {
                    setOpenTarget({ kind: 'book', bookId: entry.book.id });
                  }
                }}
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
        'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors',
        indent && 'pl-6',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <span className="truncate">{name}</span>
      <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">{count}</span>
    </button>
  );
}

function CategoryGroup({
  category,
  activeCategory,
  activeSubcategory,
  onSelectCategory,
  onSelectSubcategory,
}: {
  category: {
    name: string;
    subcategories: Array<{ name: string | null; books: Book[] }>;
    count: number;
  };
  activeCategory: string | null;
  activeSubcategory: string | null;
  onSelectCategory: () => void;
  onSelectSubcategory: (sub: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSubs = category.subcategories.some((s) => s.name !== null);
  const isCatActive = activeCategory === category.name && !activeSubcategory;

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
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        )}
        <button
          type="button"
          onClick={onSelectCategory}
          className={cn(
            'flex flex-1 items-center justify-between py-1.5 pr-3 text-left text-xs transition-colors',
            !hasSubs && 'pl-3',
            isCatActive
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span className="truncate">{category.name}</span>
          <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">{category.count}</span>
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
              active={activeCategory === category.name && activeSubcategory === s.name}
              onClick={() => onSelectSubcategory(s.name!)}
              indent
            />
          ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized catalog grid — handles Book, ApGroup, and section headers
// ---------------------------------------------------------------------------

const CARD_WIDTH = 160;
const CARD_HEIGHT = 240;
const GAP = 12;
const SECTION_HEIGHT = 36;

/** A layout row is either a section header (full width) or a row of cards. */
type LayoutRow = { kind: 'section'; label: string } | { kind: 'cards'; items: CatalogEntry[] };

function CatalogGrid({ entries, onSelect }: { entries: CatalogEntry[]; onSelect: (e: CatalogEntry) => void }) {
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

  // Build layout rows: section headers get their own row, card entries
  // are chunked into rows of `columnCount`.
  const layoutRows = useMemo((): LayoutRow[] => {
    const rows: LayoutRow[] = [];
    const cardBuffer: CatalogEntry[] = [];

    const flushCards = () => {
      while (cardBuffer.length > 0) {
        rows.push({ kind: 'cards', items: cardBuffer.splice(0, columnCount) });
      }
    };

    for (const entry of entries) {
      if (entry.kind === 'section') {
        flushCards();
        rows.push({ kind: 'section', label: entry.label });
      } else {
        cardBuffer.push(entry);
      }
    }
    flushCards();
    return rows;
  }, [entries, columnCount]);

  const rowVirtualizer = useVirtualizer({
    count: layoutRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (layoutRows[i]?.kind === 'section' ? SECTION_HEIGHT : CARD_HEIGHT + GAP),
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
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((vRow) => {
          const row = layoutRows[vRow.index];
          if (!row) return null;

          if (row.kind === 'section') {
            return (
              <div
                key={vRow.key}
                className="absolute left-0 right-0 flex items-end"
                style={{
                  height: SECTION_HEIGHT,
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <div className="flex w-full items-center gap-3 pb-1">
                  <span
                    className="text-xs tracking-wide text-muted-foreground"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                  >
                    {row.label}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </div>
            );
          }

          return (
            <div
              key={vRow.key}
              className="absolute left-0 right-0 grid"
              style={{
                ...gridStyle,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {row.items.map((entry) =>
                entry.kind === 'ap' ? (
                  <ApCard key={`ap-${entry.group.subcategory}`} group={entry.group} onClick={() => onSelect(entry)} />
                ) : entry.kind === 'book' ? (
                  <BookCard key={entry.book.id} book={entry.book} onClick={() => onSelect(entry)} />
                ) : null,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  const [coverError, setCoverError] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    setCoverError(false);
    setCoverUrl(null);
    if (book.ingested) {
      api
        .booksGetCoverUrl(book.id)
        .then(setCoverUrl)
        .catch(() => {});
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
      <CoverArea
        coverUrl={coverUrl}
        coverError={coverError}
        onCoverError={() => setCoverError(true)}
        ingested={book.ingested}
      />
      {book.ruleset && <RulesetBadge ruleset={book.ruleset} />}
      <div className="flex flex-1 flex-col justify-center px-2">
        <div className="truncate text-xs font-medium leading-tight">{book.title}</div>
        {book.pageCount != null && <div className="text-[10px] text-muted-foreground">{book.pageCount} pages</div>}
      </div>
    </button>
  );
}

function ApCard({ group, onClick }: { group: ApGroup; onClick: () => void }) {
  const coverBook = group.parts[0]?.book;
  const [coverError, setCoverError] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    setCoverError(false);
    setCoverUrl(null);
    if (coverBook?.ingested) {
      api
        .booksGetCoverUrl(coverBook.id)
        .then(setCoverUrl)
        .catch(() => {});
    }
  }, [coverBook?.id, coverBook?.ingested]);

  const totalPages = apTotalPages(group);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-all hover:border-primary/60"
      style={{ height: CARD_HEIGHT }}
      title={`${group.subcategory} (${group.parts.length}-part Adventure Path)`}
    >
      <CoverArea
        coverUrl={coverUrl}
        coverError={coverError}
        onCoverError={() => setCoverError(true)}
        ingested={coverBook?.ingested ?? false}
      />
      {/* AP badge */}
      <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded bg-primary/90 px-1 py-0.5 text-[9px] font-semibold text-primary-foreground shadow-xs">
        <Layers className="h-2.5 w-2.5" />
        {group.parts.length}
      </div>
      <div className="flex flex-1 flex-col justify-center px-2">
        <div className="truncate text-xs font-medium leading-tight">{group.subcategory}</div>
        <div className="text-[10px] text-muted-foreground">
          {group.parts.length}-part AP
          {totalPages != null && ` · ${totalPages} pages`}
        </div>
      </div>
    </button>
  );
}

// Shared cover image area used by both card types.
function CoverArea({
  coverUrl,
  coverError,
  onCoverError,
  ingested,
}: {
  coverUrl: string | null;
  coverError: boolean;
  onCoverError: () => void;
  ingested: boolean;
}) {
  return (
    <div className="relative overflow-hidden bg-muted" style={{ height: CARD_HEIGHT - 46, width: '100%' }}>
      {coverUrl && !coverError ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          onError={onCoverError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top',
            display: 'block',
          }}
          className="transition-transform group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <Library className="h-6 w-6 text-muted-foreground/40" />
          <span className="text-[9px] leading-tight text-muted-foreground/60">
            {ingested ? 'Cover unavailable' : 'Not yet opened'}
          </span>
        </div>
      )}
    </div>
  );
}

function RulesetBadge({ ruleset }: { ruleset: 'legacy' | 'remastered' }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase shadow-xs',
        ruleset === 'remastered' ? 'bg-primary/90 text-primary-foreground' : 'bg-muted-foreground/80 text-background',
      )}
    >
      {ruleset === 'remastered' ? 'R' : 'L'}
    </div>
  );
}
