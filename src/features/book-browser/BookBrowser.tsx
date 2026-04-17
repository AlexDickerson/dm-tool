import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronRight, Library, Layers, RefreshCw, Sparkles, X } from 'lucide-react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { STORAGE_KEYS } from '@/lib/constants';
import { readJson, readString, writeJson, writeString } from '@/lib/storage-utils';
import { useBackgroundIngest, useBookClassify, useBookList, useBookScan } from './useBooks';
import { BookReader } from './BookReader';
import { groupAdventurePaths, apTotalPages, type ApGroup } from './ap-merge';
import type { Book } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CatalogEntry = { kind: 'book'; book: Book } | { kind: 'ap'; group: ApGroup } | { kind: 'section'; label: string };

type TabDef =
  | { id: 'browser'; kind: 'browser' }
  | { id: string; kind: 'book'; bookId: number; title: string }
  | { id: string; kind: 'ap'; group: ApGroup; title: string };

const BROWSER_TAB: TabDef = { id: 'browser', kind: 'browser' };

/** Serializable shape saved to localStorage. */
type PersistedTab =
  | { id: 'browser'; kind: 'browser' }
  | { id: string; kind: 'book'; bookId: number; title: string }
  | { id: string; kind: 'ap'; subcategory: string; title: string };

function persistTabs(tabs: TabDef[], activeTabId: string) {
  const serializable: PersistedTab[] = tabs.map((t) => {
    if (t.kind === 'ap') return { id: t.id, kind: 'ap', subcategory: t.group.subcategory, title: t.title };
    return t as PersistedTab;
  });
  writeJson(STORAGE_KEYS.bookTabs, serializable);
  writeString(STORAGE_KEYS.bookActiveTab, activeTabId);
}

function loadPersistedTabs(): { tabs: PersistedTab[]; activeTabId: string } | null {
  const tabs = readJson<PersistedTab[] | null>(STORAGE_KEYS.bookTabs, null);
  if (!tabs) return null;
  const active = readString(STORAGE_KEYS.bookActiveTab) ?? 'browser';
  return { tabs, activeTabId: active };
}

// Use AI-derived classification when available, fall back to folder-derived.
// For folder-derived books: category = system (e.g. "PF2e"), subcategory = category type (e.g. "Rulebooks").
function effectiveSystem(b: Book): string {
  return b.aiSystem ?? b.category;
}
function effectiveCategory(b: Book): string {
  return b.aiCategory ?? b.subcategory ?? 'Uncategorized';
}
function effectivePublisher(b: Book): string | null {
  return b.aiPublisher ?? null;
}
function effectiveTitle(b: Book): string {
  return b.aiTitle ?? b.title;
}

const isApCategory = (n: string) => n === 'Adventure Path' || n === 'Adventure Paths';
const SYSTEM_ORDER = ['PF2e', '5e', 'Generic'];
const CATEGORY_ORDER = [
  'Rulebook',
  'Adventure Path',
  'Adventure',
  'Setting',
  'Supplement',
  'Rulebooks',
  'Adventure Paths',
  'Adventures',
  'Lost Omens',
  'Beginner Box',
];

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function BookBrowser({ keywords = '' }: { keywords?: string }) {
  const { data: books, loading, error, refetch } = useBookList();
  const { scan, scanning } = useBookScan();
  const {
    classify,
    cancel: cancelClassify,
    running: classifying,
    current: classifyCurrent,
    total: classifyTotal,
  } = useBookClassify();
  // Hook triggers background cover extraction — side-effect only.
  useBackgroundIngest(books, refetch);

  const [classifyError, setClassifyError] = useState<string | null>(null);
  const handleClassify = useCallback(
    async (reclassify?: boolean) => {
      setClassifyError(null);
      try {
        await classify(reclassify);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setClassifyError(msg);
        console.error('Classification error:', e);
      }
      refetch();
    },
    [classify, refetch],
  );
  const filter = keywords;
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabDef[]>([BROWSER_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>('browser');
  const [tabsRestored, setTabsRestored] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; book: Book } | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openTab = useCallback((tab: TabDef) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    if (tabId === 'browser') return; // can't close browser tab
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => (prev === tabId ? 'browser' : prev));
  }, []);

  const handleUpdateMeta = useCallback(
    async (bookId: number, fields: { aiSystem?: string; aiCategory?: string }) => {
      await api.booksUpdateMeta({ id: bookId, fields });
      refetch();
    },
    [refetch],
  );

  const selectNav = useCallback((sys: string | null, cat: string | null, pub: string | null) => {
    setSelectedSystem(sys);
    setSelectedCategory(cat);
    setSelectedPublisher(pub);
  }, []);

  const handleRescan = useCallback(async () => {
    await scan();
    refetch();
  }, [scan, refetch]);

  // Split books into merged AP groups + everything else.
  const { apGroups, otherBooks } = useMemo(
    () => (books ? groupAdventurePaths(books) : { apGroups: [], otherBooks: [] }),
    [books],
  );

  // Rehydrate persisted tabs once books have loaded.
  useEffect(() => {
    if (tabsRestored || !books) return;
    setTabsRestored(true);
    const saved = loadPersistedTabs();
    if (!saved || saved.tabs.length <= 1) return;
    const apByName = new Map(apGroups.map((g) => [g.subcategory, g]));
    const bookById = new Map(books.map((b) => [b.id, b]));
    const restored: TabDef[] = [BROWSER_TAB];
    for (const pt of saved.tabs) {
      if (pt.kind === 'browser') continue;
      if (pt.kind === 'book') {
        if (bookById.has(pt.bookId)) restored.push(pt);
      } else if (pt.kind === 'ap') {
        const group = apByName.get(pt.subcategory);
        if (group) restored.push({ id: pt.id, kind: 'ap', group, title: pt.title });
      }
    }
    if (restored.length > 1) {
      setTabs(restored);
      setActiveTabId(restored.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : 'browser');
    }
  }, [books, apGroups, tabsRestored]);

  // Persist tabs whenever they change.
  useEffect(() => {
    if (!tabsRestored) return;
    persistTabs(tabs, activeTabId);
  }, [tabs, activeTabId, tabsRestored]);

  // Build 3-level sidebar tree: System → Category → Publisher.
  const systems = useMemo(() => {
    if (!books) return [];

    // system → category → publisher → book count
    const tree = new Map<string, Map<string, Map<string, number>>>();
    for (const b of books) {
      const sys = effectiveSystem(b);
      const cat = effectiveCategory(b);
      const pub = effectivePublisher(b) ?? 'Unknown';
      if (!tree.has(sys)) tree.set(sys, new Map());
      const catMap = tree.get(sys)!;
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const pubMap = catMap.get(cat)!;
      pubMap.set(pub, (pubMap.get(pub) ?? 0) + 1);
    }

    // AP groups per system (for count correction)
    const apCountBySys = new Map<string, number>();
    for (const g of apGroups) {
      const first = g.parts[0]?.book;
      if (!first) continue;
      const sys = effectiveSystem(first);
      apCountBySys.set(sys, (apCountBySys.get(sys) ?? 0) + 1);
    }

    return Array.from(tree.entries())
      .map(([sysName, catMap]) => ({
        name: sysName,
        categories: Array.from(catMap.entries())
          .map(([catName, pubMap]) => ({
            name: catName,
            publishers: Array.from(pubMap.entries())
              .map(([pubName, count]) => ({ name: pubName, count }))
              .sort((a, b) => b.count - a.count),
            count: isApCategory(catName)
              ? (apCountBySys.get(sysName) ?? 0)
              : Array.from(pubMap.values()).reduce((s, c) => s + c, 0),
          }))
          .sort((a, b) => {
            const ai = CATEGORY_ORDER.indexOf(a.name);
            const bi = CATEGORY_ORDER.indexOf(b.name);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          }),
        count: Array.from(catMap.values()).reduce(
          (s, pubMap) => s + Array.from(pubMap.values()).reduce((s2, c) => s2 + c, 0),
          0,
        ),
      }))
      .sort((a, b) => {
        const ai = SYSTEM_ORDER.indexOf(a.name);
        const bi = SYSTEM_ORDER.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
  }, [books, apGroups]);

  // Build catalog entries filtered by System → Category → Publisher.
  const entries = useMemo((): CatalogEntry[] => {
    const q = filter.trim().toLowerCase();
    const out: CatalogEntry[] = [];

    // Filter non-AP books.
    const byCat = new Map<string, Book[]>();
    for (const b of otherBooks) {
      const sys = effectiveSystem(b);
      const cat = effectiveCategory(b);
      const pub = effectivePublisher(b) ?? 'Unknown';
      if (selectedSystem && sys !== selectedSystem) continue;
      if (selectedCategory && cat !== selectedCategory) continue;
      if (selectedPublisher && pub !== selectedPublisher) continue;
      if (q && !effectiveTitle(b).toLowerCase().includes(q)) continue;
      let list = byCat.get(cat);
      if (!list) {
        list = [];
        byCat.set(cat, list);
      }
      list.push(b);
    }

    // Filter AP groups.
    const apCatName = [...byCat.keys(), ...CATEGORY_ORDER].find(isApCategory) ?? 'Adventure Path';
    const apEntries: CatalogEntry[] = [];
    for (const g of apGroups) {
      const first = g.parts[0]?.book;
      if (!first) continue;
      const sys = effectiveSystem(first);
      const pub = effectivePublisher(first) ?? 'Unknown';
      if (selectedSystem && sys !== selectedSystem) continue;
      if (selectedCategory && !isApCategory(selectedCategory)) continue;
      if (selectedPublisher && pub !== selectedPublisher) continue;
      if (q && !g.subcategory.toLowerCase().includes(q)) continue;
      apEntries.push({ kind: 'ap', group: g });
      for (const s of g.supplements) {
        if (q && !effectiveTitle(s).toLowerCase().includes(q)) continue;
        apEntries.push({ kind: 'book', book: s });
      }
    }

    // Emit in category order with section headers.
    const allCats = new Set([...CATEGORY_ORDER, ...byCat.keys()]);
    if (apEntries.length > 0) allCats.add(apCatName);
    const sorted = [...allCats].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (const cat of sorted) {
      const catEntries: CatalogEntry[] = [];
      if (isApCategory(cat)) catEntries.push(...apEntries);
      const catBooks = byCat.get(cat);
      if (catBooks) for (const b of catBooks) catEntries.push({ kind: 'book', book: b });
      if (catEntries.length === 0) continue;
      if (!selectedCategory) out.push({ kind: 'section', label: cat });
      out.push(...catEntries);
    }

    return out;
  }, [apGroups, otherBooks, selectedSystem, selectedCategory, selectedPublisher, filter]);

  const isBrowserActive = activeTabId === 'browser';

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar — only show when more than just the browser tab */}
      {tabs.length > 1 && (
        <TabBar tabs={tabs} activeTabId={activeTabId} onActivate={setActiveTabId} onClose={closeTab} />
      )}
      <div className="flex min-h-0 flex-1">
        {/* Category rail — only visible on browser tab */}
        {isBrowserActive && (
          <ResizableSidebar storageKey="dmtool.sidebar.books">
            <div className="flex h-full flex-col border-r border-border bg-card">
              <div className="flex h-12 items-center justify-between px-3">
                <span
                  className="text-sm text-foreground"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                >
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
              {classifyError && (
                <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
                  {classifyError}
                </div>
              )}
              <ScrollArea className="flex-1">
                <div className="py-1">
                  <NavItem
                    name="All Books"
                    count={apGroups.length + apGroups.reduce((n, g) => n + g.supplements.length, 0) + otherBooks.length}
                    active={!selectedSystem}
                    onClick={() => selectNav(null, null, null)}
                  />
                  {systems.map((sys) => (
                    <SystemGroup
                      key={sys.name}
                      system={sys}
                      selectedSystem={selectedSystem}
                      selectedCategory={selectedCategory}
                      selectedPublisher={selectedPublisher}
                      expandedKeys={expandedKeys}
                      onToggle={toggleExpanded}
                      onSelect={selectNav}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </ResizableSidebar>
        )}

        {/* Content area — all tabs mounted, only active one visible */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Browser tab */}
          <div className="flex-1 overflow-hidden" style={{ display: isBrowserActive ? undefined : 'none' }}>
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
                    openTab({
                      id: `ap-${entry.group.subcategory}`,
                      kind: 'ap',
                      group: entry.group,
                      title: entry.group.subcategory,
                    });
                  } else if (entry.kind === 'book') {
                    openTab({
                      id: `book-${entry.book.id}`,
                      kind: 'book',
                      bookId: entry.book.id,
                      title: effectiveTitle(entry.book),
                    });
                  }
                }}
                onBookContextMenu={(e, book) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, book });
                }}
              />
            )}
          </div>
          {/* Reader tabs */}
          {tabs.map((tab) => {
            if (tab.kind === 'browser') return null;
            return (
              <div
                key={tab.id}
                className="flex-1 overflow-hidden"
                style={{ display: activeTabId === tab.id ? undefined : 'none' }}
              >
                {tab.kind === 'ap' ? (
                  <BookReader
                    apGroup={tab.group}
                    onClose={() => closeTab(tab.id)}
                    onBack={() => setActiveTabId('browser')}
                    onIngestComplete={refetch}
                  />
                ) : (
                  <BookReader
                    bookId={tab.bookId}
                    onClose={() => closeTab(tab.id)}
                    onBack={() => setActiveTabId('browser')}
                    onIngestComplete={refetch}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {ctxMenu && (
        <BookContextMenu
          book={ctxMenu.book}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onUpdateMeta={handleUpdateMeta}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: TabDef[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      className="flex items-end gap-px border-b border-border"
      style={{ backgroundColor: 'hsl(var(--card))', minHeight: 32 }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const label = tab.kind === 'browser' ? 'Library' : tab.title;
        return (
          <button
            key={tab.id}
            type="button"
            className={cn(
              'group flex max-w-[200px] items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onActivate(tab.id)}
            title={label}
          >
            {tab.kind === 'browser' && <Library className="h-3 w-3 shrink-0" />}
            <span className="truncate">{label}</span>
            {tab.kind !== 'browser' && (
              <span
                role="button"
                className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                style={active ? { opacity: 1 } : undefined}
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category rail components
// ---------------------------------------------------------------------------

/** Leaf nav item — no chevron, just a clickable label + count. */
function NavItem({
  name,
  count,
  active,
  onClick,
  indent = 0,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
  indent?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between pr-3 py-1.5 text-left text-xs transition-colors',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      style={{ paddingLeft: 12 + indent * 12 }}
    >
      <span className="truncate">{name}</span>
      <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">{count}</span>
    </button>
  );
}

/** Expandable nav group — chevron + label + count, with children. */
function NavGroup({
  name,
  count,
  active,
  indent,
  expanded,
  onToggle,
  onClick,
  children,
}: {
  name: string;
  count: number;
  active: boolean;
  indent: number;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: indent * 12 }}>
        <button
          type="button"
          className="flex h-6 w-5 items-center justify-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        </button>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'flex flex-1 items-center justify-between py-1.5 pr-3 text-left text-xs transition-colors',
            active
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span className="truncate">{name}</span>
          <span className="ml-2 shrink-0 tabular-nums text-[10px] opacity-60">{count}</span>
        </button>
      </div>
      {expanded && children}
    </div>
  );
}

/** Top-level system group with nested category → publisher tree. */
function SystemGroup({
  system,
  selectedSystem,
  selectedCategory,
  selectedPublisher,
  expandedKeys,
  onToggle,
  onSelect,
}: {
  system: {
    name: string;
    categories: { name: string; publishers: { name: string; count: number }[]; count: number }[];
    count: number;
  };
  selectedSystem: string | null;
  selectedCategory: string | null;
  selectedPublisher: string | null;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (sys: string | null, cat: string | null, pub: string | null) => void;
}) {
  const sysActive = selectedSystem === system.name && !selectedCategory;
  return (
    <NavGroup
      name={system.name}
      count={system.count}
      active={sysActive}
      indent={0}
      expanded={expandedKeys.has(system.name)}
      onToggle={() => onToggle(system.name)}
      onClick={() => onSelect(sysActive ? null : system.name, null, null)}
    >
      {system.categories.map((cat) => {
        const catActive = selectedSystem === system.name && selectedCategory === cat.name && !selectedPublisher;
        const hasPubs =
          cat.publishers.length > 1 || (cat.publishers.length === 1 && cat.publishers[0]!.name !== 'Unknown');
        const catKey = `${system.name}/${cat.name}`;
        return hasPubs ? (
          <NavGroup
            key={cat.name}
            name={cat.name}
            count={cat.count}
            active={catActive}
            indent={1}
            expanded={expandedKeys.has(catKey)}
            onToggle={() => onToggle(catKey)}
            onClick={() => onSelect(system.name, catActive ? null : cat.name, null)}
          >
            {cat.publishers.map((pub) => (
              <NavItem
                key={pub.name}
                name={pub.name}
                count={pub.count}
                indent={4}
                active={
                  selectedSystem === system.name && selectedCategory === cat.name && selectedPublisher === pub.name
                }
                onClick={() => {
                  const pubActive =
                    selectedSystem === system.name && selectedCategory === cat.name && selectedPublisher === pub.name;
                  onSelect(system.name, cat.name, pubActive ? null : pub.name);
                }}
              />
            ))}
          </NavGroup>
        ) : (
          <NavItem
            key={cat.name}
            name={cat.name}
            count={cat.count}
            indent={3}
            active={catActive}
            onClick={() => onSelect(system.name, catActive ? null : cat.name, null)}
          />
        );
      })}
    </NavGroup>
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

function CatalogGrid({
  entries,
  onSelect,
  onBookContextMenu,
}: {
  entries: CatalogEntry[];
  onSelect: (e: CatalogEntry) => void;
  onBookContextMenu?: (e: React.MouseEvent, book: Book) => void;
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
                  <BookCard
                    key={entry.book.id}
                    book={entry.book}
                    onClick={() => onSelect(entry)}
                    onContextMenu={onBookContextMenu}
                  />
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

function BookCard({
  book,
  onClick,
  onContextMenu,
}: {
  book: Book;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, book: Book) => void;
}) {
  const [coverError, setCoverError] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    setCoverError(false);
    setCoverUrl(null);
    if (book.ingested) {
      api
        .booksGetCoverUrl(book.id)
        .then(setCoverUrl)
        .catch((err) => {
          console.error(`Failed to load cover for book ${book.id}:`, err);
          setCoverError(true);
        });
    }
  }, [book.id, book.ingested]);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, book) : undefined}
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
        .catch((err) => {
          console.error(`Failed to load cover for book ${coverBook.id}:`, err);
          setCoverError(true);
        });
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
function HoverMeta({ title, pageCount, subtitle }: { title: string; pageCount?: number | null; subtitle?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-black/75 px-2 py-1.5 backdrop-blur-sm transition-transform group-hover:translate-y-0">
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

// ---------------------------------------------------------------------------
// Right-click context menu for moving books between categories / systems
// ---------------------------------------------------------------------------

const CTX_CATEGORIES = ['Rulebook', 'Adventure Path', 'Adventure', 'Setting', 'Supplement'] as const;
const CTX_SYSTEMS = ['PF2e', '5e', 'Generic'] as const;

function BookContextMenu({
  book,
  x,
  y,
  onClose,
  onUpdateMeta,
}: {
  book: Book;
  x: number;
  y: number;
  onClose: () => void;
  onUpdateMeta: (bookId: number, fields: { aiSystem?: string; aiCategory?: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside or Escape.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Clamp position so menu doesn't overflow viewport.
  const style = useMemo(() => {
    const menuW = 180;
    const menuH = 280;
    const left = Math.min(x, window.innerWidth - menuW - 8);
    const top = Math.min(y, window.innerHeight - menuH - 8);
    return { position: 'fixed' as const, left, top, zIndex: 9999 };
  }, [x, y]);

  const curCat = effectiveCategory(book);
  const curSys = effectiveSystem(book);

  return (
    <div
      ref={ref}
      style={{ ...style, backgroundColor: 'hsl(var(--popover))' }}
      className="min-w-[160px] rounded-md border border-border py-1 shadow-lg"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</div>
      {CTX_CATEGORIES.map((cat) => (
        <button
          key={cat}
          type="button"
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-accent',
            curCat === cat && 'text-foreground font-medium',
            curCat !== cat && 'text-muted-foreground',
          )}
          onClick={() => {
            onUpdateMeta(book.id, { aiCategory: cat });
            onClose();
          }}
        >
          <Check className={cn('h-3 w-3', curCat === cat ? 'opacity-100' : 'opacity-0')} />
          {cat}
        </button>
      ))}
      <div className="mx-2 my-1 h-px bg-border" />
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">System</div>
      {CTX_SYSTEMS.map((sys) => (
        <button
          key={sys}
          type="button"
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-accent',
            curSys === sys && 'text-foreground font-medium',
            curSys !== sys && 'text-muted-foreground',
          )}
          onClick={() => {
            onUpdateMeta(book.id, { aiSystem: sys });
            onClose();
          }}
        >
          <Check className={cn('h-3 w-3', curSys === sys ? 'opacity-100' : 'opacity-0')} />
          {sys}
        </button>
      ))}
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
