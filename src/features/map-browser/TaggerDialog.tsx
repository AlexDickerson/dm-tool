import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { FolderOpen, Play, Eye, Square, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaggerProgress, TaggerResult } from '@shared/types';

type Phase = 'idle' | 'previewing' | 'previewed' | 'ingesting' | 'done' | 'error';

/** Live per-file counters parsed from the Python CLI's `##PROGRESS` sentinel
 *  lines (see `cli.py::_ingest_from_source_cmd::on_progress`). Format is:
 *    ##PROGRESS {done}/{total} {OK|FAIL} {filename}
 *  When we see one, we update this object; when we don't (e.g. during
 *  preview or before the first file finishes) it stays null and the bar
 *  renders indeterminate. */
interface ProgressState {
  done: number;
  total: number;
  tagged: number;
  failed: number;
  current: string | null;
}

const PROGRESS_RE = /^##PROGRESS\s+(\d+)\/(\d+)\s+(OK|FAIL)\s+(.+)$/;

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
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Visible log lines — strip the `##PROGRESS` sentinel so it doesn't clutter
  // the log pane. The sentinel is consumed by the progress-parsing effect
  // below; the raw string is machine-facing, not human-facing.
  const visibleLines = useMemo(
    () => lines.filter((l) => !(l.type === 'stdout' && l.line.startsWith('##PROGRESS '))),
    [lines],
  );

  // Auto-scroll the log to the bottom as new lines arrive (only when the
  // user has it expanded — otherwise we're wasting a scroll).
  useEffect(() => {
    if (logExpanded) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleLines, logExpanded]);

  // Subscribe to tagger progress events while the dialog is open. Two
  // effects come out of each line: (1) it lands in `lines` for the log pane,
  // and (2) if it's a `##PROGRESS` sentinel we bump the progress counters.
  useEffect(() => {
    if (!open) return;
    const unsub = window.electronAPI.onTaggerProgress((p) => {
      setLines((prev) => [...prev, p]);
      if (p.type !== 'stdout') return;
      const m = p.line.match(PROGRESS_RE);
      if (!m) return;
      const done = Number(m[1]);
      const total = Number(m[2]);
      const ok = m[3] === 'OK';
      const filename = m[4];
      setProgress((prev) => ({
        done,
        total,
        tagged: (prev?.tagged ?? 0) + (ok ? 1 : 0),
        failed: (prev?.failed ?? 0) + (ok ? 0 : 1),
        current: filename,
      }));
    });
    return unsub;
  }, [open]);

  // Auto-expand the log pane on error so the failure is one glance away
  // instead of hidden behind a disclosure.
  useEffect(() => {
    if (phase === 'error') setLogExpanded(true);
  }, [phase]);

  // Reset state when dialog closes.
  useEffect(() => {
    if (!open) {
      setSourcePath(null);
      setPhase('idle');
      setLines([]);
      setResult(null);
      setProgress(null);
      setLogExpanded(false);
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
    setProgress(null);
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
    setProgress(null);
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
                  max={1000}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
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

          {/* Live progress panel + collapsible log */}
          {(running || progress || visibleLines.length > 0) && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-md border border-border bg-card/40 p-3">
              {/* Phase label + counts header */}
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">
                  {phase === 'previewing' && 'Scanning source…'}
                  {phase === 'ingesting' && 'Tagging maps…'}
                  {phase === 'previewed' && 'Preview complete'}
                  {phase === 'done' && 'Ingest complete'}
                  {phase === 'error' && 'Stopped'}
                  {phase === 'idle' && 'Ready'}
                </span>
                {progress && phase === 'ingesting' && (
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {progress.done} / {progress.total}
                  </span>
                )}
              </div>

              {/* Progress bar — indeterminate for preview (the CLI doesn't
                  emit per-file ticks in that mode), determinate for ingest
                  once the first ##PROGRESS line arrives. */}
              {(running || (progress && phase !== 'error')) && (
                <Progress
                  value={
                    phase === 'previewing' || !progress
                      ? null
                      : Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)
                  }
                />
              )}

              {/* Current file + tagged/quarantined counters */}
              {progress && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {progress.current && (
                    <span className="flex min-w-0 items-baseline gap-1.5 truncate">
                      <span className="text-muted-foreground">Current</span>
                      <span className="truncate font-mono text-foreground/90">{progress.current}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-400" />
                    <span className="tabular-nums text-foreground/90">{progress.tagged}</span>
                    <span className="text-muted-foreground">tagged</span>
                  </span>
                  {progress.failed > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 text-amber-400" />
                      <span className="tabular-nums text-foreground/90">{progress.failed}</span>
                      <span className="text-muted-foreground">quarantined</span>
                    </span>
                  )}
                </div>
              )}

              {/* Collapsible log — hidden by default; auto-expands on error
                  so failure details are one glance away. */}
              {visibleLines.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <button
                    type="button"
                    onClick={() => setLogExpanded((e) => !e)}
                    className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className={cn('h-3 w-3 transition-transform', logExpanded && 'rotate-90')} />
                    Log ({visibleLines.length} {visibleLines.length === 1 ? 'line' : 'lines'})
                  </button>
                  {logExpanded && (
                    <div className="mt-2 min-h-0 flex-1 overflow-auto rounded border border-border bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
                      {visibleLines.map((l, i) => (
                        <div key={i} className={l.type === 'stderr' ? 'text-amber-400' : 'text-foreground/80'}>
                          {l.line}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Terminal-state banners */}
          {phase === 'done' && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Ingest complete. Map browser will refresh.
            </div>
          )}
          {phase === 'error' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Tagger exited with code {result?.exitCode ?? 'unknown'}. Expand the log for details.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
