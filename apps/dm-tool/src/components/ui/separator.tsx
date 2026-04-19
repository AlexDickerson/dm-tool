import * as React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';

interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  variant?: 'default' | 'ornate';
}

const Separator = React.forwardRef<React.ElementRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(
  ({ className, orientation = 'horizontal', decorative = true, variant = 'default', ...props }, ref) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        variant === 'default' && 'bg-border',
        className,
      )}
      style={
        variant === 'ornate' && orientation === 'horizontal'
          ? {
              background:
                'linear-gradient(90deg, transparent 0%, hsl(var(--border)) 15%, hsl(var(--primary) / 0.25) 50%, hsl(var(--border)) 85%, transparent 100%)',
            }
          : undefined
      }
      {...props}
    />
  ),
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
