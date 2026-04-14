import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Library, Layers, RefreshCw, Sparkles, X } from 'lucide-react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useBackgroundIngest, useBookClassify, useBookList, useBookScan } from './useBooks';
import { BookReader } from './BookReader';
import { groupAdventurePaths, apTotalPages, type ApGroup } from './ap-merge';
import type { Book } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CatalogEntry = { kind: 'book'; book: Book } | { kind: 'ap'; group: ApGroup } | { kind: 'section'; label: string };

type OpenTarget = { kind: 'book'; bookId: number } | { kind: 'ap'; group: ApGroup } | null;

// Use AI-derived classification when available, fall back to folder-derived.
function effectiveCategory(b: Book): string {
  return b.aiCategory ?? b.category;
}
function effectiveSubcategory(b: Book): string | null {
  return b.aiSubcategory ?? b.subcategory;
}
function effectiveTitle(b: Book): string {
  return b.aiTitle ?? b.title;
}

const CATEGORY_ORDER = ['Rulebook', 'Adventure Path', 'Adventure', 'Setting', 'Supplement',
  // Legacy folder-derived names (fallback for unclassified books)
  'Rulebooks', 'Adventure Paths', 'Adventures', 'Lost Omens', 'Beginner Box'];

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function BookBrowser({ keywords = '' }: { keywords?: string }) {
  const { data: books, loading, error, refetch } = useBookList();
  const { scan, scanning } = useBookScan();
  const { classify, cancel: cancelClassify, running: classifying, current: classifyCurrent, total: classifyTotal } =
    useBookClassify();
  // Hook triggers background cover extraction — side-effect only.
  useBackgroundIngest(books, refetch);

  const handleClassify = useCallback(
    async (reclassify?: boolean) => {
      try {
        await classify(reclassify);
      } catch (e) {
        console.error('Classification error:', e);
      }
      refetch();
    },
    [classify, refetch],
  );
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

  // Group books by effective (AI or folder-derived) category for the left
  // rail. For Adventure Paths, count AP groups instead of individual PDFs.
  const categories = useMemo(() => {
    if (!books) return [];
    const map = new Map<string, { sub: Map<string | null, Book[]> }>();
    for (const b of books) {
      const cat = effectiveCategory(b);
      const sub = effectiveSubcategory(b);
      let entry = map.get(cat);
      if (!entry) {
        entry = { sub: new Map() };
        map.set(cat, entry);
      }
      let list = entry.sub.get(sub);
      if (!list) {
        list = [];
        entry.sub.set(sub, list);
      }
      list.push(b);
    }
    const isAp = (n: string) => n === 'Adventure Path' || n === 'Adventure Paths';
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        subcategories: Array.from(v.sub.entries()).map(([sub, bks]) => ({
          name: sub,
          books: bks,
        })),
        count: isAp(name)
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
  const isAp = (name: string) => name === 'Adventure Path' || name === 'Adventure Paths';
  const entries = useMemo((): CatalogEntry[] => {
    const q = filter.trim().toLowerCase();
    const out: CatalogEntry[] = [];

    // Group non-AP books by effective category.
    const byCat = new Map<string, Book[]>();
    for (const b of otherBooks) {
      const cat = effectiveCategory(b);
      const sub = effectiveSubcategory(b);
      if (selectedCategory && cat !== selectedCategory) continue;
      if (selectedSubcategory && sub !== selectedSubcategory) continue;
      if (q && !effectiveTitle(b).toLowerCase().includes(q)) continue;
      let list = byCat.get(cat);
      if (!list) {
        list = [];
        byCat.set(cat, list);
      }
      list.push(b);
    }

    // Collect AP entries if they pass the filter.
    const apCatName = [...byCat.keys(), ...CATEGORY_ORDER].find(isAp) ?? 'Adventure Path';
    const apEntries: CatalogEntry[] = [];
    for (const g of apGroups) {
      if (selectedCategory && !isAp(selectedCategory)) continue;
      if (selectedSubcategory && selectedSubcategory !== g.subcategory) continue;
      if (q && !g.subcategory.toLowerCase().includes(q)) continue;
      apEntries.push({ kind: 'ap', group: g });
      for (const s of g.supplements) {
        if (q && !effectiveTitle(s).toLowerCase().includes(q)) continue;
        apEntries.push({ kind: 'book', book: s });
      }
    }

    // Emit entries in category order with section headers.
    const allCats = new Set([...CATEGORY_ORDER, ...byCat.keys()]);
    if (apEntries.length > 0) allCats.add(apCatName);
    const sorted = [...allCats].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (const cat of sorted) {
      const catEntries: CatalogEntry[] = [];
      if (isAp(cat)) {
        catEntries.push(...apEntries);
      }
      const books = byCat.get(cat);
      if (books) {
        for (const b of books) catEntries.push({ kind: 'book', book: b });
      }
      if (catEntries.length === 0) continue;
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
              <div className="flex items-center gap-1">
                {classifying ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                    title="Cancel classification"
                    onClick={cancelClassify}
                  >
                    <Sparkles className="h-3 w-3 animate-pulse text-primary" />
                    {classifyCurrent}/{classifyTotal}
                    <X className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    title="Classify books with AI"
                    onClick={() => handleClassify()}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                )}
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
      title={effectiveTitle(book)}
    >
      <CoverArea
        coverUrl={coverUrl}
        coverError={coverError}
        onCoverError={() => setCoverError(true)}
        ingested={book.ingested}
        title={effectiveTitle(book)}
      />
      {book.aiSystem && book.aiSystem !== 'PF2e' && <SystemBadge system={book.aiSystem} />}
      {book.ruleset && <RulesetBadge ruleset={book.ruleset} />}
      <HoverMeta title={effectiveTitle(book)} pageCount={book.pageCount} />
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
        title={group.subcategory}
      />
      {/* AP badge */}
      <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded bg-primary/90 px-1 py-0.5 text-[9px] font-semibold text-primary-foreground shadow-xs">
        <Layers className="h-2.5 w-2.5" />
        {group.parts.length}
      </div>
      <HoverMeta
        title={group.subcategory}
        subtitle={`${group.parts.length}-part AP${totalPages != null ? ` · ${totalPages} pages` : ''}`}
      />
    </button>
  );
}

// Shared cover image area — fills the entire card.
function CoverArea({
  coverUrl,
  coverError,
  onCoverError,
  ingested,
  title,
}: {
  coverUrl: string | null;
  coverError: boolean;
  onCoverError: () => void;
  ingested: boolean;
  title: string;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-muted">
      {coverUrl && !coverError ? (
        <img
          src={coverUrl}
          alt={title}
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

// Metadata overlay shown on hover at the bottom of the card.
function HoverMeta({
  title,
  pageCount,
  subtitle,
}: {
  title: string;
  pageCount?: number | null;
  subtitle?: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-black/75 px-2 py-1.5 backdrop-blur-sm transition-transform group-hover:translate-y-0"
    >
      <div className="truncate text-xs font-medium leading-tight text-white">{title}</div>
      {subtitle && <div className="text-[10px] text-white/70">{subtitle}</div>}
      {!subtitle && pageCount != null && <div className="text-[10px] text-white/70">{pageCount} pages</div>}
    </div>
  );
}

function SystemBadge({ system }: { system: string }) {
  return (
    <div className="pointer-events-none absolute left-1 top-1 rounded bg-amber-600/90 px-1 py-0.5 text-[9px] font-semibold uppercase text-white shadow-xs">
      {system}
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
