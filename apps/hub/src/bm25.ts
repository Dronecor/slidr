/** Minimal BM25 over slide key points + notes. No embeddings per spec. */

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9%\s]/g, " ").split(/\s+/).filter(Boolean);
}

export interface Bm25Doc { id: string; text: string; weight: number }

export class Bm25Index {
  private docs: Bm25Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  build(docs: Bm25Doc[]): void {
    this.docs = docs;
    this.df.clear();
    let total = 0;
    for (const d of docs) {
      const toks = tokenize(d.text);
      total += toks.length;
      for (const t of new Set(toks)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = docs.length ? total / docs.length : 0;
  }

  /** Score one doc against a query; 0 when no overlap. */
  scoreDoc(doc: Bm25Doc, query: string): number {
    const q = tokenize(query);
    if (q.length === 0 || this.docs.length === 0) return 0;
    const toks = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const k1 = 1.5, b = 0.75, n = this.docs.length;
    let score = 0;
    for (const term of new Set(q)) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const df = this.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = f + k1 * (1 - b + (b * toks.length) / (this.avgLen || 1));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    return score * (doc.weight || 1);
  }

  /** Best doc score for a query, normalised to 0..1 against the corpus max. */
  best(query: string): { id: string | null; score: number } {
    if (this.docs.length === 0) return { id: null, score: 0 };
    let bestId: string | null = null, bestRaw = 0, maxRaw = 0;
    const raw = this.docs.map((d) => ({ id: d.id, s: this.scoreDoc(d, query) }));
    for (const r of raw) maxRaw = Math.max(maxRaw, r.s);
    for (const r of raw) if (r.s > bestRaw) { bestRaw = r.s; bestId = r.id; }
    return { id: bestId, score: maxRaw > 0 ? bestRaw / maxRaw : 0 };
  }

  /** Fraction of a slide's key points whose terms appear in the transcript. */
  coverage(keyPoints: { id: string; text: string }[], transcript: string): { covered: string[]; ratio: number } {
    const heard = new Set(tokenize(transcript));
    const covered: string[] = [];
    for (const kp of keyPoints) {
      const terms = tokenize(kp.text).filter((t) => t.length > 2);
      if (terms.length === 0) continue;
      const hits = terms.filter((t) => heard.has(t)).length;
      if (hits / terms.length >= 0.5) covered.push(kp.id);
    }
    return { covered, ratio: keyPoints.length ? covered.length / keyPoints.length : 0 };
  }
}
