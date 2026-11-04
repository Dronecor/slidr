import { parseSparkDecision, type SparkDecision } from "@stage-pilot/shared";
import type { SessionManager } from "./state.js";
import { Bm25Index } from "./bm25.js";
import { isExplicitLinkCue, isHoldPhrase, matchFastCommand } from "./grammar.js";
import type { SparkClient } from "./meta.js";
import type { DecisionLogger } from "./logger.js";

export const THRESHOLDS = { highlight: 0.6, zoom: 0.7, openLink: 0.9, nextInferred: 0.85 } as const;
const HIGHLIGHT_TTL = 6000, ZOOM_TTL = 8000, COOLDOWN_MS = 8000, LATE_MS = 1200;

export interface IntentDeps {
  spark: SparkClient;
  logger: DecisionLogger;
  now?: () => number;
}

/** Intent engine: fast path on interim, semantic path on final/stable, BM25 fusion gate. */
export class IntentEngine {
  private lastFired = new Map<string, number>();
  private covered = new Set<string>();
  private bm25 = new Bm25Index();
  private now: () => number;

  constructor(private deps: IntentDeps) { this.now = deps.now ?? Date.now; }

  rebuildIndex(session: SessionManager): void {
    const docs = session.getDeck().slides.flatMap((s) => [
      ...s.keyPoints.map((k) => ({ id: k.id, text: k.text, weight: k.weight })),
      ...(s.notes ? [{ id: `${s.id}:notes`, text: s.notes, weight: 3 }] : []),
    ]);
    this.bm25.build(docs);
  }

  resetSlideCoverage(): void { this.covered.clear(); }

  private log(session: SessionManager, d: { action: string; targetId: string | null; confidence: number; reason: string; coveredKeyPointIds?: string[]; path: "fast" | "semantic" | "fusion" }, latencyMs: number, applied: boolean): void {
    this.deps.logger.log({
      ts: this.now(), sessionId: session.getState().sessionId, action: d.action,
      targetId: d.targetId, confidence: d.confidence, reason: d.reason,
      path: d.path, latencyMs: Math.round(latencyMs), applied,
    });
  }

  /** Returns true if a fast command was applied. */
  handleInterim(session: SessionManager, text: string): boolean {
    const started = performance.now();
    const slide = session.currentSlide();
    if (!slide) return false;
    const cmd = matchFastCommand(text, slide);
    if (!cmd) return false;
    if (session.getState().paused && cmd.kind !== "resume") return false;
    let applied = false;
    if (cmd.kind === "next") applied = session.next();
    else if (cmd.kind === "back") applied = session.back();
    else if (cmd.kind === "goto") applied = session.goto(cmd.index);
    else if (cmd.kind === "pause") { session.setPaused(true); applied = true; }
    else if (cmd.kind === "resume") { session.setPaused(false); session.setHold(false); applied = true; }
    else if (cmd.kind === "undo") applied = session.undo();
    else if (cmd.kind === "hold") { session.setHold(true); applied = true; }
    else if (cmd.kind === "zoom") applied = this.applyEffect(session, "zoom", cmd.elementId, 1, "fast");
    else if (cmd.kind === "highlight") applied = this.applyEffect(session, "highlight", cmd.elementId, 1, "fast");
    if (applied && (cmd.kind === "next" || cmd.kind === "back" || cmd.kind === "goto")) this.resetSlideCoverage();
    if (applied) this.log(session, { action: cmd.kind, targetId: "elementId" in cmd ? cmd.elementId : null, confidence: 1, coveredKeyPointIds: [], reason: `fast path: ${cmd.kind}`, path: "fast" }, performance.now() - started, true);
    return applied;
  }

  private cooldownOk(key: string): boolean {
    const last = this.lastFired.get(key) ?? 0;
    if (this.now() - last < COOLDOWN_MS) return false;
    this.lastFired.set(key, this.now());
    return true;
  }

  private applyEffect(session: SessionManager, kind: "highlight" | "zoom", elementId: string, confidence: number, path: "fast" | "semantic"): boolean {
    const state = session.getState();
    if (state.mode === "manual" && path === "semantic") return false;
    if (!this.cooldownOk(`${kind}:${elementId}`)) return false;
    if (state.mode === "assist" && path === "semantic") {
      session.setPending({ id: `pend_${this.now()}`, action: kind, targetId: elementId, confidence, reason: `${kind} suggestion` });
      return true;
    }
    session.addEffect(kind, elementId, kind === "zoom" ? ZOOM_TTL : HIGHLIGHT_TTL);
    return true;
  }

  /** Semantic path. Late (>1.2s) or invalid model output is treated as none. */
  async handleFinal(session: SessionManager, transcript: string): Promise<void> {
    const started = performance.now();
    const state = session.getState();
    const slide = session.currentSlide();
    if (!slide || state.paused || state.mode === "manual") return;
    if (isHoldPhrase(transcript)) { session.setHold(true); return; }
    if (state.holdForQuestions) return;

    for (const id of this.bm25.coverage(slide.keyPoints, transcript).covered) this.covered.add(id);
    const validIds = new Set(slide.elements.map((e) => e.id));
    const prompt = [
      "You drive slides. Reply with JSON only:",
      '{"action":"none|highlight|zoom|open_link|next","targetId":"id or null","confidence":0.0,"coveredKeyPointIds":[],"reason":"one sentence"}',
      `Slide: ${slide.title}. Elements: ${slide.elements.map((e) => `${e.id}=${e.label}`).join(", ")}`,
      `Key points: ${slide.keyPoints.map((k) => `${k.id}=${k.text}`).join("; ")}`,
      `Transcript: ${transcript}`,
    ].join("\n");

    let raw: unknown = null;
    try { raw = await this.deps.spark.decide(prompt); } catch { raw = null; }
    const latency = performance.now() - started;
    if (latency > LATE_MS) {
      this.log(session, { action: "none", targetId: null, confidence: 0, coveredKeyPointIds: [], reason: "late response discarded", path: "semantic" }, latency, false);
      return;
    }
    const decision = parseSparkDecision(raw, validIds);
    if (!decision || decision.action === "none") {
      if (decision) this.log(session, { ...decision, path: "semantic" }, latency, false);
      return;
    }
    for (const id of decision.coveredKeyPointIds) if (slide.keyPoints.some((k) => k.id === id)) this.covered.add(id);

    if (decision.action === "highlight" && decision.targetId) {
      const ok = decision.confidence >= THRESHOLDS.highlight && this.applyEffect(session, "highlight", decision.targetId, decision.confidence, "semantic");
      this.log(session, { ...decision, path: "semantic" }, latency, ok);
      return;
    }
    if (decision.action === "zoom" && decision.targetId) {
      const ok = decision.confidence >= THRESHOLDS.zoom && this.applyEffect(session, "zoom", decision.targetId, decision.confidence, "semantic");
      this.log(session, { ...decision, path: "semantic" }, latency, ok);
      return;
    }
    if (decision.action === "open_link" && decision.targetId) {
      const el = slide.elements.find((e) => e.id === decision.targetId);
      const ok = decision.confidence >= THRESHOLDS.openLink && isExplicitLinkCue(transcript) && Boolean(el?.url);
      if (ok && state.mode === "assist") session.setPending({ id: `pend_${this.now()}`, action: "open_link", targetId: decision.targetId, confidence: decision.confidence, reason: decision.reason });
      else if (ok) session.addEffect("link", decision.targetId, HIGHLIGHT_TTL);
      this.log(session, { ...decision, path: "semantic" }, latency, ok);
      return;
    }
    if (decision.action === "next") {
      // Fusion: BM25 coverage/cue must agree, else do nothing. Never skip >1 slide.
      const total = slide.keyPoints.length || 1;
      const ratio = this.covered.size / total;
      const cueHeard = Boolean(slide.nextCue && transcript.toLowerCase().includes(slide.nextCue.toLowerCase().slice(0, 20)))
        || slide.triggerPhrases.some((p) => transcript.toLowerCase().includes(p.toLowerCase()));
      const fusionOk = ratio >= 0.7 || cueHeard;
      const ok = decision.confidence >= THRESHOLDS.nextInferred && fusionOk && !state.holdForQuestions;
      if (ok && state.mode === "assist") {
        session.setPending({ id: `pend_${this.now()}`, action: "next", targetId: null, confidence: decision.confidence, reason: decision.reason });
        this.log(session, { ...decision, path: "fusion" }, latency, true);
        return;
      }
      const applied = ok ? session.next() : false;
      if (applied) this.resetSlideCoverage();
      this.log(session, { ...decision, path: "fusion" }, latency, applied);
    }
  }

  acceptPending(session: SessionManager): void {
    const p = session.acceptPending();
    if (!p) return;
    if (p.action === "next") { if (session.next()) this.resetSlideCoverage(); }
    else if (p.action === "highlight" && p.targetId) session.addEffect("highlight", p.targetId, HIGHLIGHT_TTL);
    else if (p.action === "zoom" && p.targetId) session.addEffect("zoom", p.targetId, ZOOM_TTL);
    else if (p.action === "open_link" && p.targetId) session.addEffect("link", p.targetId, HIGHLIGHT_TTL);
  }
}
