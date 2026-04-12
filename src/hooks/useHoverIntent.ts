import { useCallback, useEffect, useRef, useState } from 'react';

export interface HoverState<T> {
  key: T;
  rect: DOMRect;
}

/**
 * Hover-intent hook with show/hide delays to prevent flicker.
 * - 300 ms delay before showing (avoids accidental triggers)
 * - 150 ms grace period before hiding (lets cursor travel to the popup)
 * - Instant key switch when already showing (no re-delay)
 */
export function useHoverIntent<T>(showDelay = 300, hideDelay = 150) {
  const [hover, setHover] = useState<HoverState<T> | null>(null);
  const showRef = useRef<ReturnType<typeof setTimeout>>();
  const hideRef = useRef<ReturnType<typeof setTimeout>>();
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = hover != null;
  }, [hover]);

  useEffect(
    () => () => {
      clearTimeout(showRef.current);
      clearTimeout(hideRef.current);
    },
    [],
  );

  const onEnter = useCallback(
    (key: T, rect: DOMRect) => {
      clearTimeout(hideRef.current);
      clearTimeout(showRef.current);
      if (activeRef.current) {
        setHover({ key, rect });
      } else {
        showRef.current = setTimeout(() => setHover({ key, rect }), showDelay);
      }
    },
    [showDelay],
  );

  const onLeave = useCallback(() => {
    clearTimeout(showRef.current);
    hideRef.current = setTimeout(() => setHover(null), hideDelay);
  }, [hideDelay]);

  /** Call from the popup's mouseenter to keep it open. */
  const cancelHide = useCallback(() => {
    clearTimeout(hideRef.current);
  }, []);

  /** Update the key without changing position (e.g. sibling switch). */
  const setKey = useCallback((key: T) => {
    setHover((prev) => (prev ? { ...prev, key } : null));
  }, []);

  return { hover, onEnter, onLeave, cancelHide, setKey } as const;
}
