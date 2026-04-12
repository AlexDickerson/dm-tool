import { useCallback, useMemo, useState } from 'react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { FloatingPanel } from '@/components/FloatingPanel';
import { MonsterFilterPanel } from './MonsterFilterPanel';
import { MonsterCardGrid } from './MonsterCardGrid';
import { MonsterDetailPane } from './MonsterDetailPane';
import { useMonsterSearch, useMonsterFacets, useMonsterDetail, useOpenExternal } from './useMonsters';
import { useHoverIntent } from '@/hooks/useHoverIntent';
import type { MonsterSearchParams } from '@shared/types';

export function MonsterBrowser({ keywords = '' }: { keywords?: string }) {
  const [filters, setFilters] = useState<MonsterSearchParams>({});

  const searchParams = useMemo<MonsterSearchParams>(
    () => ({
      ...filters,
      keywords: keywords.trim() || undefined,
    }),
    [filters, keywords],
  );

  const { data: monsters, error } = useMonsterSearch(searchParams);
  const { data: facets } = useMonsterFacets();
  const openExternal = useOpenExternal();

  const { hover, onEnter, onLeave, cancelHide } = useHoverIntent<string>();
  const { data: detail, loading: detailLoading } = useMonsterDetail(hover?.key ?? null);

  const handleFiltersChange = useCallback((next: MonsterSearchParams) => {
    setFilters(next);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ResizableSidebar storageKey="dmtool.sidebar.monsters">
          <MonsterFilterPanel facets={facets} params={filters} onChange={handleFiltersChange} />
        </ResizableSidebar>

        <MonsterCardGrid monsters={monsters ?? []} error={error} onHoverStart={onEnter} onHoverEnd={onLeave} />

        {hover && (
          <FloatingPanel anchorRect={hover.rect} onMouseEnter={cancelHide} onMouseLeave={onLeave}>
            {detailLoading || !detail ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : (
              <MonsterDetailPane detail={detail} onOpenExternal={openExternal} />
            )}
          </FloatingPanel>
        )}
      </div>
    </div>
  );
}
