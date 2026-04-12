import { useCallback, useMemo, useState } from 'react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { MonsterFilterPanel } from './MonsterFilterPanel';
import { MonsterCardGrid } from './MonsterCardGrid';
import { MonsterDetailPane } from './MonsterDetailPane';
import { useMonsterSearch, useMonsterFacets, useMonsterDetail, useOpenExternal } from './useMonsters';
import type { MonsterSearchParams } from '@shared/types';

export function MonsterBrowser({ keywords = '' }: { keywords?: string }) {
  const [filters, setFilters] = useState<MonsterSearchParams>({});
  const [selectedMonster, setSelectedMonster] = useState<string | null>(null);
  const [detailAnim, setDetailAnim] = useState<'open' | 'closing'>('open');

  const searchParams = useMemo<MonsterSearchParams>(
    () => ({
      ...filters,
      keywords: keywords.trim() || undefined,
    }),
    [filters, keywords],
  );

  const { data: monsters, error } = useMonsterSearch(searchParams);
  const { data: facets } = useMonsterFacets();
  const { data: detail, loading: detailLoading } = useMonsterDetail(selectedMonster);
  const openExternal = useOpenExternal();

  const handleSelect = useCallback((name: string) => {
    setSelectedMonster((prev) => {
      if (prev === name) return prev;
      setDetailAnim('open');
      return name;
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailAnim('closing');
    setTimeout(() => setSelectedMonster(null), 150);
  }, []);

  const handleFiltersChange = useCallback((next: MonsterSearchParams) => {
    setFilters(next);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ResizableSidebar storageKey="dmtool.sidebar.monsters">
          <MonsterFilterPanel facets={facets} params={filters} onChange={handleFiltersChange} />
        </ResizableSidebar>

        <MonsterCardGrid monsters={monsters ?? []} error={error} selected={selectedMonster} onSelect={handleSelect} />

        {selectedMonster && detail && (
          <MonsterDetailPane
            detail={detail}
            loading={detailLoading}
            onClose={handleCloseDetail}
            onOpenExternal={openExternal}
            anim={detailAnim}
          />
        )}
      </div>
    </div>
  );
}
