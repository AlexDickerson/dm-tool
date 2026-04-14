import { ipcMain } from 'electron';
import type { ChatMessage, ChatModel } from '../../shared/types.js';
import { streamChat } from '../chat.js';

export function registerChatHandlers(
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
  ipcMain.handle(
    'chatSend',
    async (_e, args: { messages: ChatMessage[]; apiKey: string; model?: ChatModel }): Promise<void> => {
      if (!args?.apiKey) {
        throw new Error('chatSend: apiKey is required');
      }
      const win = getMainWindow();
      const sendChunk = (chunk: { type: string; text?: string; error?: string }) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('chat-chunk', chunk);
        }
      };

      try {
        await streamChat({
          apiKey: args.apiKey,
          messages: args.messages ?? [],
          model: args.model,
          onChunk: sendChunk,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendChunk({ type: 'error', error: message });
      }
    },
  );
}
