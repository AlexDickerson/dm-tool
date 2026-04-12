import { useCallback, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { AonHoverCard } from './AonHoverCard';
import type { Message } from './types';

/** Render links — AoN links get a hover card, others open externally. */
function ChatLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = props.href ?? '';
  let isAon = false;
  try {
    const hostname = new URL(href).hostname;
    isAon = hostname === 'aonprd.com' || hostname.endsWith('.aonprd.com');
  } catch {
    // malformed URL — not AoN
  }

  const openExternal = useCallback(() => {
    if (href) window.electronAPI?.openExternal?.(href);
  }, [href]);

  if (isAon) {
    return (
      <AonHoverCard href={href} onNavigate={openExternal}>
        {props.children}
      </AonHoverCard>
    );
  }

  return (
    <a
      {...props}
      onClick={(e) => {
        e.preventDefault();
        openExternal();
      }}
      className="underline text-primary hover:text-primary/80 cursor-pointer"
    />
  );
}

const markdownComponents = { a: ChatLink };

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message. Use the nearest scrollable
  // ancestor (the Radix ScrollArea viewport) rather than scrollIntoView,
  // which can bubble up and shift the entire window.
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const viewport = el.closest('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages.length]);

  return (
    <ScrollArea className="flex-1">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          No messages yet. Start a conversation below.
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-white'
                  : 'mr-auto bg-accent text-accent-foreground chat-markdown',
              )}
            >
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <Markdown components={markdownComponents}>{msg.content}</Markdown>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </ScrollArea>
  );
}
