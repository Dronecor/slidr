"use client";

import type {
  CmdName,
  Deck,
  DecisionPayload,
  Effect,
  ErrorPayload,
  HealthPayload,
  SessionState,
  TranscriptPayload,
} from "@slidr/shared";
import type { HubClient } from "./ws";

function svg(slideNo: number, title: string, body: string, tint: string): string {
  const svgText =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">` +
    `<rect width="1920" height="1080" fill="${tint}"/>` +
    `<rect x="120" y="120" width="1680" height="840" rx="24" fill="#ffffff"/>` +
    `<text x="220" y="300" font-family="sans-serif" font-size="72" font-weight="700" fill="#1a1d21">${title}</text>` +
    `<text x="220" y="420" font-family="sans-serif" font-size="44" fill="#3c4248">${body}</text>` +
    `<text x="220" y="900" font-family="sans-serif" font-size="32" fill="#8a9299">slidr · slide ${slideNo}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

export const DEMO_DECK: Deck = {
  id: "deck_demo",
  title: "Q3 Investor Update (demo)",
  status: "ready",
  slides: [
    {
      id: "s1", index: 0, imageUrl: svg(1, "slidr", "Voice-driven presenting", "#e8e2d4"),
      width: 1920, height: 1080, title: "Title", notes: "Welcome everyone.",
      summary: "Product name and tagline", keyPoints: [{ id: "s1k1", text: "intro", weight: 1 }],
      nextCue: "let me show you the problem", triggerPhrases: ["moving on"],
      elements: [
        { id: "s1e1", type: "text", label: "Title text", box: { x: 0.11, y: 0.2, w: 0.5, h: 0.12 }, aliases: ["the title"], url: null, parentId: null, source: "model" },
      ],
    },
    {
      id: "s2", index: 1, imageUrl: svg(2, "The problem", "62% of teams lose time", "#dfe5dd"),
      width: 1920, height: 1080, title: "The problem", notes: "Sixty-two percent of teams lose time to slide wrangling.",
      summary: "A large stat", keyPoints: [{ id: "s2k1", text: "62 percent of teams lose time", weight: 2 }],
      nextCue: "quarterly revenue", triggerPhrases: ["look at the chart"],
      elements: [
        { id: "s2e1", type: "figure", label: "62 percent stat", box: { x: 0.35, y: 0.35, w: 0.3, h: 0.2 }, aliases: ["the 62 percent figure", "that number", "the stat"], url: null, parentId: null, source: "model" },
      ],
    },
    {
      id: "s3", index: 2, imageUrl: svg(3, "Revenue", "Q1 ▃  Q2 ▅  Q3 ▇  Q4 █", "#d9dee6"),
      width: 1920, height: 1080, title: "Chart", notes: "Revenue grew every quarter.",
      summary: "Bar chart of quarterly revenue", keyPoints: [{ id: "s3k1", text: "revenue grew each quarter", weight: 2 }],
      nextCue: "here is the product", triggerPhrases: ["the screenshot"],
      elements: [
        { id: "s3e1", type: "chart", label: "Revenue chart", box: { x: 0.11, y: 0.4, w: 0.78, h: 0.4 }, aliases: ["the chart", "revenue chart"], url: null, parentId: null, source: "model" },
        { id: "s3e2", type: "chart_part", label: "Q4 bar", box: { x: 0.62, y: 0.45, w: 0.12, h: 0.32 }, aliases: ["the Q4 bar", "last quarter"], url: null, parentId: "s3e1", source: "model" },
      ],
    },
    {
      id: "s4", index: 3, imageUrl: svg(4, "Product", "[ screenshot ]", "#e6d9d4"),
      width: 1920, height: 1080, title: "Image", notes: "This is the product screenshot.",
      summary: "Product screenshot", keyPoints: [{ id: "s4k1", text: "product screenshot", weight: 1 }],
      nextCue: "watch the demo", triggerPhrases: ["open the demo"],
      elements: [
        { id: "s4e1", type: "image", label: "Screenshot", box: { x: 0.2, y: 0.35, w: 0.6, h: 0.45 }, aliases: ["the screenshot", "the image"], url: null, parentId: null, source: "model" },
      ],
    },
    {
      id: "s5", index: 4, imageUrl: svg(5, "Watch the demo", "demo.example.com", "#d4dde0"),
      width: 1920, height: 1080, title: "Link", notes: "Open the demo link.",
      summary: "Demo link", keyPoints: [{ id: "s5k1", text: "demo link", weight: 1 }],
      nextCue: "to close", triggerPhrases: ["any questions"],
      elements: [
        { id: "s5e1", type: "link", label: "Watch the demo", box: { x: 0.11, y: 0.4, w: 0.35, h: 0.12 }, aliases: ["the demo", "the link"], url: "https://demo.example.com", parentId: null, source: "pptx" },
      ],
    },
    {
      id: "s6", index: 5, imageUrl: svg(6, "Close", "12k users · 98% happy · $1.2M", "#ddd8ce"),
      width: 1920, height: 1080, title: "Close", notes: "Three key figures. Any questions?",
      summary: "Three key figures", keyPoints: [
        { id: "s6k1", text: "12k users", weight: 1 },
        { id: "s6k2", text: "98 percent happy", weight: 1 },
        { id: "s6k3", text: "1.2M revenue", weight: 1 },
      ],
      nextCue: "", triggerPhrases: ["any questions"],
      elements: [
        { id: "s6e1", type: "figure", label: "12k users", box: { x: 0.11, y: 0.4, w: 0.2, h: 0.12 }, aliases: ["twelve thousand users"], url: null, parentId: null, source: "model" },
        { id: "s6e2", type: "figure", label: "98 percent", box: { x: 0.4, y: 0.4, w: 0.2, h: 0.12 }, aliases: ["ninety eight percent"], url: null, parentId: null, source: "model" },
        { id: "s6e3", type: "figure", label: "$1.2M", box: { x: 0.68, y: 0.4, w: 0.2, h: 0.12 }, aliases: ["one point two million"], url: null, parentId: null, source: "model" },
      ],
    },
  ],
};

const MOCK_KEY = "slidr.mock-decks";

export function listMockDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return JSON.parse(raw) as Deck[];
  } catch { /* fresh */ }
  return [structuredClone(DEMO_DECK)];
}

export function saveMockDecks(decks: Deck[]) {
  try { localStorage.setItem(MOCK_KEY, JSON.stringify(decks)); } catch { /* quota */ }
}

export function getMockDeck(id: string): Deck | null {
  if (id === DEMO_DECK.id) {
    const decks = listMockDecks();
    return decks.find((d) => d.id === id) ?? structuredClone(DEMO_DECK);
  }
  return listMockDecks().find((d) => d.id === id) ?? null;
}

/** In-browser fake hub: same HubClient surface, scripted state. Unblocks Dev A. */
export class FakeHub implements HubClient {
  lastStateVersion = 0;
  private state: SessionState;
  private undoStack: SessionState[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  private stateCbs: ((s: SessionState) => void)[] = [];
  private transcriptCbs: ((t: TranscriptPayload) => void)[] = [];
  private decisionCbs: ((d: DecisionPayload) => void)[] = [];
  private healthCbs: ((h: HealthPayload) => void)[] = [];
  private errorCbs: ((e: ErrorPayload) => void)[] = [];
  private statusCbs: ((s: "connecting" | "open" | "reconnecting" | "closed") => void)[] = [];

  constructor(
    private sessionId: string,
    private deck: Deck,
    private role: "audience" | "presenter" = "presenter"
  ) {
    this.state = {
      sessionId, deckId: deck.id, slideIndex: 0, mode: "auto",
      paused: false, holdForQuestions: false, effects: [],
      pending: null, stateVersion: 0,
    };
  }

  onState(cb: (s: SessionState) => void) { this.stateCbs.push(cb); }
  onTranscript(cb: (t: TranscriptPayload) => void) { this.transcriptCbs.push(cb); }
  onDecision(cb: (d: DecisionPayload) => void) { this.decisionCbs.push(cb); }
  onHealth(cb: (h: HealthPayload) => void) { this.healthCbs.push(cb); }
  onErrorMsg(cb: (e: ErrorPayload) => void) { this.errorCbs.push(cb); }
  onStatus(cb: (s: "connecting" | "open" | "reconnecting" | "closed") => void) { this.statusCbs.push(cb); }

  connect() {
    this.statusCbs.forEach((cb) => cb("connecting"));
    setTimeout(() => {
      this.statusCbs.forEach((cb) => cb("open"));
      this.emitState();
      this.healthCbs.forEach((cb) => cb({ asr: "mock", p50: 40, p95: 120, fallback: false }));
    }, 150);
  }

  disconnect() {
    this.timers.forEach(clearTimeout);
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.statusCbs.forEach((cb) => cb("closed"));
  }

  private push() {
    this.undoStack.push(structuredClone(this.state));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  private emitState() {
    this.state.stateVersion += 1;
    this.lastStateVersion = this.state.stateVersion;
    const snap = structuredClone(this.state);
    this.stateCbs.forEach((cb) => cb(snap));
  }

  private emitDecision(d: DecisionPayload) {
    this.decisionCbs.forEach((cb) => cb(d));
  }

  private fx(kind: Effect["kind"], elementId: string, ttlMs: number) {
    const now = Date.now();
    const fx: Effect = {
      id: `fx${now}`, kind, elementId,
      startedAt: now, expiresAt: now + ttlMs,
    };
    if (kind === "zoom") this.state.effects = this.state.effects.filter((e) => e.kind !== "zoom");
    this.state.effects = [...this.state.effects.filter((e) => e.expiresAt > now), fx];
    this.emitState();
    const t = setTimeout(() => {
      this.state.effects = this.state.effects.filter((e) => e.id !== fx.id);
      this.emitState();
    }, ttlMs + 50);
    this.timers.push(t);
  }

  sendCmd(name: CmdName, args: Record<string, unknown> = {}) {
    const slides = this.deck.slides.length;
    this.push();
    switch (name) {
      case "next":
        this.state.slideIndex = Math.min(slides - 1, this.state.slideIndex + 1);
        this.state.effects = [];
        break;
      case "back":
        this.state.slideIndex = Math.max(0, this.state.slideIndex - 1);
        this.state.effects = [];
        break;
      case "goto": {
        const i = Number(args.index ?? args.slide ?? 0);
        if (Number.isFinite(i)) this.state.slideIndex = Math.max(0, Math.min(slides - 1, i));
        this.state.effects = [];
        break;
      }
      case "undo": {
        const prev = this.undoStack.pop();
        if (prev) { this.undoStack.pop(); this.state = { ...prev }; }
        break;
      }
      case "pause": this.state.paused = true; break;
      case "resume": this.state.paused = false; this.state.holdForQuestions = false; break;
      case "setMode":
        if (args.mode === "auto" || args.mode === "assist" || args.mode === "manual") {
          this.state.mode = args.mode;
        }
        break;
      case "clearEffect":
        this.state.effects = typeof args.effectId === "string"
          ? this.state.effects.filter((e) => e.id !== args.effectId)
          : [];
        break;
      case "hold": this.state.holdForQuestions = args.on !== false; break;
    }
    this.emitState();
  }

  acceptSuggestion() { this.state.pending = null; this.emitState(); }
  dismissSuggestion() { this.state.pending = null; this.emitState(); }
  startAudio() { /* mock: no-op */ }
  stopAudio() { /* mock: no-op */ }
  sendAudioFrame() { /* mock: no-op */ }

  /** Scripted line: emits transcript + matching decision + effect. For ?mock demos. */
  script(line: string, final = true) {
    this.transcriptCbs.forEach((cb) => cb({ text: line, final, ts: Date.now() }));
    if (!final) return;
    const slide = this.deck.slides[this.state.slideIndex];
    const low = line.toLowerCase();
    const findEl = (words: string[]) =>
      slide.elements.find((e) =>
        words.some((w) =>
          e.label.toLowerCase().includes(w) || e.aliases.some((a) => a.toLowerCase().includes(w))
        )
      );
    if (/next slide|moving on|go to slide/.test(low)) {
      this.push();
      this.state.slideIndex = Math.min(this.deck.slides.length - 1, this.state.slideIndex + 1);
      this.state.effects = [];
      this.emitState();
      this.emitDecision({ action: "next", target: null, confidence: 0.95, reason: "Spoken advance cue", path: "fast", latencyMs: 32, applied: true });
      return;
    }
    if (/go back|previous/.test(low)) {
      this.sendCmd("back");
      this.emitDecision({ action: "back", target: null, confidence: 0.95, reason: "Spoken back cue", path: "fast", latencyMs: 30, applied: true });
      return;
    }
    if (/open the demo|open .*link/.test(low)) {
      const link = slide.elements.find((e) => e.type === "link");
      if (link) {
        this.fx("link", link.id, 12000);
        this.emitDecision({ action: "open_link", target: link.id, confidence: 0.93, reason: "Explicit open cue", path: "semantic", latencyMs: 410, applied: true });
      }
      return;
    }
    if (/zoom/.test(low)) {
      const el = findEl(["chart", "screenshot", "image", "revenue"]) ?? slide.elements[0];
      if (el) {
        this.fx("zoom", el.id, 8000);
        this.emitDecision({ action: "zoom", target: el.id, confidence: 0.78, reason: `Zooming ${el.label}`, path: "semantic", latencyMs: 380, applied: true });
      }
      return;
    }
    const num = low.match(/(\d+)\s*(percent|%|k\b|million)?/);
    const el = findEl([low]) ?? (num ? slide.elements.find((e) => e.type === "figure" || e.type === "chart_part") : undefined) ?? slide.elements[0];
    if (el) {
      this.fx("highlight", el.id, 6000);
      this.emitDecision({ action: "highlight", target: el.id, confidence: 0.71, reason: `Mentioned ${el.label}`, path: "semantic", latencyMs: 350, applied: true });
    }
  }

  /** Cycle scripted effects so the audience window can be reviewed hands-free. */
  startCycle() {
    const lines = [
      "As you can see, 62 percent of teams lose time",
      "Next slide",
      "Revenue grew each quarter, look at the Q4 bar",
      "Zoom in on the revenue chart",
      "Next slide",
      "Here is the product screenshot",
      "Next slide",
      "Open the demo",
      "Next slide",
      "Twelve thousand users and counting",
    ];
    let i = 0;
    this.cycleTimer = setInterval(() => {
      this.script(lines[i % lines.length]);
      i += 1;
    }, 3500);
  }
}
