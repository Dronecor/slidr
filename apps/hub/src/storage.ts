import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Deck } from "@stage-pilot/shared";
import type { HubConfig } from "./config.js";

export interface DeckStore {
  saveDeck(deck: Deck): Promise<void>;
  getDeck(id: string): Promise<Deck | null>;
  listDecks(): Promise<{ id: string; title: string; status: string }[]>;
  saveSlideImage(deckId: string, index: number, png: Buffer): Promise<string>;
  saveOriginal(deckId: string, filename: string, data: Buffer): Promise<string>;
}

/** Local disk store for the laptop demo. No keys needed. */
export class DiskDeckStore implements DeckStore {
  constructor(private dataDir: string) {}

  private deckPath(id: string): string { return path.join(this.dataDir, "decks", `${id}.json`); }

  async saveDeck(deck: Deck): Promise<void> {
    await mkdir(path.join(this.dataDir, "decks"), { recursive: true });
    await writeFile(this.deckPath(deck.id), JSON.stringify(deck, null, 2), "utf8");
  }

  async getDeck(id: string): Promise<Deck | null> {
    try { return JSON.parse(await readFile(this.deckPath(id), "utf8")) as Deck; }
    catch { return null; }
  }

  async listDecks(): Promise<{ id: string; title: string; status: string }[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      const files = (await readdir(path.join(this.dataDir, "decks"))).filter((f) => f.endsWith(".json"));
      const out = [];
      for (const f of files) {
        const d = await this.getDeck(f.replace(/\.json$/, ""));
        if (d) out.push({ id: d.id, title: d.title, status: d.status });
      }
      return out;
    } catch { return []; }
  }

  async saveSlideImage(deckId: string, index: number, png: Buffer): Promise<string> {
    const dir = path.join(this.dataDir, "slides", deckId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${index}.png`), png);
    return `/files/decks/${deckId}/${index}.png`;
  }

  async saveOriginal(deckId: string, filename: string, data: Buffer): Promise<string> {
    const dir = path.join(this.dataDir, "originals", deckId);
    await mkdir(dir, { recursive: true });
    const p = path.join(dir, path.basename(filename));
    await writeFile(p, data);
    return p;
  }
}

/** Supabase Postgres (jsonb) + Storage via REST. Keys from env only. */
export class SupabaseDeckStore implements DeckStore {
  constructor(private cfg: HubConfig, private fallback: DiskDeckStore) {}

  private headers(): Record<string, string> {
    return {
      apikey: this.cfg.supabaseServiceKey,
      Authorization: `Bearer ${this.cfg.supabaseServiceKey}`,
      "Content-Type": "application/json",
    };
  }

  async saveDeck(deck: Deck): Promise<void> {
    await this.fallback.saveDeck(deck);
    if (!this.cfg.supabaseUrl) return;
    try {
      const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/decks`, {
        method: "POST",
        headers: { ...this.headers(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id: deck.id, title: deck.title, status: deck.status, json: deck }),
      });
      if (!res.ok) console.error(`Supabase saveDeck ${res.status} (kept local copy)`);
    } catch (err) {
      console.error("Supabase saveDeck failed (kept local copy)", err);
    }
  }

  async getDeck(id: string): Promise<Deck | null> { return this.fallback.getDeck(id); }
  async listDecks() { return this.fallback.listDecks(); }

  async saveSlideImage(deckId: string, index: number, png: Buffer): Promise<string> {
    if (!this.cfg.supabaseUrl) return this.fallback.saveSlideImage(deckId, index, png);
    const objectPath = `${deckId}/${index}.png`;
    const res = await fetch(`${this.cfg.supabaseUrl}/storage/v1/object/${this.cfg.supabaseBucket}/${objectPath}`, {
      method: "POST",
      headers: { apikey: this.cfg.supabaseServiceKey, Authorization: `Bearer ${this.cfg.supabaseServiceKey}`, "Content-Type": "image/png", "x-upsert": "true" },
      body: new Uint8Array(png),
    });
    if (!res.ok) throw new Error(`Supabase upload ${res.status}`);
    await this.fallback.saveSlideImage(deckId, index, png);
    return `${this.cfg.supabaseUrl}/storage/v1/object/public/${this.cfg.supabaseBucket}/${objectPath}`;
  }

  async saveOriginal(deckId: string, filename: string, data: Buffer): Promise<string> {
    return this.fallback.saveOriginal(deckId, filename, data);
  }
}

export function createDeckStore(cfg: HubConfig): DeckStore {
  const disk = new DiskDeckStore(cfg.dataDir);
  return cfg.supabaseUrl && cfg.supabaseServiceKey ? new SupabaseDeckStore(cfg, disk) : disk;
}
