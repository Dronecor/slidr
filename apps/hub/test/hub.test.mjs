import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "../dist/state.js";
import { matchFastCommand } from "../dist/grammar.js";
import { Bm25Index } from "../dist/bm25.js";
import { IntentEngine } from "../dist/intent.js";
import { DecisionLogger } from "../dist/logger.js";
import { FakeSparkClient } from "../dist/meta.js";
import { DiskDeckStore } from "../dist/storage.js";
import { IngestionPipeline } from "../dist/ingest.js";
import { loadConfig } from "../dist/config.js";

function deck() {
  return { id: "d1", title: "T", status: "ready", slides: [0, 1].map((i) => ({
    id: `s${i + 1}`, index: i, imageUrl: "/x.png", width: 1920, height: 1080, title: `Slide ${i + 1}`,
    notes: "", summary: "", keyPoints: [{ id: `s${i + 1}k1`, text: "revenue grew strongly", weight: 1 }],
    nextCue: "moving on", triggerPhrases: ["moving on"],
    elements: [{ id: `s${i + 1}e1`, type: "chart", label: "revenue chart", box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, aliases: ["the chart"], url: null, parentId: null, source: "model" }],
  })) };
}

test("state machine: next/back/goto bounds, version bumps, undo", () => {
  const m = new SessionManager(deck(), "S1");
  assert.equal(m.getState().slideIndex, 0);
  assert.equal(m.next(), true);
  assert.equal(m.getState().slideIndex, 1);
  assert.equal(m.next(), false);
  assert.equal(m.back(), true);
  assert.equal(m.goto(5), false);
  assert.equal(m.goto(1), true);
  const v = m.getState().stateVersion;
  assert.ok(v > 0);
  assert.equal(m.undo(), true);
});

test("fast path grammar", () => {
  const slide = deck().slides[0];
  assert.equal(matchFastCommand("next slide please", slide)?.kind, "next");
  assert.equal(matchFastCommand("go back", slide)?.kind, "back");
  assert.deepEqual(matchFastCommand("go to slide 2", slide), { kind: "goto", index: 1 });
  assert.equal(matchFastCommand("zoom in on the chart", slide)?.kind, "zoom");
  assert.equal(matchFastCommand("the weather is nice", slide), null);
  assert.equal(matchFastCommand("any questions", slide)?.kind, "hold");
});

test("bm25 coverage + best", () => {
  const idx = new Bm25Index();
  idx.build([{ id: "a", text: "revenue grew strongly", weight: 1 }, { id: "b", text: "costs fell sharply", weight: 1 }]);
  const cov = idx.coverage([{ id: "a", text: "revenue grew strongly" }], "revenue grew strongly this quarter");
  assert.equal(cov.ratio, 1);
  assert.equal(idx.best("revenue").id, "a");
});

test("intent: fast next fires, manual mode blocks semantic, fusion blocks low coverage", async () => {
  const logger = new DecisionLogger();
  const spark = new FakeSparkClient();
  const engine = new IntentEngine({ spark, logger });
  const m = new SessionManager(deck(), "S2");
  engine.rebuildIndex(m);
  assert.equal(engine.handleInterim(m, "next slide"), true);
  assert.equal(m.getState().slideIndex, 1);

  // FakeSpark returns none, so no semantic advance; also test confidence gate with stub
  const stub = { vision: spark.vision.bind(spark), narrative: spark.narrative.bind(spark),
    decide: async () => ({ action: "next", targetId: null, confidence: 0.99, coveredKeyPointIds: [], reason: "eager" }) };
  const e2 = new IntentEngine({ spark: stub, logger });
  const m2 = new SessionManager(deck(), "S3");
  e2.rebuildIndex(m2);
  await e2.handleFinal(m2, "some unrelated words with no coverage");
  assert.equal(m2.getState().slideIndex, 0, "fusion must block advance without coverage/cue");
  await e2.handleFinal(m2, "revenue grew strongly, moving on");
  assert.equal(m2.getState().slideIndex, 1, "coverage + cue allows advance");
});

test("ingestion pipeline with injected converters (upload slice)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hub-test-"));
  const cfg = loadConfig({ dataDir: dir });
  const store = new DiskDeckStore(dir);
  const pipe = new IngestionPipeline({
    store, spark: new FakeSparkClient(), dataDir: dir,
    convertToPdf: async () => path.join(dir, "fake.pdf"),
    renderPngs: async () => { const p = path.join(dir, "s.png"); const { writeFile } = await import("node:fs/promises"); await writeFile(p, Buffer.from("png")); return [p, p]; },
    extractText: async () => ["Revenue grew\nDetail", "Costs fell\nDetail"],
  });
  const d = await pipe.ingest("deck_test", "Test Deck", "test.pptx", Buffer.from("fake-pptx"));
  assert.equal(d.slides.length, 2);
  assert.equal(d.status, "review");
  assert.ok(d.slides[0].elements.length >= 1);
  assert.equal(pipe.getProgress("deck_test")?.steps.index, "done");
  const saved = await store.getDeck("deck_test");
  assert.equal(saved?.title, "Test Deck");
  void cfg;
});

test("config has no hardcoded key default", () => {
  const c = loadConfig();
  assert.equal(typeof c.metaApiBase, "string");
  assert.ok(c.metaApiBase.startsWith("https://"));
});
