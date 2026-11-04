import type { Slide } from "@stage-pilot/shared";

export type FastCommand =
  | { kind: "next" }
  | { kind: "back" }
  | { kind: "goto"; index: number }
  | { kind: "zoom"; elementId: string }
  | { kind: "highlight"; elementId: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "undo" }
  | { kind: "hold" }
  | null;

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Command grammar on interim text. Fires immediately, no model. Spec: Fast path. */
export function matchFastCommand(raw: string, slide: Slide): FastCommand {
  const t = ` ${norm(raw)} `;
  if (/\b(next slide|move on|advance)\b/.test(t)) return { kind: "next" };
  if (/\b(go back|previous slide|back a slide)\b/.test(t)) return { kind: "back" };
  const goto = t.match(/\bgo to slide (\d{1,2})\b/);
  if (goto) return { kind: "goto", index: Number(goto[1]) - 1 };
  if (/\b(any questions|take questions|lets take questions|let's take questions)\b/.test(t)) return { kind: "hold" };
  if (/\bpause\b/.test(t)) return { kind: "pause" };
  if (/\bresume\b/.test(t)) return { kind: "resume" };
  if (/\bundo\b/.test(t)) return { kind: "undo" };

  const wantsZoom = /\b(zoom|look closer|show me)\b/.test(t);
  const wantsHighlight = /\b(highlight|point (to|at)|look at)\b/.test(t);
  if (wantsZoom || wantsHighlight) {
    const flat = norm(raw);
    for (const el of slide.elements) {
      const names = [el.label, ...el.aliases].map(norm).filter(Boolean);
      if (names.some((n) => flat.includes(n))) {
        return wantsZoom ? { kind: "zoom", elementId: el.id } : { kind: "highlight", elementId: el.id };
      }
    }
  }
  return null;
}

export function isHoldPhrase(raw: string): boolean {
  return /\b(any questions|take questions|questions so far)\b/i.test(raw);
}

export function isExplicitLinkCue(raw: string): boolean {
  return /\b(open the demo|open the link|watch the demo|click the link)\b/i.test(raw);
}
