import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Deck, IngestProgress, Slide } from "@stage-pilot/shared";
import type { DeckStore } from "./storage.js";
import type { SparkClient } from "./meta.js";
import { Bm25Index } from "./bm25.js";

const exec = promisify(execFile);
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAI9vhFQAAAABJRU5ErkJggg==", "base64");

export interface IngestDeps {
  store: DeckStore;
  spark: SparkClient;
  dataDir: string;
  /** Injected in tests to avoid LibreOffice/pdf tools. */
  convertToPdf?: (inputPath: string, outDir: string) => Promise<string>;
  renderPngs?: (pdfPath: string, outDir: string) => Promise<string[]>;
  extractText?: (pdfPath: string) => Promise<string[]>;
}

async function defaultConvert(inputPath: string, outDir: string): Promise<string> {
  await exec("soffice", ["--headless", "--convert-to", "pdf", "--outdir", outDir, inputPath], { timeout: 120_000 });
  return path.join(outDir, `${path.basename(inputPath).replace(/\.[^.]+$/, "")}.pdf`);
}

async function defaultRender(pdfPath: string, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  try {
    await exec("pdftoppm", ["-png", "-scale-to-x", "1920", "-scale-to-y", "-1", pdfPath, path.join(outDir, "slide")], { timeout: 600_000, maxBuffer: 10_000_000 });
    const { readdir } = await import("node:fs/promises");
    return (await readdir(outDir)).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(outDir, f));
  } catch {
    return [];
  }
}

/** Ingestion: upload → convert → render → extract → vision → narrative → index. Cached before Present. */
export class IngestionPipeline {
  private progress = new Map<string, IngestProgress>();
  private indexes = new Map<string, Bm25Index>();

  constructor(private deps: IngestDeps) {}

  getProgress(deckId: string): IngestProgress | null { return this.progress.get(deckId) ?? null; }
  getIndex(deckId: string): Bm25Index | undefined { return this.indexes.get(deckId); }

  private set(deckId: string, step: string, value: string, status?: string): void {
    const p = this.progress.get(deckId);
    if (!p) return;
    (p.steps as Record<string, string>)[step] = value;
    if (status) p.status = status as IngestProgress["status"];
  }

  async ingest(deckId: string, title: string, filename: string, data: Buffer): Promise<Deck> {
    this.progress.set(deckId, {
      deckId, status: "processing", error: null,
      steps: { upload: "running", convert: "pending", render: "pending", extract: "pending", vision: "pending", narrative: "pending", index: "pending" },
    });
    const workDir = path.join(this.deps.dataDir, "work", deckId);
    await mkdir(workDir, { recursive: true });
    try {
      const originalPath = await this.deps.store.saveOriginal(deckId, filename, data);
      this.set(deckId, "upload", "done");
      const isPdf = filename.toLowerCase().endsWith(".pdf");
      let pdfPath = originalPath;
      this.set(deckId, "convert", "running");
      if (isPdf) this.set(deckId, "convert", "skipped");
      else {
        const convert = this.deps.convertToPdf ?? defaultConvert;
        pdfPath = await convert(originalPath, workDir);
        this.set(deckId, "convert", "done");
      }

      this.set(deckId, "render", "running");
      let pngPaths: string[] = [];
      if (this.deps.renderPngs) pngPaths = await this.deps.renderPngs(pdfPath, path.join(workDir, "png"));
      else pngPaths = await defaultRender(pdfPath, path.join(workDir, "png"));
      if (pngPaths.length === 0) pngPaths = [path.join(workDir, "fallback.png")];
      if (pngPaths[0].endsWith("fallback.png")) await writeFile(pngPaths[0], BLANK_PNG);
      this.set(deckId, "render", "done");

      this.set(deckId, "extract", "running");
      let texts: string[] = pngPaths.map(() => "");
      if (this.deps.extractText) texts = await this.deps.extractText(pdfPath);
      else {
        try {
          const { stdout } = await exec("pdftotext", ["-layout", pdfPath, "-"], { timeout: 60_000, maxBuffer: 10_000_000 });
          texts = stdout.split(/\f/).slice(0, pngPaths.length);
          while (texts.length < pngPaths.length) texts.push("");
        } catch { /* text stays empty; vision still runs */ }
      }
      this.set(deckId, "extract", "done");

      this.set(deckId, "vision", "running");
      const slides: Slide[] = [];
      for (let i = 0; i < pngPaths.length; i++) {
        const png = await readFile(pngPaths[i]).catch(() => BLANK_PNG);
        const imageUrl = await this.deps.store.saveSlideImage(deckId, i, png);
        const text = (texts[i] ?? "").trim();
        const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
        let elements: Slide["elements"] = [];
        try {
          const found = await this.deps.spark.vision(imageUrl, text);
          elements = found.slice(0, 12).map((e, j) => ({
            id: `s${i + 1}e${j + 1}`, type: (["figure", "chart", "image", "link", "text", "chart_part"].includes(e.type) ? e.type : "text") as Slide["elements"][number]["type"],
            label: e.label || `Element ${j + 1}`, box: e.box, aliases: e.aliases ?? [], url: null, parentId: null, source: "model" as const,
          }));
        } catch { elements = []; }
        slides.push({
          id: `s${i + 1}`, index: i, imageUrl, width: 1920, height: 1080,
          title: lines[0]?.slice(0, 80) ?? `Slide ${i + 1}`, notes: "", summary: lines.slice(0, 2).join(" "),
          keyPoints: [], nextCue: "", triggerPhrases: [], elements,
        });
      }
      this.set(deckId, "vision", "done");

      this.set(deckId, "narrative", "running");
      try {
        const narratives = await this.deps.spark.narrative(slides.map((s) => ({ title: s.title, summary: s.summary })));
        narratives.forEach((n, i) => {
          if (!slides[i]) return;
          slides[i].summary = n.summary || slides[i].summary;
          slides[i].keyPoints = (n.keyPoints ?? []).map((k, j) => ({ id: `${slides[i].id}k${j + 1}`, text: k.text, weight: k.weight || 1 }));
          slides[i].nextCue = n.nextCue ?? "";
          slides[i].triggerPhrases = n.triggerPhrases ?? [];
        });
      } catch { /* keep vision-only deck */ }
      this.set(deckId, "narrative", "done");

      this.set(deckId, "index", "running");
      const idx = new Bm25Index();
      idx.build(slides.flatMap((s) => s.keyPoints.map((k) => ({ id: k.id, text: k.text, weight: k.weight }))));
      this.indexes.set(deckId, idx);
      this.set(deckId, "index", "done");

      const deck: Deck = { id: deckId, title, status: "review", slides };
      await this.deps.store.saveDeck(deck);
      const p = this.progress.get(deckId);
      if (p) p.status = "review";
      return deck;
    } catch (err) {
      const p = this.progress.get(deckId);
      if (p) { p.status = "failed"; p.error = err instanceof Error ? err.message : String(err); }
      throw err;
    }
  }
}
