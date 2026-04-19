// Centralised hook for all user preferences that persist across sessions.
// Extracted from MainApp in App.tsx to keep that component focused on
// layout and tab routing.

import { useEffect, useRef, useState } from 'react';
import {
  STORAGE_KEYS,
  UI_SCALE,
  HEADER_REMS,
  THUMB_SCALE,
  FONT_STACKS,
  THEME_DEFAULT,
  DEFAULT_CHAT_MODEL,
  DEFAULT_TOOLS,
  PARTY_LEVEL,
  type FontFamily,
  type ThemeId,
  type ToolEntry,
} from '@/lib/constants';
import { readJson, readNumber, readString, writeJson, writeString } from '@/lib/storage-utils';

export interface Preferences {
  uiScale: number;
  setUiScale: React.Dispatch<React.SetStateAction<number>>;
  thumbScale: number;
  setThumbScale: React.Dispatch<React.SetStateAction<number>>;
  anthropicApiKey: string;
  setAnthropicApiKey: React.Dispatch<React.SetStateAction<string>>;
  chatModel: string;
  setChatModel: React.Dispatch<React.SetStateAction<string>>;
  fontFamily: FontFamily;
  setFontFamily: React.Dispatch<React.SetStateAction<FontFamily>>;
  theme: ThemeId;
  setTheme: React.Dispatch<React.SetStateAction<ThemeId>>;
  toolUrls: ToolEntry[];
  setToolUrls: React.Dispatch<React.SetStateAction<ToolEntry[]>>;
  toolFavicons: boolean;
  setToolFavicons: React.Dispatch<React.SetStateAction<boolean>>;
  partyLevel: number;
  setPartyLevel: React.Dispatch<React.SetStateAction<number>>;
}

export function usePreferences(): Preferences {
  const [uiScale, setUiScale] = useState<number>(() =>
    readNumber(STORAGE_KEYS.uiScale, UI_SCALE.default, UI_SCALE.min, UI_SCALE.max),
  );
  const [thumbScale, setThumbScale] = useState<number>(() =>
    readNumber(STORAGE_KEYS.thumbScale, THUMB_SCALE.default, THUMB_SCALE.min, THUMB_SCALE.max),
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState<string>('');
  const [chatModel, setChatModel] = useState<string>(() => readString(STORAGE_KEYS.chatModel) || DEFAULT_CHAT_MODEL);
  const [fontFamily, setFontFamily] = useState<FontFamily>(
    () => (readString(STORAGE_KEYS.fontFamily) as FontFamily | null) || 'sans-serif',
  );
  const [theme, setTheme] = useState<ThemeId>(
    () => (readString(STORAGE_KEYS.theme) as ThemeId | null) || THEME_DEFAULT,
  );
  const [toolUrls, setToolUrls] = useState<ToolEntry[]>(() => readJson(STORAGE_KEYS.toolUrls, DEFAULT_TOOLS));
  const [toolFavicons, setToolFavicons] = useState<boolean>(() => readString(STORAGE_KEYS.toolFavicons) === 'true');
  const [partyLevel, setPartyLevel] = useState<number>(() =>
    readNumber(STORAGE_KEYS.partyLevel, PARTY_LEVEL.default, PARTY_LEVEL.min, PARTY_LEVEL.max),
  );

  // Load API key from secure storage on mount
  useEffect(() => {
    window.electronAPI?.secureLoad('anthropicApiKey').then((key) => {
      if (key) setAnthropicApiKey(key);
    });
  }, []);

  // Apply the UI scale to the root <html> element and tell the main
  // process to resize the native title-bar overlay to match. Runs on
  // mount (so a saved preference is restored) and on every scale change.
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}px`;
    writeString(STORAGE_KEYS.uiScale, String(uiScale));
    // The native min/max/close buttons live outside the DOM, so we have
    // to push their height through IPC. Header is HEADER_REMS rem tall,
    // so the pixel height equals uiScale * HEADER_REMS.
    window.electronAPI?.setTitleBarOverlayHeight(uiScale * HEADER_REMS).catch(() => {
      // Ignore — older builds without this IPC handler shouldn't crash
      // the renderer; the overlay will just stay at its default height.
    });
  }, [uiScale]);

  // Persist thumb scale separately. ThumbnailGrid reads this via prop
  // and recomputes column count + virtualizer measurements when it
  // changes.
  useEffect(() => {
    writeString(STORAGE_KEYS.thumbScale, String(thumbScale));
  }, [thumbScale]);

  // Persist API key via secure storage (OS keychain-backed).
  // Skip the initial empty string — only persist user-initiated changes.
  const apiKeyInitialized = useRef(false);
  useEffect(() => {
    if (!apiKeyInitialized.current) {
      if (anthropicApiKey) apiKeyInitialized.current = true;
      else return;
    }
    if (anthropicApiKey) {
      window.electronAPI?.secureStore('anthropicApiKey', anthropicApiKey);
    } else {
      window.electronAPI?.secureDelete('anthropicApiKey');
    }
  }, [anthropicApiKey]);

  useEffect(() => {
    writeString(STORAGE_KEYS.chatModel, chatModel);
  }, [chatModel]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-body', FONT_STACKS[fontFamily]);
    writeString(STORAGE_KEYS.fontFamily, fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    if (theme === THEME_DEFAULT) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    writeString(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.toolUrls, toolUrls);
  }, [toolUrls]);

  useEffect(() => {
    writeString(STORAGE_KEYS.toolFavicons, String(toolFavicons));
  }, [toolFavicons]);

  useEffect(() => {
    writeString(STORAGE_KEYS.partyLevel, String(partyLevel));
  }, [partyLevel]);

  return {
    uiScale,
    setUiScale,
    thumbScale,
    setThumbScale,
    anthropicApiKey,
    setAnthropicApiKey,
    chatModel,
    setChatModel,
    fontFamily,
    setFontFamily,
    theme,
    setTheme,
    toolUrls,
    setToolUrls,
    toolFavicons,
    setToolFavicons,
    partyLevel,
    setPartyLevel,
  };
}
