import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { Message } from './types';

let nextId = 0;
function uid(): string {
  return `msg-${Date.now()}-${nextId++}`;
}

export function ChatDrawer({
  open,
  onClose,
  anthropicApiKey,
  chatModel,
  activeToolUrl,
}: {
  open: boolean;
  onClose: () => void;
  anthropicApiKey: string;
  chatModel: string;
  activeToolUrl?: string;
}) {
  const CHAT_MIN = 280;
  const CHAT_MAX = 1600;
  const CHAT_DEFAULT = 380;

  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [anim, setAnim] = useState<'open' | 'closing'>('open');
  const [width, setWidth] = useState(CHAT_DEFAULT);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startW: number } | null>(null);
  // Track the assistant message id being streamed so the chunk listener
  // can append to the right message even across re-renders.
  const streamingIdRef = useRef<string | null>(null);

  // Subscribe to chat-chunk events from the main process. The listener
  // stays active for the lifetime of the component and accumulates
  // deltas into whichever assistant message is currently streaming.
  useEffect(() => {
    const unsub = api.onChatChunk((chunk) => {
      const id = streamingIdRef.current;
      if (!id) return;

      if (chunk.type === 'delta' && chunk.text) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk.text } : m)));
      } else if (chunk.type === 'tool-status' && chunk.text) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: `*${chunk.text}*\n\n` } : m)));
      } else if (chunk.type === 'done') {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)));
        streamingIdRef.current = null;
        setStreaming(false);
      } else if (chunk.type === 'error') {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: chunk.error ?? 'An error occurred.', streaming: false } : m)),
        );
        streamingIdRef.current = null;
        setStreaming(false);
      }
    });
    return unsub;
  }, []);

  // Resize drag: pointer down on the left-edge handle starts tracking,
  // pointermove updates width, pointerup ends.
  const onResizePointerDown = useCallback(
    (e: RPointerEvent) => {
      e.preventDefault();
      dragStartRef.current = { startX: e.clientX, startW: width };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onResizePointerMove = useCallback((e: RPointerEvent) => {
    const drag = dragStartRef.current;
    if (!drag) return;
    // Dragging left increases width (panel is on the right edge).
    const newW = Math.min(CHAT_MAX, Math.max(CHAT_MIN, drag.startW - (e.clientX - drag.startX)));
    setWidth(newW);
  }, []);

  const onResizePointerUp = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  // Mirror the DetailPane close-on-animation-end pattern.
  const handleClose = useCallback(() => {
    setAnim('closing');
    const el = panelRef.current;
    if (!el) {
      onClose();
      return;
    }
    const onEnd = () => {
      el.removeEventListener('animationend', onEnd);
      setAnim('open');
      onClose();
    };
    el.addEventListener('animationend', onEnd);
  }, [onClose]);

  const handleSend = useCallback(
    (raw: string) => {
      if (!anthropicApiKey) {
        const errMsg: Message = {
          id: uid(),
          role: 'assistant',
          content: 'No API key set. Add your Anthropic key in Settings.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return;
      }

      // Detect /rule prefix — triggers two-pass adversarial review mode.
      const rulesMode = /^\/rule\s/i.test(raw);
      const text = rulesMode ? raw.replace(/^\/rule\s+/i, '') : raw;

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };

      const assistantId = uid();
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      };

      streamingIdRef.current = assistantId;
      setStreaming(true);
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Build the history for the API — include the new user message but
      // exclude the empty assistant placeholder.
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // If the user has a tool page open, extract its text content to
      // give the AI context about what they're looking at.
      const sendWithContext = async () => {
        let toolContext: string | undefined;
        if (activeToolUrl) {
          try {
            const pageText = await api.getToolPageContent(activeToolUrl);
            if (pageText) toolContext = pageText;
          } catch {
            // Non-fatal — just send without context.
          }
        }
        return api.chatSend({
          messages: history,
          apiKey: anthropicApiKey,
          model: chatModel as any,
          toolContext,
          rulesMode,
        });
      };

      sendWithContext().catch(() => {
        // Error chunk already sent via onChatChunk; this catch prevents
        // an unhandled rejection if the IPC invoke itself fails.
        streamingIdRef.current = null;
        setStreaming(false);
      });
    },
    [anthropicApiKey, chatModel, messages, activeToolUrl],
  );

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border backdrop-blur-md"
      style={{
        width,
        backgroundColor: 'hsl(var(--background) / 0.85)',
        animation:
          anim === 'open' ? 'dmtool-slide-in-right 200ms ease-out' : 'dmtool-slide-out-right 150ms ease-out forwards',
      }}
    >
      {/* Resize handle — left edge */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      />
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium">Chat</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close chat"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={streaming} />
    </div>
  );
}
