import { useCallback, useEffect, useRef, useState } from 'react';
import { readNumber, writeString } from '@/lib/storage-utils';

interface ResizableSidebarProps {
  /** localStorage key for persisting width. */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Which edge the panel is anchored to. 'left' (default) puts the drag
   *  handle on the right edge and dragging right widens; 'right' mirrors
   *  both so the panel can sit on the right side of a layout. */
  side?: 'left' | 'right';
  children: React.ReactNode;
}

export function ResizableSidebar({
  storageKey,
  defaultWidth = 200,
  minWidth = 120,
  maxWidth = 400,
  side = 'left',
  children,
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(() => readNumber(storageKey, defaultWidth, minWidth, maxWidth));

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    writeString(storageKey, String(width));
  }, [storageKey, width]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const rawDelta = e.clientX - startX.current;
      // For a right-anchored panel, dragging left must grow the panel, so
      // flip the sign of the delta.
      const delta = side === 'right' ? -rawDelta : rawDelta;
      setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta)));
    },
    [minWidth, maxWidth, side],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handlePositionClass = side === 'right' ? 'left-0' : 'right-0';
  const handleLineClass = side === 'right' ? 'left-0' : 'right-0';

  return (
    <div className="relative shrink-0" style={{ width }}>
      {children}
      {/* Drag handle */}
      <div
        className={`absolute ${handlePositionClass} top-0 z-10 h-full cursor-col-resize select-none`}
        style={{ width: 5 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className={`pointer-events-none absolute inset-y-0 ${handleLineClass} w-px bg-border transition-colors`} />
      </div>
    </div>
  );
}
