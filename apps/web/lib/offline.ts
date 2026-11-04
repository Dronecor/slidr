"use client";

import type { Deck, DeckElement, KeyPoint } from "@slidr/shared";

/**
 * Offline deck pipeline: render a PDF entirely in the browser (no hub),
 * with slide images in IndexedDB and `idb:` URLs in the deck JSON.
 */

// ---------- IndexedDB image store ----------

const DB_NAME = "slidr";
const STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutImage(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbGetImage(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const idbUrl = (deckId: string, slideId: string) => `idb:${deckId}/${slideId}`;
const idbKey = (url: string) => url.slice("idb:".length);

/** Resolve `idb:` URLs to blob object URLs for rendering. No-op for other URLs. */
export async function hydrateDeck(deck: Deck): Promise<Deck> {
  await Promise.all(
    deck.slides.map(async (s) => {
      if (!s.imageUrl.startsWith("idb:")) return;
      try {
        const blob = await idbGetImage(idbKey(s.imageUrl));
        if (blob) s.imageUrl = URL.createObjectURL(blob);
      } catch { /* keep idb: URL; SlideView shows a placeholder */ }
    })
  );
  return deck;
}

/** Restore `blob:` URLs to their persisted `idb:` form before saving. */
export function dehydrateDeck(deck: Deck): Deck {
  for (const s of deck.slides) {
    if (s.imageUrl.startsWith("blob:")) s.imageUrl = idbUrl(deck.id, s.id);
  }
  return deck;
}

// ---------- Client-side PDF ingestion ----------

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))),
      "image/jpeg",
      0.92
    );
  });
}

export async function ingestPdfOffline(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<Deck> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

  const deckId = `deck_${Date.now()}`;
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;

  const slides: Deck["slides"] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i - 1, pdf.numPages);
    const page = await pdf.getPage(i);
    const slideId = `s${i}`;

    // Render the slide image at 1920 px wide.
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1920 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    await page.render({ canvasContext: ctx, viewport }).promise;
    await idbPutImage(`${deckId}/${slideId}`, await canvasToBlob(canvas));

    // Extract text: title + key points from the longest lines.
    let title = `Slide ${i}`;
    const keyPoints: KeyPoint[] = [];
    try {
      const tc = await page.getTextContent();
      const lines = (tc.items as { str?: string }[])
        .map((it) => (it.str ?? "").trim())
        .filter((s) => s.length > 2);
      if (lines.length > 0) {
        const first = lines[0] as string;
        title = first.length > 90 ? `${first.slice(0, 87)}…` : first;
        lines.slice(0, 8).forEach((text, n) => {
          if (text.length >= 8 && text.length <= 160) {
            keyPoints.push({ id: `${slideId}k${n + 1}`, text, weight: 1 });
          }
        });
      }
    } catch { /* text is a bonus; the image is the deck */ }

    // Extract link annotations as clickable elements.
    const elements: DeckElement[] = [];
    try {
      const annots = await page.getAnnotations();
      let n = 0;
      for (const a of annots as { subtype?: string; url?: string; rect?: number[] }[]) {
        if (a.subtype !== "Link" || !a.url || !a.rect || elements.length >= 12) continue;
        n += 1;
        const [x1, y1, x2, y2] = a.rect;
        elements.push({
          id: `${slideId}eL${n}`,
          type: "link",
          label: `Link ${n}`,
          box: {
            x: Math.max(0, Math.min(x1, x2) / base.width),
            y: Math.max(0, 1 - Math.max(y1, y2) / base.height),
            w: Math.min(1, Math.abs(x2 - x1) / base.width),
            h: Math.min(1, Math.abs(y2 - y1) / base.height),
          },
          aliases: [],
          url: a.url,
          parentId: null,
          source: "pdf",
        });
      }
    } catch { /* links are a bonus */ }

    slides.push({
      id: slideId,
      index: i - 1,
      imageUrl: idbUrl(deckId, slideId),
      width: canvas.width,
      height: canvas.height,
      title,
      notes: "",
      summary: title,
      keyPoints,
      nextCue: "",
      triggerPhrases: [],
      elements,
    });
    page.cleanup();
  }
  onProgress?.(pdf.numPages, pdf.numPages);
  await pdf.destroy();

  return {
    id: deckId,
    title: file.name.replace(/\.pdf$/i, ""),
    status: "review",
    slides,
  };
}
