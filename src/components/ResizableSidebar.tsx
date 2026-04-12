import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableSidebarProps {
  /** localStorage key for persisting width. */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  children: React.ReactNode;
}

export function ResizableSidebar({
  storageKey,
  defaultWidth = 200,
  minWidth = 120,
  maxWidth = 400,
  children,
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = Number(saved);
        if (Number.isFinite(n)) return Math.max(minWidth, Math.min(maxWidth, n));
      }
    } catch {
      // non-fatal
    }
    return defaultWidth;
  });

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // non-fatal
    }
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
      const delta = e.clientX - startX.current;
      setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta)));
    },
    [minWidth, maxWidth],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="relative shrink-0" style={{ width }}>
      {children}
      {/* Drag handle */}
      <div
        className="absolute right-0 top-0 z-10 h-full cursor-col-resize select-none"
        style={{ width: 5 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border transition-colors" />
      </div>
    </div>
  );
}
