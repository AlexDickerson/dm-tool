import { useCallback, useEffect, useRef, useState } from 'react';
import { readNumber, writeString } from '@/lib/storage-utils';

interface DetailOverlayProps {
  children: React.ReactNode;
  /** localStorage key for persisting width. */
  storageKey: string;
  /** Pixel width when no saved value exists (default 400). */
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Set to true to play the close animation. When complete, `onClosed` fires. */
  closing?: boolean;
  /** Called after the close animation finishes so the parent can unmount. */
  onClosed: () => void;
}

/**
 * Semi-transparent overlay panel that slides in from the right edge,
 * matching the chat drawer's frosted-glass look. Resizable via a
 * left-edge drag handle; width is persisted to localStorage.
 *
 * Render inside a `relative overflow-hidden` container so it covers
 * the content beneath.
 */
export function DetailOverlay({
  children,
  storageKey,
  defaultWidth = 400,
  minWidth = 280,
  maxWidth = 1200,
  closing = false,
  onClosed,
}: DetailOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const [width, setWidth] = useState(() => readNumber(storageKey, defaultWidth, minWidth, maxWidth));

  // Persist width
  useEffect(() => {
    writeString(storageKey, String(width));
  }, [storageKey, width]);

  // Close animation
  useEffect(() => {
    if (!closing) return;
    const el = ref.current;
    if (!el) {
      onClosedRef.current();
      return;
    }
    const handler = () => onClosedRef.current();
    el.addEventListener('animationend', handler);
    return () => el.removeEventListener('animationend', handler);
  }, [closing]);

  // Resize via left-edge drag (dragging left = wider)
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

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
      const delta = startX.current - e.clientX; // inverted: left = grow
      setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta)));
    },
    [minWidth, maxWidth],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={ref}
      className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border backdrop-blur-md"
      style={{
        width,
        backgroundColor: 'hsl(var(--background) / 0.85)',
        animation: closing ? 'dmtool-slide-out-right 150ms ease-out forwards' : 'dmtool-slide-in-right 200ms ease-out',
      }}
    >
      {/* Left-edge resize handle */}
      <div
        className="absolute inset-y-0 left-0 z-10 cursor-col-resize select-none"
        style={{ width: 6 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border" />
      </div>

      {children}
    </div>
  );
}
