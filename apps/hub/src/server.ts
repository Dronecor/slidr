import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { envelope, SessionStateSchema, type Deck } from "@stage-pilot/shared";
import type { HubConfig } from "./config.js";
import { hasMetaKey } from "./config.js";
import { SessionManager, nextId } from "./state.js";
import { IntentEngine } from "./intent.js";
import { IngestionPipeline } from "./ingest.js";
import type { DeckStore } from "./storage.js";
import type { SparkClient } from "./meta.js";
import { createAsrRelay, ManualAsrRelay, OverlayLinkOpener, StubImageTargeter, type AsrRelay } from "./asr.js";
import { DecisionLogger } from "./logger.js";

export interface Hub {
  http: ReturnType<typeof createServer>;
  sessions: Map<string, SessionManager>;
  ingestion: IngestionPipeline;
  logger: DecisionLogger;
  close(): Promise<void>;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export function demoDeck(): Deck {
  return {
    id: "demo", title: "Demo Deck", status: "ready",
    slides: [1, 2, 3].map((n) => ({
      id: `s${n}`, index: n - 1, imageUrl: `/files/decks/demo/${n - 1}.png`, width: 1920, height: 1080,
      title: `Slide ${n}`, notes: "", summary: `Demo slide ${n}`,
      keyPoints: [{ id: `s${n}k1`, text: `key point for slide ${n}`, weight: 1 }],
      nextCue: n < 3 ? "moving on" : "", triggerPhrases: n < 3 ? ["moving on"] : [],
      elements: [{ id: `s${n}e1`, type: "chart" as const, label: "revenue chart", box: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 }, aliases: ["the chart", "revenue chart"], url: null, parentId: null, source: "model" as const }],
    })),
  };
}

export function createHub(cfg: HubConfig, store: DeckStore, spark: SparkClient): Hub {
  const logger = new DecisionLogger();
  const ingestion = new IngestionPipeline({ store, spark, dataDir: cfg.dataDir });
  const sessions = new Map<string, SessionManager>();
  const engines = new Map<string, IntentEngine>();
  const relays = new Map<string, AsrRelay>();
  const clients = new Map<string, Set<WebSocket>>();
  const linkOpener = new OverlayLinkOpener();
  const imageTargeter = new StubImageTargeter();
  void linkOpener; void imageTargeter;
  let seq = 0;
  const send = (ws: WebSocket, type: string, payload: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(envelope(type, ++seq, payload)));
  };
  const broadcast = (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (!s) return;
    const state = s.getState();
    SessionStateSchema.parse(state);
    for (const ws of clients.get(sessionId) ?? []) send(ws, "state", { ...state } as unknown as Record<string, unknown>);
  };
  const broadcastAll = (sessionId: string, type: string, payload: Record<string, unknown>) => {
    for (const ws of clients.get(sessionId) ?? []) send(ws, type, payload);
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-File-Name, X-Deck-Title" }); res.end(); return; }
      if (req.method === "GET" && url.pathname === "/health") {
        const first = [...engines.values()][0];
        void first;
        json(res, 200, { ok: true, metaConfigured: hasMetaKey(cfg), sessions: sessions.size, decisions: logger.recent(1).length >= 0 ? logger.recent(500).length : 0, p50: logger.percentile(50), p95: logger.percentile(95) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/decks") { json(res, 200, { decks: await store.listDecks() }); return; }
      if (req.method === "POST" && url.pathname === "/decks") {
        const filename = String(req.headers["x-file-name"] ?? "deck.pdf");
        const title = String(req.headers["x-deck-title"] ?? filename.replace(/\.[^.]+$/, ""));
        const data = await readBody(req);
        if (data.length === 0) { json(res, 400, { error: "empty upload; send file bytes with X-File-Name header" }); return; }
        const deckId = nextId("deck");
        void ingestion.ingest(deckId, title, filename, data).catch((e) => console.error("ingest failed", e));
        json(res, 202, { deckId, status: "processing" });
        return;
      }
      const deckMatch = url.pathname.match(/^\/decks\/([^/]+)$/);
      if (req.method === "GET" && deckMatch) {
        const id = decodeURIComponent(deckMatch[1]);
        const deck = id === "demo" ? demoDeck() : await store.getDeck(id);
        if (!deck) { json(res, 404, { error: "deck not found" }); return; }
        json(res, 200, { deck, progress: ingestion.getProgress(id) });
        return;
      }
      const elMatch = url.pathname.match(/^\/decks\/([^/]+)\/slides\/([^/]+)\/elements$/);
      if (req.method === "PUT" && elMatch) {
        const deck = await store.getDeck(decodeURIComponent(elMatch[1]));
        if (!deck) { json(res, 404, { error: "deck not found" }); return; }
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { elements: Deck["slides"][number]["elements"] };
        const slide = deck.slides.find((s) => s.id === decodeURIComponent(elMatch[2]));
        if (!slide) { json(res, 404, { error: "slide not found" }); return; }
        slide.elements = (body.elements ?? []).slice(0, 12).map((e) => ({ ...e, source: "user" as const }));
        await store.saveDeck(deck);
        json(res, 200, { ok: true, slide });
        return;
      }
      if (req.method === "POST" && url.pathname === "/sessions") {
        const body = JSON.parse(((await readBody(req)).toString("utf8") || "{}")) as { deckId?: string };
        const deckId = body.deckId ?? "demo";
        const deck = deckId === "demo" ? demoDeck() : await store.getDeck(deckId);
        if (!deck) { json(res, 404, { error: "deck not found" }); return; }
        const sessionId = nextId("sess").slice(0, 12).toUpperCase();
        const mgr = new SessionManager(deck, sessionId);
        sessions.set(sessionId, mgr);
        const engine = new IntentEngine({ spark, logger });
        engine.rebuildIndex(mgr);
        engines.set(sessionId, engine);
        json(res, 201, { sessionId, deckId });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/files/decks/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const filePath = path.join(cfg.dataDir, "slides", parts[2] ?? "", parts[3] ?? "");
        try { const buf = await readFile(filePath); res.writeHead(200, { "Content-Type": "image/png" }); res.end(buf); }
        catch { json(res, 404, { error: "file not found" }); }
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws) => {
    let sessionId: string | null = null;
    ws.on("message", async (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (sessionId) relays.get(sessionId)?.sendPcm16(data);
        return;
      }
      let msg: { type?: string; payload?: Record<string, unknown> };
      try { msg = JSON.parse(data.toString("utf8")); } catch { send(ws, "error", { code: "BAD_JSON", message: "invalid JSON", recoverable: true }); return; }
      const payload = msg.payload ?? {};
      if (msg.type === "join") {
        sessionId = String(payload.sessionId ?? "");
        const mgr = sessions.get(sessionId);
        if (!mgr) { send(ws, "error", { code: "NO_SESSION", message: "unknown session", recoverable: false }); return; }
        if (!clients.has(sessionId)) clients.set(sessionId, new Set());
        clients.get(sessionId)!.add(ws);
        send(ws, "state", { ...mgr.getState() } as unknown as Record<string, unknown>);
        return;
      }
      if (!sessionId) return;
      const mgr = sessions.get(sessionId);
      const engine = engines.get(sessionId);
      if (!mgr || !engine) return;
      if (msg.type === "audio.start") {
        if (!relays.has(sessionId)) {
          const relay = createAsrRelay(cfg);
          relays.set(sessionId, relay);
          await relay.start((e) => {
            broadcastAll(sessionId!, "transcript", { text: e.text, final: e.final, ts: e.ts });
            if (e.final) void engine.handleFinal(mgr, e.text).then(() => broadcast(sessionId!));
            else if (engine.handleInterim(mgr, e.text)) broadcast(sessionId!);
          });
        }
        return;
      }
      if (msg.type === "audio.stop") { relays.get(sessionId)?.stop(); relays.delete(sessionId); return; }
      // Test/fallback hook: presenter can inject transcript text without a mic (Web Speech path).
      if (msg.type === "transcript.inject") {
        const text = String(payload.text ?? "");
        const relay = relays.get(sessionId);
        if (relay instanceof ManualAsrRelay) relay.pushTranscript(text, Boolean(payload.final ?? true));
        else if (payload.final) void engine.handleFinal(mgr, text).then(() => broadcast(sessionId!));
        else if (engine.handleInterim(mgr, text)) broadcast(sessionId!);
        return;
      }
      if (msg.type === "suggestion.accept") { engine.acceptPending(mgr); broadcast(sessionId); return; }
      if (msg.type === "suggestion.dismiss") { mgr.dismissPending(); broadcast(sessionId); return; }
      if (msg.type === "cmd") {
        const name = String(payload.name ?? "");
        const args = (payload.args ?? {}) as Record<string, unknown>;
        if (name === "next") mgr.next();
        else if (name === "back") mgr.back();
        else if (name === "goto") mgr.goto(Number(args.index ?? 0));
        else if (name === "undo") mgr.undo();
        else if (name === "pause") mgr.setPaused(true);
        else if (name === "resume") { mgr.setPaused(false); mgr.setHold(false); }
        else if (name === "setMode") mgr.setMode(String(args.mode ?? "auto") as "auto" | "assist" | "manual");
        else if (name === "clearEffect") mgr.clearEffects();
        else if (name === "hold") mgr.setHold(Boolean(args.value ?? true));
        broadcast(sessionId);
      }
    });
    ws.on("close", () => { if (sessionId) clients.get(sessionId)?.delete(ws); });
  });

  return {
    http, sessions, ingestion, logger,
    async close() {
      for (const r of relays.values()) r.stop();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
