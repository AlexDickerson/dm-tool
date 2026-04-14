import { useEffect, useState } from 'react';
import { Check, ExternalLink, Globe, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';

interface AutoWallPanelProps {
  fileName: string;
  hasUvtt: boolean;
  onUvttImported: (wallData: { walls: number[][]; width: number; height: number } | null) => void;
}

export function AutoWallPanel({ fileName, hasUvtt, onUvttImported }: AutoWallPanelProps) {
  const [available, setAvailable] = useState(false);
  const [foundryAvailable, setFoundryAvailable] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{
    sceneName: string;
    wallsCreated: number;
    doorsCreated: number;
  } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    api.autoWallAvailable().then(setAvailable);
    api.getConfig().then((cfg) => setFoundryAvailable(!!cfg.foundryMcpUrl));
  }, []);

  useEffect(() => {
    setPushResult(null);
    setPushError(null);
  }, [fileName]);

  if (!available) return null;

  const handleImport = async () => {
    const imported = await api.autoWallImportUvtt(fileName);
    if (imported) {
      const data = await api.autoWallGetWalls(fileName);
      onUvttImported(data);
    }
  };

  const handlePush = async () => {
    if (pushing) return;
    setPushing(true);
    setPushResult(null);
    setPushError(null);
    try {
      const result = await api.pushToFoundry(fileName);
      setPushResult(result);
    } catch (e) {
      setPushError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      <Separator />
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Walls</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => api.autoWallLaunch(fileName)}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open in Auto-Wall
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import .uvtt
          </Button>
          {hasUvtt && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">.uvtt</span>
          )}
          {hasUvtt && foundryAvailable && (
            <Button variant="outline" size="sm" disabled={pushing} onClick={handlePush}>
              {pushing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="mr-1.5 h-3.5 w-3.5" />
              )}
              Push to Foundry
            </Button>
          )}
        </div>
        {pushResult && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
            <Check className="h-3.5 w-3.5" />
            Created &quot;{pushResult.sceneName}&quot; — {pushResult.wallsCreated} walls
            {pushResult.doorsCreated > 0 && `, ${pushResult.doorsCreated} doors`}
          </div>
        )}
        {pushError && <div className="mt-2 text-xs text-red-400">{pushError}</div>}
      </div>
    </>
  );
}
