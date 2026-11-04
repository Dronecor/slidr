"use client";

import type { Deck, DeckElement } from "@slidr/shared";

const HUB = () =>
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_HUB_URL || "/api/hub"
    : "http://localhost:3100";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HUB()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  listDecks: () => req<{ decks: Deck[] }>("/decks").then((r) => r.decks),
  getDeck: (id: string) => req<Deck>(`/decks/${id}`),
  uploadDeck: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${HUB()}/decks`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`upload: ${res.status}`);
    return res.json() as Promise<{ deckId: string }>;
  },
  saveElements: (deckId: string, slideId: string, elements: DeckElement[]) =>
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
  health: () => req<{ ok: boolean }>("/health"),
};

export function useMock(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("mock");
}
