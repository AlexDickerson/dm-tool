import { useCallback, useMemo, useState } from 'react';
import { ResizableSidebar } from '@/components/ResizableSidebar';
import { DetailOverlay } from '@/components/FloatingPanel';
import { MonsterFilterPanel } from './MonsterFilterPanel';
import { MonsterCardGrid } from './MonsterCardGrid';
import { MonsterDetailPane } from './MonsterDetailPane';
import { useMonsterSearch, useMonsterFacets, useMonsterDetail, useOpenExternal } from './useMonsters';
import type { MonsterSearchParams } from '@shared/types';

export function MonsterBrowser({ keywords = '' }: { keywords?: string }) {
  const [filters, setFilters] = useState<MonsterSearchParams>({});
  const [selectedMonster, setSelectedMonster] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

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

  const handleSelect = useCallback(
    (name: string) => {
      if (name === selectedMonster) {
        handleClose();
      } else {
        setClosing(false);
        setSelectedMonster(name);
      }
    },
    [selectedMonster, handleClose],
  );

  const handleClose = useCallback(() => setClosing(true), []);
  const handleClosed = useCallback(() => {
    setSelectedMonster(null);
    setClosing(false);
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

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <MonsterCardGrid monsters={monsters ?? []} error={error} selected={selectedMonster} onSelect={handleSelect} />

          {selectedMonster && detail && (
            <DetailOverlay storageKey="dmtool.detail.monsters" closing={closing} onClosed={handleClosed}>
              <MonsterDetailPane
                detail={detail}
                loading={detailLoading}
                onOpenExternal={openExternal}
                onClose={handleClose}
              />
            </DetailOverlay>
          )}
        </div>
      </div>
    </div>
  );
}
