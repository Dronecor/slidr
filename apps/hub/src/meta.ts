import type { HubConfig } from "./config.js";

export interface VisionElement {
  type: string; label: string;
  box: { x: number; y: number; w: number; h: number };
  aliases: string[];
}
export interface NarrativeResult {
  summary: string;
  keyPoints: { text: string; weight: number }[];
  nextCue: string;
  triggerPhrases: string[];
}

export interface SparkClient {
  vision(slideImageUrl: string, extractedText: string): Promise<VisionElement[]>;
  narrative(slides: { title: string; summary: string }[]): Promise<NarrativeResult[]>;
  decide(prompt: string): Promise<unknown>;
}

const POSITION_BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
  "top-left": { x: 0.05, y: 0.05, w: 0.4, h: 0.25 }, "top-center": { x: 0.3, y: 0.05, w: 0.4, h: 0.2 },
  "top-right": { x: 0.55, y: 0.05, w: 0.4, h: 0.25 }, "middle-left": { x: 0.05, y: 0.35, w: 0.4, h: 0.3 },
  "center-left": { x: 0.05, y: 0.35, w: 0.45, h: 0.3 }, center: { x: 0.25, y: 0.35, w: 0.5, h: 0.3 },
  middle: { x: 0.25, y: 0.4, w: 0.5, h: 0.2 }, "bottom-left": { x: 0.05, y: 0.7, w: 0.4, h: 0.2 },
  "bottom-center": { x: 0.3, y: 0.75, w: 0.4, h: 0.18 }, "bottom-right": { x: 0.55, y: 0.7, w: 0.4, h: 0.2 },
};

function validBox(b: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!b || typeof b !== "object") return null;
  const v = b as Record<string, unknown>;
  const n = [v.x, v.y, v.w, v.h].map(Number);
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) return null;
  return { x: n[0], y: n[1], w: Math.max(0.02, n[2]), h: Math.max(0.02, n[3]) };
}

/** Models often answer in words (text/position) instead of coordinates — normalise, never drop silently. */
export function normalizeVisionElement(e: Record<string, unknown>): VisionElement | null {
  const label = String(e.label ?? e.text ?? e.description ?? "").trim().slice(0, 60);
  if (!label) return null;
  const rawType = String(e.type ?? "text").toLowerCase();
  const type = rawType.includes("chart") ? "chart" : rawType.includes("image") || rawType.includes("graphic") || rawType.includes("logo") || rawType.includes("photo") ? "image" : rawType.includes("link") ? "link" : rawType.includes("figure") || rawType.includes("stat") ? "figure" : "text";
  const box = validBox(e.box) ?? POSITION_BOXES[String(e.position ?? "").toLowerCase()] ?? POSITION_BOXES.center;
  const aliases = Array.isArray(e.aliases) ? e.aliases.map(String) : [label];
  return { type, label, box, aliases };
}

/** Real Muse Spark client (OpenAI-compatible chat completions). Key from env only. */
export class MetaSparkClient implements SparkClient {
  constructor(private cfg: HubConfig) {}

  private async chat(body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.cfg.metaApiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.metaApiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meta Spark ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private contentOf(json: unknown): string {
    const j = json as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  }

  async vision(imageUrl: string, text: string): Promise<VisionElement[]> {
    const json = await this.chat({
      model: "muse-spark-1.3", temperature: 0,
      messages: [{ role: "user", content: [
        { type: "text", text: `Return JSON {"elements":[{"type":"figure|chart|image|link|text","label":"short name","box":{"x":0.0,"y":0.0,"w":0.0,"h":0.0},"aliases":["spoken names"]}]} with box coordinates normalised 0 to 1 from top-left. Estimate a box for every visible element. Max 12. Slide text: ${text}` },
        { type: "image_url", image_url: { url: imageUrl } },
      ] }],
      response_format: { type: "json_object" },
    });
    try {
      const parsed = JSON.parse(this.contentOf(json)) as { elements?: Record<string, unknown>[] } | Record<string, unknown>[];
      const list = (Array.isArray(parsed) ? parsed : parsed.elements ?? []) as Record<string, unknown>[];
      return list.slice(0, 12).map((e) => normalizeVisionElement(e)).filter((e): e is VisionElement => e !== null);
    } catch { return []; }
  }

  async narrative(slides: { title: string; summary: string }[]): Promise<NarrativeResult[]> {
    const json = await this.chat({
      model: "muse-spark-1.3", temperature: 0,
      messages: [{ role: "user", content: `For each slide return JSON {slides:[{summary,keyPoints:[{text,weight}],nextCue,triggerPhrases}]}. Slides: ${JSON.stringify(slides)}` }],
      response_format: { type: "json_object" },
    });
    try {
      const parsed = JSON.parse(this.contentOf(json)) as { slides?: NarrativeResult[] };
      return parsed.slides ?? [];
    } catch { return []; }
  }

  async decide(prompt: string): Promise<unknown> {
    const json = await this.chat({
      model: "muse-spark-1.3", temperature: 0, max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    try { return JSON.parse(this.contentOf(json)); } catch { return null; }
  }
}

/** Deterministic fake for tests and key-less local runs. Never used when a key exists. */
export class FakeSparkClient implements SparkClient {
  async vision(_url: string, text: string): Promise<VisionElement[]> {
    const first = text.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "Slide content";
    return [{ type: "text", label: first.slice(0, 60), box: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 }, aliases: [first.slice(0, 30)] }];
  }
  async narrative(slides: { title: string; summary: string }[]): Promise<NarrativeResult[]> {
    return slides.map((s) => ({
      summary: s.summary || s.title,
      keyPoints: [{ text: s.title || s.summary, weight: 1 }],
      nextCue: "", triggerPhrases: [],
    }));
  }
  async decide(_prompt: string): Promise<unknown> {
    return { action: "none", targetId: null, confidence: 0, coveredKeyPointIds: [], reason: "fake client" };
  }
}

export function createSparkClient(cfg: HubConfig): SparkClient {
  return cfg.metaApiKey ? new MetaSparkClient(cfg) : new FakeSparkClient();
}
