"use client";

import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light" | "system";

const STORAGE_KEY = "streetlight-theme";
const THEME_EVENT = "streetlight-theme-change";

function readTheme(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
}

function subscribeTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(THEME_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(THEME_EVENT, listener);
  };
}

function subscribeColorScheme(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useTerminalTheme() {
  const themeMode = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as ThemeMode);
  const systemDark = useSyncExternalStore(
    subscribeColorScheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const resolvedTheme: "dark" | "light" = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  function setThemeMode(next: ThemeMode) {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return { themeMode, resolvedTheme, setThemeMode };
}
