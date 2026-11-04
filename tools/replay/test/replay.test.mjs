import { test } from "node:test";
import assert from "node:assert/strict";

// Replay fast-expect logic mirrored from src/index.ts (kept honest by hub grammar tests).
function fastExpect(text) {
  const t = text.toLowerCase();
  if (/\b(next slide|move on)\b/.test(t)) return "next";
  if (/\b(go back|previous slide)\b/.test(t)) return "back";
  if (/\bzoom\b/.test(t)) return "zoom";
  if (/\bhighlight|look at\b/.test(t)) return "highlight";
  return "none";
}

test("replay expectations", () => {
  assert.equal(fastExpect("next slide"), "next");
  assert.equal(fastExpect("please go back"), "back");
  assert.equal(fastExpect("zoom in here"), "zoom");
  assert.equal(fastExpect("just talking normally"), "none");
});
