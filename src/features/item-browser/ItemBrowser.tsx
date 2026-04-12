import { useCallback, useMemo, useState } from 'react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { FloatingPanel } from '@/components/FloatingPanel';
import { ItemFilterPanel } from './ItemFilterPanel';
import { ItemCardGrid, type GroupedItem } from './ItemCardGrid';
import { ItemDetailPane } from './ItemDetailPane';
import { useItemSearch, useItemFacets } from './useItems';
import { useHoverIntent } from '@/hooks/useHoverIntent';
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

  const { hover, onEnter, onLeave, cancelHide, setKey } = useHoverIntent<string>();

  // Find siblings for the hovered item
  const hoveredSiblings = useMemo(() => {
    if (!hover) return null;
    const group = grouped.find((g) => g.siblings.some((s) => s.id === hover.key));
    return group && group.siblings.length > 1 ? group.siblings : null;
  }, [hover, grouped]);

  const handleFilterChange = useCallback((next: ItemSearchParams) => {
    setFilters(next);
  }, []);

  return (
    <div className="flex h-full">
      {/* Filter panel */}
      <ResizableSidebar storageKey="dmtool.sidebar.items">
        <ItemFilterPanel facets={facets} params={filters} onChange={handleFilterChange} />
      </ResizableSidebar>

      {/* Center: card grid */}
      <ItemCardGrid groups={grouped} loading={loading} onHoverStart={onEnter} onHoverEnd={onLeave} />

      {/* Hover detail */}
      {hover && (
        <FloatingPanel anchorRect={hover.rect} onMouseEnter={cancelHide} onMouseLeave={onLeave}>
          <ItemDetailPane itemId={hover.key} siblings={hoveredSiblings} onSelectSibling={setKey} />
        </FloatingPanel>
      )}
    </div>
  );
}
