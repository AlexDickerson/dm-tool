import { useEffect, useState } from 'react';
import { ExternalLink, Upload } from 'lucide-react';
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

  useEffect(() => {
    api.autoWallAvailable().then(setAvailable);
  }, []);

  if (!available) return null;

  const handleImport = async () => {
    const imported = await api.autoWallImportUvtt(fileName);
    if (imported) {
      const data = await api.autoWallGetWalls(fileName);
      onUvttImported(data);
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
        </div>
      </div>
    </>
  );
}
