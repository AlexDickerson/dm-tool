import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100. Omit (or pass `null`) for indeterminate mode with a moving
   *  highlight — useful when total is unknown or work is pre-flight. */
  value?: number | null;
}

/** Minimal determinate/indeterminate progress bar.
 *
 *  No Radix dep: it's a CSS-only track + fill. If we ever need ARIA progress
 *  semantics beyond the role, pull in `@radix-ui/react-progress` and swap.
 */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ value, className, ...props }, ref) => {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      {indeterminate ? (
        <div
          className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary/80"
          // Inline style bypasses the Tailwind JIT — arbitrary `animate-[]`
          // utilities occasionally fail to emit during HMR in this project.
          // The keyframes themselves are defined in src/index.css.
          style={{ animation: 'dmtool-progress-indeterminate 1.2s ease-in-out infinite' }}
        />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
});
Progress.displayName = 'Progress';
