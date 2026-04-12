import { useCallback, useMemo, useState } from 'react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { DetailOverlay } from '@/components/FloatingPanel';
import { ItemFilterPanel } from './ItemFilterPanel';
import { ItemCardGrid, type GroupedItem } from './ItemCardGrid';
import { ItemDetailPane } from './ItemDetailPane';
import { useItemSearch, useItemFacets } from './useItems';
import type { ItemBrowserRow, ItemSearchParams } from '@shared/types';

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

export function ItemBrowser({ keywords = '' }: { keywords?: string }) {
  const [filters, setFilters] = useState<ItemSearchParams>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const searchParams = useMemo<ItemSearchParams>(
    () => ({
      ...filters,
      keywords: keywords.trim() || undefined,
      limit: 5000,
    }),
    [filters, keywords],
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

  const handleSelect = useCallback((item: ItemBrowserRow) => {
    setSelectedId((prev) => {
      if (prev === item.id) return prev;
      setClosing(false);
      return item.id;
    });
  }, []);

  const handleClose = useCallback(() => setClosing(true), []);
  const handleClosed = useCallback(() => {
    setSelectedId(null);
    setClosing(false);
  }, []);

  const handleFilterChange = useCallback((next: ItemSearchParams) => {
    setFilters(next);
  }, []);

  return (
    <div className="flex h-full">
      {/* Filter panel */}
      <ResizableSidebar storageKey="dmtool.sidebar.items">
        <ItemFilterPanel facets={facets} params={filters} onChange={handleFilterChange} />
      </ResizableSidebar>

      {/* Grid + overlay container */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <ItemCardGrid groups={grouped} selectedId={selectedId} onSelect={handleSelect} loading={loading} />

        {selectedId && (
          <DetailOverlay closing={closing} onClosed={handleClosed}>
            <ItemDetailPane
              itemId={selectedId}
              siblings={selectedSiblings}
              onSelectSibling={setSelectedId}
              onClose={handleClose}
            />
          </DetailOverlay>
        )}
      </div>
    </div>
  );
}
