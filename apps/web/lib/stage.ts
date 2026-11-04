"use client";

import type { Deck } from "@stage-pilot/shared";

const CACHE = "slidr-decks-v1";
const DECK_KEY = (id: string) => `slidr.deck.${id}`;

/** Offline behaviour: slide images in CacheStorage, deck JSON in localStorage. */
export async function cacheDeck(deck: Deck): Promise<void> {
  try {
    localStorage.setItem(DECK_KEY(deck.id), JSON.stringify(deck));
  } catch { /* quota */ }
  try {
    const cache = await caches.open(CACHE);
    await Promise.all(
      deck.slides.map((s) =>
        s.imageUrl.startsWith("data:") || s.imageUrl.startsWith("blob:") || s.imageUrl.startsWith("idb:")
          ? Promise.resolve()
          : cache.add(s.imageUrl).catch(() => undefined)
      )
    );
  } catch { /* no CacheStorage */ }
}

export function readCachedDeck(id: string): Deck | null {
  try {
    const raw = localStorage.getItem(DECK_KEY(id));
    return raw ? (JSON.parse(raw) as Deck) : null;
  } catch {
    return null;
  }
}

// ---------- Projector display routing ----------

export const displayName = (sessionId: string) => `slidr-audience-${sessionId}`;
export const displayUrl = (sessionId: string, mock: boolean) =>
  `/audience/${encodeURIComponent(sessionId)}${mock ? "?mock=1" : ""}`;

export interface ScreenInfo {
  availLeft: number;
  availTop: number;
  isPrimary: boolean;
  label: string;
}

/** List screens via the Window Management API. Null = unsupported or denied. */
export async function getScreens(): Promise<ScreenInfo[] | null> {
  const w = window as unknown as {
    getScreenDetails?: () => Promise<{ screens: ScreenInfo[] }>;
  };
  if (typeof w.getScreenDetails !== "function") return null;
  try {
    const details = await w.getScreenDetails();
    return details.screens;
  } catch {
    return null; // permission denied
  }
}

/**
 * Open a blank display window synchronously inside a click handler so popup
 * blockers allow it. Navigate it later with `w.location.href = displayUrl(...)`.
 */
export function preopenDisplay(name: string): Window | null {
  try {
    return window.open("", name, "popup=yes,width=1280,height=800");
  } catch {
    return null;
  }
}

/** Move an open display window onto the external screen. False = stayed put. */
export async function placeDisplay(w: Window): Promise<boolean> {
  try {
    const screens = await getScreens();
    const external = screens?.find((s) => !s.isPrimary);
    if (external) {
      w.moveTo(external.availLeft + 40, external.availTop + 40);
      try { w.focus(); } catch { /* noop */ }
      return true;
    }
  } catch { /* user drags it over */ }
  return false;
}

/** Open the audience window, ideally straight on the projector. */
export async function openAudienceWindow(sessionId: string, mock: boolean): Promise<Window | null> {
  try {
    // Same name reuses (and refocuses) an already-open display window.
    const w = window.open(displayUrl(sessionId, mock), displayName(sessionId), "popup=yes,width=1280,height=800");
    if (!w) return null;
    await placeDisplay(w);
    return w;
  } catch {
    return null;
  }
}
