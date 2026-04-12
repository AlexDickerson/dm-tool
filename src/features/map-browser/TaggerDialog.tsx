import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderOpen, Play, Eye, Square, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { TaggerProgress, TaggerResult } from '@shared/types';

type Phase = 'idle' | 'previewing' | 'previewed' | 'ingesting' | 'done' | 'error';

interface TaggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anthropicApiKey: string;
  /** Called when ingest completes successfully so the map browser can
   *  refresh its data. */
  onIngestComplete: () => void;
}

export function TaggerDialog({ open, onOpenChange, anthropicApiKey, onIngestComplete }: TaggerDialogProps) {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [concurrency, setConcurrency] = useState(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<TaggerProgress[]>([]);
  const [result, setResult] = useState<TaggerResult | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log to the bottom as new lines arrive.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Subscribe to tagger progress events while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const unsub = window.electronAPI.onTaggerProgress((p) => {
      setLines((prev) => [...prev, p]);
    });
    return unsub;
  }, [open]);

  // Reset state when dialog closes.
  useEffect(() => {
    if (!open) {
      setSourcePath(null);
      setPhase('idle');
      setLines([]);
      setResult(null);
      setLimit(50);
    }
  }, [open]);

  const pickSource = useCallback(async () => {
    const path = await window.electronAPI.taggerPickSource();
    if (path) setSourcePath(path);
  }, []);

  const runPreview = useCallback(async () => {
    if (!sourcePath) return;
    setPhase('previewing');
    setLines([]);
    setResult(null);
    const r = await window.electronAPI.taggerPreview({
      sourcePath,
      apiKey: anthropicApiKey,
      limit,
      concurrency,
    });
    setResult(r);
    setPhase(r.exitCode === 0 ? 'previewed' : 'error');
  }, [sourcePath, anthropicApiKey, limit, concurrency]);

  const runIngest = useCallback(async () => {
    if (!sourcePath) return;
    setPhase('ingesting');
    setLines([]);
    setResult(null);
    const r = await window.electronAPI.taggerIngest({
      sourcePath,
      apiKey: anthropicApiKey,
      limit,
      concurrency,
    });
    setResult(r);
    if (r.exitCode === 0) {
      setPhase('done');
      onIngestComplete();
    } else {
      setPhase('error');
    }
  }, [sourcePath, anthropicApiKey, limit, concurrency, onIngestComplete]);

  const cancel = useCallback(async () => {
    await window.electronAPI.taggerCancel();
  }, []);

  const running = phase === 'previewing' || phase === 'ingesting';
  const hasApiKey = !!anthropicApiKey.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Add Maps</DialogTitle>
          <DialogDescription>Tag and import new battlemaps into your library.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-hidden">
          {/* Source folder picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Source Folder</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={pickSource} disabled={running} className="gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                {sourcePath ? 'Change' : 'Select folder'}
              </Button>
              {sourcePath && (
                <span className="truncate text-xs text-muted-foreground" title={sourcePath}>
                  {sourcePath}
                </span>
              )}
            </div>
          </div>

          {/* Options row */}
          {sourcePath && (
            <div className="flex items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tagger-limit" className="text-xs font-medium">
                  Batch limit
                </Label>
                <Input
                  id="tagger-limit"
                  type="number"
                  min={1}
                  max={10000}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                  disabled={running}
                  className="h-8 w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tagger-conc" className="text-xs font-medium">
                  Workers
                </Label>
                <Input
                  id="tagger-conc"
                  type="number"
                  min={1}
                  max={32}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
                  disabled={running}
                  className="h-8 w-20"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={runPreview} disabled={running} className="gap-1.5">
                  {phase === 'previewing' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  Preview
                </Button>
                <Button
                  size="sm"
                  onClick={runIngest}
                  disabled={running || !hasApiKey}
                  title={hasApiKey ? undefined : 'Set your Anthropic API key in Settings first'}
                  className="gap-1.5"
                >
                  {phase === 'ingesting' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Ingest
                </Button>
                {running && (
                  <Button variant="destructive" size="sm" onClick={cancel} className="gap-1.5">
                    <Square className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {!hasApiKey && sourcePath && (
            <p className="text-xs text-amber-400">
              No Anthropic API key configured. Set one in Settings to enable ingest. Preview (cost estimate) works
              without a key.
            </p>
          )}

          {/* Log output */}
          {lines.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed">
              {lines.map((l, i) => (
                <div key={i} className={l.type === 'stderr' ? 'text-amber-400' : 'text-foreground/80'}>
                  {l.line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {/* Result status */}
          {phase === 'done' && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Ingest complete. Map browser will refresh.
            </div>
          )}
          {phase === 'error' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Tagger exited with code {result?.exitCode ?? 'unknown'}. Check the log above for details.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
