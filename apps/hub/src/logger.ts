import type { DecisionLog } from "@stage-pilot/shared";

export class DecisionLogger {
  private entries: DecisionLog[] = [];
  private latencies: number[] = [];

  log(entry: DecisionLog): void {
    this.entries.push(entry);
    this.latencies.push(entry.latencyMs);
    if (this.entries.length > 500) this.entries.shift();
    if (this.latencies.length > 500) this.latencies.shift();
    console.log(JSON.stringify({ kind: "decision", ...entry }));
  }

  recent(limit = 50): DecisionLog[] {
    return this.entries.slice(-limit);
  }

  percentile(p: number): number | null {
    if (this.latencies.length === 0) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[idx]);
  }
}
