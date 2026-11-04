import WebSocket from "ws";
import type { HubConfig } from "./config.js";

export interface TranscriptEvent { text: string; final: boolean; ts: number }
export type TranscriptHandler = (e: TranscriptEvent) => void;

/** Audio source abstraction (spec: AudioSource). Hub relays PCM16 to Voice Transcribe. */
export interface AsrRelay {
  readonly fallbackInUse: boolean;
  readonly status: "connected" | "disconnected" | "fallback" | "unknown";
  start(onTranscript: TranscriptHandler): Promise<void>;
  sendPcm16(frame: Buffer): void;
  stop(): void;
}

/** Live relay to Muse Voice Transcribe. Browsers cannot set WS auth headers, so hub holds the key. */
export class MetaAsrRelay implements AsrRelay {
  fallbackInUse = false;
  status: "connected" | "disconnected" | "fallback" | "unknown" = "unknown";
  private ws: WebSocket | null = null;
  private handler: TranscriptHandler | null = null;

  constructor(private cfg: HubConfig) {}

  async start(onTranscript: TranscriptHandler): Promise<void> {
    this.handler = onTranscript;
    if (!this.cfg.metaApiKey) { this.status = "fallback"; this.fallbackInUse = true; return; }
    const url = "wss://api.meta.ai/v1/asr/realtime";
    this.ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.cfg.metaApiKey}` } });
    this.ws.on("open", () => { this.status = "connected"; });
    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as { text?: string; transcript?: string; final?: boolean; is_final?: boolean };
        const text = msg.text ?? msg.transcript ?? "";
        if (text) this.handler?.({ text, final: Boolean(msg.final ?? msg.is_final), ts: Date.now() });
      } catch { /* ignore non-JSON frames */ }
    });
    this.ws.on("close", () => { this.status = "disconnected"; });
    this.ws.on("error", () => { this.status = "fallback"; this.fallbackInUse = true; });
  }

  sendPcm16(frame: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  stop(): void { this.ws?.close(); this.ws = null; this.status = "disconnected"; }
}

/** Key-less / test relay: transcripts are injected via pushTranscript (Web Speech fallback hook). */
export class ManualAsrRelay implements AsrRelay {
  fallbackInUse = true;
  status: "connected" | "disconnected" | "fallback" | "unknown" = "fallback";
  private handler: TranscriptHandler | null = null;
  async start(onTranscript: TranscriptHandler): Promise<void> { this.handler = onTranscript; }
  sendPcm16(_frame: Buffer): void { /* audio accepted; transcription comes from fallback */ }
  pushTranscript(text: string, final: boolean): void {
    this.handler?.({ text, final, ts: Date.now() });
  }
  stop(): void { this.handler = null; }
}

export function createAsrRelay(cfg: HubConfig): AsrRelay {
  return cfg.metaApiKey ? new MetaAsrRelay(cfg) : new ManualAsrRelay();
}

export interface LinkOpener { open(url: string): Promise<{ shown: boolean }> }
export class OverlayLinkOpener implements LinkOpener {
  async open(_url: string): Promise<{ shown: boolean }> { return { shown: true }; }
}

export interface ImageTargeter {
  locate(slideId: string, phrase: string): Promise<{ x: number; y: number; w: number; h: number } | null>;
}
/** Stub per spec: SAM goes in later without changing callers. */
export class StubImageTargeter implements ImageTargeter {
  async locate(_slideId: string, _phrase: string) { return null; }
}
