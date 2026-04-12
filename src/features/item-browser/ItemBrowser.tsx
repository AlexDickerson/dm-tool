import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ItemFilterPanel } from './ItemFilterPanel';
import { ItemTable } from './ItemTable';
import { ItemDetailPane } from './ItemDetailPane';
import { useItemSearch, useItemFacets } from './useItems';
import type { ItemBrowserRow, ItemSearchParams, ItemSortField, SortDirection } from '@shared/types';

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
      limit: 2000,
    }),
    [filters, keywords, sortBy, sortDir],
  );

  const { data: items, loading } = useItemSearch(searchParams);
  const { data: facets } = useItemFacets();

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
          items={items ?? []}
          selectedId={selectedId}
          onSelect={handleSelect}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          loading={loading}
        />
      </div>

      {/* Detail pane */}
      {selectedId && <ItemDetailPane itemId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
