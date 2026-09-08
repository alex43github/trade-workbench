"use client";

import { useSyncExternalStore } from "react";

const FONT_SCALE_KEY = "streetlight-font-scale";
const LEGACY_FONT_SCALE_KEY = "streetlight-trade-font-scale";
const FONT_SCALE_EVENT = "streetlight-font-scale-change";

export const FONT_SCALE_MIN = 1;
export const FONT_SCALE_MAX = 1.5;
export const FONT_SCALE_DEFAULT = 1.2;

function clampFontScale(value: number) {
  return Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, value));
}

function readFontScale() {
  if (typeof window === "undefined") return FONT_SCALE_DEFAULT;
  const stored = Number(window.localStorage.getItem(FONT_SCALE_KEY) ?? window.localStorage.getItem(LEGACY_FONT_SCALE_KEY));
  return Number.isFinite(stored) ? clampFontScale(stored) : FONT_SCALE_DEFAULT;
}

function subscribeFontScale(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(FONT_SCALE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(FONT_SCALE_EVENT, listener);
  };
}

export function setFontScale(value: number) {
  const next = clampFontScale(value);
  window.localStorage.setItem(FONT_SCALE_KEY, String(next));
  window.dispatchEvent(new Event(FONT_SCALE_EVENT));
}

export function useFontScale() {
  const fontScale = useSyncExternalStore(subscribeFontScale, readFontScale, () => FONT_SCALE_DEFAULT);
  return { fontScale, setFontScale };
}
