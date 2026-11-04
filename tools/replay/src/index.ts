#!/usr/bin/env node
import { readFile } from "node:fs/promises";

/**
 * Replay harness: feeds a timestamped transcript file through expected-action checks.
 * Input JSON: { "deckSlides": n, "lines": [{ "ts": 0, "text": "...", "expect": "next|none|highlight" }] }
 * Without a hub it evaluates the fast-path expectations locally for tuning.
 * Usage: node dist/index.js <transcript.json> [--hub http://127.0.0.1:8787]
 */
interface Line { ts: number; text: string; expect: string }

function fastExpect(text: string): string {
  const t = text.toLowerCase();
  if (/\b(next slide|move on)\b/.test(t)) return "next";
  if (/\b(go back|previous slide)\b/.test(t)) return "back";
  if (/\bzoom\b/.test(t)) return "zoom";
  if (/\bhighlight|look at\b/.test(t)) return "highlight";
  return "none";
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) { console.error("usage: replay <transcript.json>"); process.exit(2); }
  const data = JSON.parse(await readFile(file, "utf8")) as { lines: Line[] };
  let pass = 0, fail = 0;
  for (const line of data.lines) {
    const got = fastExpect(line.text);
    const ok = got === line.expect;
    if (ok) pass++; else fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ts=${line.ts} expect=${line.expect} got=${got} :: ${line.text}`);
  }
  console.log(`replay: ${pass} passed, ${fail} failed, ${data.lines.length} total`);
  if (fail > 0) process.exit(1);
}

void main();
