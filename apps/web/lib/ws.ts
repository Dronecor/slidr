"use client";

import {
  PROTOCOL_V,
  SessionStateSchema,
  type CmdName,
  type DecisionPayload,
  type ErrorPayload,
  type HealthPayload,
  type SessionState,
  type TranscriptPayload,
  type WsType,
} from "@slidr/shared";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface HubClient {
  onState(cb: (s: SessionState) => void): void;
  onTranscript(cb: (t: TranscriptPayload) => void): void;
  onDecision(cb: (d: DecisionPayload) => void): void;
  onHealth(cb: (h: HealthPayload) => void): void;
  onErrorMsg(cb: (e: ErrorPayload) => void): void;
  onStatus(cb: (s: ConnStatus) => void): void;
  sendCmd(name: CmdName, args?: Record<string, unknown>): void;
  acceptSuggestion(id: string): void;
  dismissSuggestion(id: string): void;
  startAudio(sampleRate: number, channels: number): void;
  stopAudio(): void;
  sendAudioFrame(buf: ArrayBuffer): void;
  connect(): void;
  disconnect(): void;
  readonly lastStateVersion: number;
}

const WS_URL = () =>
  process.env.NEXT_PUBLIC_HUB_WS || "ws://localhost:3100/ws";

export class PilotSocket implements HubClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private backoff = 500;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private seenVersion = -1;
  lastStateVersion = -1;

  private stateCbs: ((s: SessionState) => void)[] = [];
  private transcriptCbs: ((t: TranscriptPayload) => void)[] = [];
  private decisionCbs: ((d: DecisionPayload) => void)[] = [];
  private healthCbs: ((h: HealthPayload) => void)[] = [];
  private errorCbs: ((e: ErrorPayload) => void)[] = [];
  private statusCbs: ((s: ConnStatus) => void)[] = [];

  constructor(
    private sessionId: string,
    private role: "audience" | "presenter"
  ) {}

  onState(cb: (s: SessionState) => void) { this.stateCbs.push(cb); }
  onTranscript(cb: (t: TranscriptPayload) => void) { this.transcriptCbs.push(cb); }
  onDecision(cb: (d: DecisionPayload) => void) { this.decisionCbs.push(cb); }
  onHealth(cb: (h: HealthPayload) => void) { this.healthCbs.push(cb); }
  onErrorMsg(cb: (e: ErrorPayload) => void) { this.errorCbs.push(cb); }
  onStatus(cb: (s: ConnStatus) => void) { this.statusCbs.push(cb); }

  private emitStatus(s: ConnStatus) { this.statusCbs.forEach((cb) => cb(s)); }

  connect() {
    this.closed = false;
    this.emitStatus(this.backoff > 500 ? "reconnecting" : "connecting");
    const url = `${WS_URL()}?session=${encodeURIComponent(this.sessionId)}&role=${this.role}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.backoff = 500;
      this.emitStatus("open");
      this.send("join", { sessionId: this.sessionId, role: this.role });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as { v: number; type: WsType; payload: Record<string, unknown> };
        if (msg.v !== PROTOCOL_V) return;
        switch (msg.type) {
          case "state": {
            const parsed = SessionStateSchema.safeParse(msg.payload);
            if (!parsed.success) return;
            // Apply only newer states; never blank while reconnecting.
            if (parsed.data.stateVersion <= this.seenVersion) return;
            this.seenVersion = parsed.data.stateVersion;
            this.lastStateVersion = parsed.data.stateVersion;
            this.stateCbs.forEach((cb) => cb(parsed.data));
            break;
          }
          case "transcript":
            this.transcriptCbs.forEach((cb) => cb(msg.payload as unknown as TranscriptPayload));
            break;
          case "decision":
            this.decisionCbs.forEach((cb) => cb(msg.payload as unknown as DecisionPayload));
            break;
          case "health":
            this.healthCbs.forEach((cb) => cb(msg.payload as unknown as HealthPayload));
            break;
          case "error":
            this.errorCbs.forEach((cb) => cb(msg.payload as unknown as ErrorPayload));
            break;
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) { this.emitStatus("closed"); return; }
      this.emitStatus("reconnecting");
      const wait = Math.min(this.backoff, 5000);
      this.backoff *= 2;
      this.timer = setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  disconnect() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    try { this.ws?.close(); } catch { /* noop */ }
    this.emitStatus("closed");
  }

  private send(type: WsType, payload: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.seq += 1;
    this.ws.send(JSON.stringify({ v: PROTOCOL_V, type, seq: this.seq, payload }));
  }

  sendCmd(name: CmdName, args: Record<string, unknown> = {}) {
    this.send("cmd", { name, args });
  }
  acceptSuggestion(id: string) { this.send("suggestion.accept", { pendingId: id }); }
  dismissSuggestion(id: string) { this.send("suggestion.dismiss", { pendingId: id }); }
  startAudio(sampleRate: number, channels: number) {
    this.send("audio.start", { sampleRate, channels });
  }
  stopAudio() { this.send("audio.stop", {}); }
  sendAudioFrame(buf: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
  }
}
