"use client";

import type { Deck, SlideElement } from "@stage-pilot/shared";

const HUB = () =>
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_HUB_URL || "/api/hub"
    : process.env.HUB_URL || "http://localhost:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HUB()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface HubHealth {
  ok: boolean;
  metaConfigured?: boolean;
  sessions?: number;
  decisions?: number;
  p50?: number | null;
  p95?: number | null;
}

export const api = {
  listDecks: () => req<{ decks: Deck[] }>("/decks").then((r) => r.decks),
  getDeck: (id: string) =>
    req<{ deck: Deck; progress: unknown }>(`/decks/${id}`).then((r) => r.deck),
  uploadDeck: async (file: File) => {
    // The hub takes raw file bytes plus file-name headers (no multipart).
    const res = await fetch(`${HUB()}/decks`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": file.name,
        "X-Deck-Title": file.name.replace(/\.[^.]+$/, ""),
      },
      body: file,
    });
    if (!res.ok) throw new Error(`upload: ${res.status}`);
    return res.json() as Promise<{ deckId: string }>;
  },
  saveElements: (deckId: string, slideId: string, elements: SlideElement[]) =>
    req(`/decks/${deckId}/slides/${slideId}/elements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    }),
  createSession: (deckId: string) =>
    req<{ sessionId: string }>(`/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId }),
    }),
  health: () => req<HubHealth>("/health"),
};

export function useMock(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("mock");
}
