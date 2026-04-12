import { createPortal } from 'react-dom';

interface FloatingPanelProps {
  /** Bounding rect of the element that triggered the hover. */
  anchorRect: DOMRect;
  width?: number;
  children: React.ReactNode;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Fixed-position floating panel anchored to a trigger element.
 * Prefers the right side of the anchor; falls back to left if
 * there isn't enough viewport space.
 */
export function FloatingPanel({ anchorRect, width = 380, children, onMouseEnter, onMouseLeave }: FloatingPanelProps) {
  const gap = 8;
  const margin = 16;

  const fitsRight = anchorRect.right + gap + width <= window.innerWidth - margin;
  const left = fitsRight ? anchorRect.right + gap : anchorRect.left - gap - width;

  const maxH = window.innerHeight - margin * 2;
  const top = Math.max(margin, Math.min(anchorRect.top, window.innerHeight - maxH - margin));

  return createPortal(
    <div
      className="fixed z-50 overflow-auto rounded-lg border border-border bg-card text-card-foreground shadow-xl"
      style={{ left, top, width, maxHeight: maxH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body,
  );
}
