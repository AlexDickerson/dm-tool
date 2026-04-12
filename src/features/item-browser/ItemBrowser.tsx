import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ItemFilterPanel } from './ItemFilterPanel';
import { ItemTable, type GroupedItem } from './ItemTable';
import { ItemDetailPane } from './ItemDetailPane';
import { useItemSearch, useItemFacets } from './useItems';
import type { ItemBrowserRow, ItemSearchParams, ItemSortField, SortDirection } from '@shared/types';

/** Strip a trailing parenthetical like "(Greater)" to get the base name.
 *  Returns the original name if there's no parenthetical. */
function itemBaseName(name: string): string {
  return name.replace(/\s*\([^)]+\)\s*$/, '');
}

/** Group items by base name. Within each group, if both legacy and
 *  remastered entries exist, keep only the remastered ones. Each group's
 *  representative is the lowest-level member. */
function groupItems(items: ItemBrowserRow[]): GroupedItem[] {
  const groups = new Map<string, ItemBrowserRow[]>();
  for (const item of items) {
    const base = itemBaseName(item.name);
    let list = groups.get(base);
    if (!list) {
      list = [];
      groups.set(base, list);
    }
    list.push(item);
  }

  const result: GroupedItem[] = [];
  for (let members of groups.values()) {
    // If the group has both legacy and remastered items, drop legacy
    const hasRemastered = members.some((m) => m.isRemastered === true);
    const hasLegacy = members.some((m) => m.isRemastered === false || m.isRemastered === null);
    if (hasRemastered && hasLegacy) {
      members = members.filter((m) => m.isRemastered === true);
    }
    // Sort siblings by level ascending
    members.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    result.push({
      representative: members[0],
      siblings: members,
    });
  }
  return result;
}

export function ItemBrowser() {
  const [keywords, setKeywords] = useState('');
  const [filters, setFilters] = useState<ItemSearchParams>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ItemSortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const searchParams = useMemo<ItemSearchParams>(
    () => ({
      ...filters,
      keywords: keywords.trim() || undefined,
      sortBy,
      sortDir,
      limit: 5000,
    }),
    [filters, keywords, sortBy, sortDir],
  );

  const { data: items, loading } = useItemSearch(searchParams);
  const { data: facets } = useItemFacets();

  const grouped = useMemo(() => groupItems(items ?? []), [items]);

  // Find siblings for the selected item
  const selectedSiblings = useMemo(() => {
    if (!selectedId) return null;
    const group = grouped.find((g) => g.siblings.some((s) => s.id === selectedId));
    return group && group.siblings.length > 1 ? group.siblings : null;
  }, [selectedId, grouped]);

  const handleSort = useCallback(
    (field: ItemSortField) => {
      if (sortBy === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(field);
        setSortDir('asc');
      }
    },
    [sortBy],
  );

  const handleSelect = useCallback((item: ItemBrowserRow) => {
    setSelectedId((prev) => (prev === item.id ? null : item.id));
  }, []);

  const handleFilterChange = useCallback((next: ItemSearchParams) => {
    setFilters(next);
  }, []);

  return (
    <div className="flex h-full">
      {/* Filter panel */}
      <ItemFilterPanel facets={facets} params={filters} onChange={handleFilterChange} />

      {/* Center: search + table */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Search bar */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search items..."
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>

        <ItemTable
          groups={grouped}
          selectedId={selectedId}
          onSelect={handleSelect}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          loading={loading}
        />
      </div>

      {/* Detail pane */}
      {selectedId && (
        <ItemDetailPane
          itemId={selectedId}
          siblings={selectedSiblings}
          onSelectSibling={setSelectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
