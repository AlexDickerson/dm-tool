import { useEffect, useRef } from 'react';

interface DetailOverlayProps {
  children: React.ReactNode;
  /** Pixel width of the panel (default 400). */
  width?: number;
  /** Set to true to play the close animation. When complete, `onClosed` fires. */
  closing?: boolean;
  /** Called after the close animation finishes so the parent can unmount. */
  onClosed: () => void;
}

/**
 * Semi-transparent overlay panel that slides in from the right edge,
 * matching the chat drawer's frosted-glass look.
 *
 * Render inside a `relative overflow-hidden` container so it covers
 * the content beneath.
 */
export function DetailOverlay({ children, width = 400, closing = false, onClosed }: DetailOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

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
      {children}
    </div>
  );
}
