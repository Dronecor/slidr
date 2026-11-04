import type { Deck, Effect, SessionState } from "@stage-pilot/shared";

let seqCounter = 0;
export function nextId(prefix: string): string {
  seqCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${seqCounter}`;
}

interface Snapshot {
  slideIndex: number;
  effects: Effect[];
  pending: SessionState["pending"];
  holdForQuestions: boolean;
  paused: boolean;
}

/** Hub is the only writer of session state. Clients send commands, never state. */
export class SessionManager {
  private state: SessionState;
  private deck: Deck;
  private undoStack: Snapshot[] = [];

  constructor(deck: Deck, sessionId: string) {
    this.deck = deck;
    this.state = {
      sessionId, deckId: deck.id, slideIndex: 0, mode: "auto",
      paused: false, holdForQuestions: false, effects: [], pending: null, stateVersion: 0,
    };
  }

  getState(): SessionState {
    this.pruneEffects();
    return structuredClone(this.state);
  }

  getDeck(): Deck { return this.deck; }
  slideCount(): number { return this.deck.slides.length; }
  currentSlide() { return this.deck.slides[this.state.slideIndex]; }

  private bump(): void { this.state.stateVersion += 1; }
  private snapshot(): void {
    this.undoStack.push(structuredClone({
      slideIndex: this.state.slideIndex, effects: this.state.effects,
      pending: this.state.pending, holdForQuestions: this.state.holdForQuestions,
      paused: this.state.paused,
    }));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  private pruneEffects(): void {
    const now = Date.now();
    const before = this.state.effects.length;
    this.state.effects = this.state.effects.filter((e) => e.expiresAt > now);
    if (this.state.effects.length !== before) this.bump();
  }

  next(): boolean {
    if (this.state.slideIndex >= this.deck.slides.length - 1) return false;
    this.snapshot();
    this.state.slideIndex += 1;
    this.state.effects = [];
    this.state.pending = null;
    this.bump();
    return true;
  }

  back(): boolean {
    if (this.state.slideIndex <= 0) return false;
    this.snapshot();
    this.state.slideIndex -= 1;
    this.state.effects = [];
    this.state.pending = null;
    this.bump();
    return true;
  }

  goto(index: number): boolean {
    if (index < 0 || index >= this.deck.slides.length) return false;
    this.snapshot();
    this.state.slideIndex = index;
    this.state.effects = [];
    this.state.pending = null;
    this.bump();
    return true;
  }

  addEffect(kind: Effect["kind"], elementId: string, ttlMs: number): Effect {
    this.snapshot();
    const now = Date.now();
    if (kind === "zoom") this.state.effects = this.state.effects.filter((e) => e.kind !== "zoom");
    const fx: Effect = { id: nextId("fx"), kind, elementId, startedAt: now, expiresAt: now + ttlMs };
    this.state.effects.push(fx);
    this.bump();
    return fx;
  }

  clearEffects(): void {
    if (this.state.effects.length === 0) return;
    this.snapshot();
    this.state.effects = [];
    this.bump();
  }

  setPending(p: SessionState["pending"]): void { this.state.pending = p; this.bump(); }
  acceptPending(): SessionState["pending"] { const p = this.state.pending; this.state.pending = null; this.bump(); return p; }
  dismissPending(): void { this.state.pending = null; this.bump(); }

  setMode(mode: SessionState["mode"]): void { this.state.mode = mode; this.bump(); }
  setPaused(paused: boolean): void { this.snapshot(); this.state.paused = paused; this.bump(); }
  setHold(hold: boolean): void { this.snapshot(); this.state.holdForQuestions = hold; this.bump(); }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.state.slideIndex = prev.slideIndex;
    this.state.effects = prev.effects;
    this.state.pending = prev.pending;
    this.state.holdForQuestions = prev.holdForQuestions;
    this.state.paused = prev.paused;
    this.bump();
    return true;
  }
}
