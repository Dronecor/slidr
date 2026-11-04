import { test } from "node:test";
import assert from "node:assert/strict";
import { DeckSchema, SessionStateSchema, SparkDecisionSchema, parseSparkDecision, WsEnvelopeSchema } from "../dist/index.js";

test("deck contract accepts valid deck, caps elements at 12", () => {
  const ok = { id: "d1", title: "T", status: "ready", slides: [{ id: "s1", index: 0, imageUrl: "/x.png", width: 1920, height: 1080, title: "A", notes: "", summary: "", keyPoints: [], nextCue: "", triggerPhrases: [], elements: [] }] };
  assert.equal(DeckSchema.parse(ok).id, "d1");
  const tooMany = structuredClone(ok);
  tooMany.slides[0].elements = Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, type: "text", label: "x", box: { x: 0, y: 0, w: 0.1, h: 0.1 }, aliases: [], url: null, parentId: null, source: "model" }));
  assert.equal(DeckSchema.safeParse(tooMany).success, false);
});

test("box must be normalised 0..1", () => {
  const bad = { id: "d1", title: "T", status: "ready", slides: [{ id: "s1", index: 0, imageUrl: "/x.png", width: 1920, height: 1080, title: "A", elements: [{ id: "e1", type: "text", label: "x", box: { x: 2, y: 0, w: 0.1, h: 0.1 } }] }] };
  assert.equal(DeckSchema.safeParse(bad).success, false);
});

test("session state + spark decision validation", () => {
  assert.equal(SessionStateSchema.parse({ sessionId: "S1", deckId: "d1", slideIndex: 0, mode: "auto", paused: false, holdForQuestions: false, effects: [], pending: null, stateVersion: 0 }).mode, "auto");
  assert.equal(SparkDecisionSchema.safeParse({ action: "next", targetId: null, confidence: 0.9, coveredKeyPointIds: [], reason: "cue" }).success, true);
  assert.equal(parseSparkDecision({ action: "highlight", targetId: "nope", confidence: 0.9, coveredKeyPointIds: [], reason: "x" }, new Set(["s1e1"])), null);
  assert.equal(parseSparkDecision({ action: "highlight", targetId: "s1e1", confidence: 0.9, coveredKeyPointIds: [], reason: "x" }, new Set(["s1e1"]))?.targetId, "s1e1");
  assert.equal(parseSparkDecision({ action: "bogus" }, new Set()), null);
});

test("ws envelope requires v=1", () => {
  assert.equal(WsEnvelopeSchema.safeParse({ v: 1, type: "join", seq: 1, payload: {} }).success, true);
  assert.equal(WsEnvelopeSchema.safeParse({ v: 2, type: "join", seq: 1, payload: {} }).success, false);
});
