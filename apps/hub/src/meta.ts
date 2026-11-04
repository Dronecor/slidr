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
        { type: "text", text: `List slide elements as JSON array [{type,label,box:{x,y,w,h},aliases}]. Max 12. Text: ${text}` },
        { type: "image_url", image_url: { url: imageUrl } },
      ] }],
      response_format: { type: "json_object" },
    });
    try {
      const parsed = JSON.parse(this.contentOf(json)) as { elements?: VisionElement[] };
      return parsed.elements ?? [];
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
