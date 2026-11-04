"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Deck } from "@stage-pilot/shared";
import { Logo } from "../../components/Logo";
import { api, useMock } from "../../lib/api";
import { listMockDecks, saveMockDecks } from "../../lib/mock";
import { ingestPdfOffline } from "../../lib/offline";

export default function LibraryPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mock = useMock();

  const refresh = useCallback(async () => {
    const local = listMockDecks();
    if (mock) {
      setDecks(local);
      return;
    }
    try {
      const remote = await api.listDecks();
      // Show hub decks plus any offline decks the hub never saw.
      const remoteIds = new Set(remote.map((d) => d.id));
      setDecks([...remote, ...local.filter((d) => !remoteIds.has(d.id))]);
    } catch {
      // Hub unreachable: local and offline decks still work.
      setDecks(local);
    }
  }, [mock]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll processing decks for per-step progress.
  useEffect(() => {
    if (mock) return;
    const processing = decks.filter((d) => d.status === "processing");
    if (processing.length === 0) return;
    const t = setInterval(async () => {
      try {
        const updated = await Promise.all(processing.map((d) => api.getDeck(d.id)));
        setDecks((prev) => prev.map((d) => updated.find((u) => u.id === d.id) ?? d));
      } catch { /* keep last state */ }
    }, 2000);
    return () => clearInterval(t);
  }, [decks, mock]);

  const offlineUpload = async (f: File) => {
    const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    if (!isPdf) {
      setError("No backend connection — PPTX conversion needs the hub (LibreOffice). Export the deck as PDF from PowerPoint (File → Export → PDF) and upload that instead.");
      setProgress(null);
      setBusy(false);
      return;
    }
    try {
      const deck = await ingestPdfOffline(f, (done, total) =>
        setProgress(`Rendering slide ${Math.min(done + 1, total)}/${total}…`)
      );
      saveMockDecks([deck, ...listMockDecks()]);
      setProgress(null);
      setBusy(false);
      void refresh();
    } catch (err) {
      setError(`Could not read that PDF in the browser (${err instanceof Error ? err.message : "unknown error"}).`);
      setProgress(null);
      setBusy(false);
    }
  };

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    setProgress("Uploading…");
    if (mock) {
      void offlineUpload(f);
      return;
    }
    try {
      const { deckId } = await api.uploadDeck(f);
      setProgress("Processing…");
      const t = setInterval(async () => {
        try {
          const deck = await api.getDeck(deckId);
          if (deck.status === "ready" || deck.status === "review" || deck.status === "failed") {
            clearInterval(t);
            setProgress(null);
            setBusy(false);
            void refresh();
          }
        } catch { /* retry next tick */ }
      }, 2000);
      setTimeout(() => { clearInterval(t); setBusy(false); setProgress(null); void refresh(); }, 120000);
    } catch {
      // Hub unreachable: fall back to real in-browser ingestion.
      setError("Hub unreachable — rendering this file in the browser instead (present it in Manual).");
      void offlineUpload(f);
    }
  };

  return (
    <main className="min-h-screen bg-dots-faint pb-16">
      {/* Hero band */}
      <div className="border-b-2 border-ink bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-5 px-6 py-8">
          <Link href={mock ? "/?mock=1" : "/"} title="Back to home">
            <div className="shrink-0 -rotate-3 border-2 border-ink bg-white p-1 shadow-hard transition-transform hover:rotate-0">
              <Logo size={64} />
            </div>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-4xl font-black tracking-tight">slidr</h1>
              {mock && <span className="chip-ink">mock hub</span>}
            </div>
            <p className="mt-1 text-[15px] text-neutral-700">
              Speak. It spotlights the chart, zooms the screenshot, opens the link.
            </p>
          </div>
        </div>
        <div className="bg-hash h-3 w-full" aria-hidden />
      </div>

      <div className="mx-auto max-w-4xl px-6">
        <section className="card-pop mt-8 p-6">
          <div className="flex items-center gap-3">
            <span className="chip-ink">1</span>
            <h2 className="text-lg font-black">Upload a deck</h2>
          </div>
          <p className="mt-2 text-sm text-neutral-700">
            PPTX or PDF. Each slide is converted, analysed and ready to present in about a minute.
            No backend? PDFs still upload — they render right in your browser.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="btn-ink cursor-pointer" title="Pick a .pptx or .pdf file from your computer">
              Choose file…
              <input
                ref={fileRef}
                type="file"
                accept=".pptx,.pdf"
                className="hidden"
                onChange={(e) => void onUpload(e.target.files?.[0])}
                disabled={busy}
              />
            </label>
            {busy && (
              <span className="chip-paper">
                <span className="live-dot mr-1 inline-block h-2 w-2 rounded-full bg-spot align-middle" />
                {progress ?? "Working…"}
              </span>
            )}
            {!busy && <span className="font-mono text-xs text-neutral-500">.pptx or .pdf, up to ~50 MB</span>}
          </div>
          {error && <p className="mt-3 border-2 border-ink bg-amber-100 p-2 text-sm font-medium">{error}</p>}
        </section>

        <section className="mt-8">
          <div className="flex items-center gap-3">
            <span className="chip-ink">2</span>
            <h2 className="text-lg font-black">Your decks</h2>
            <div className="bg-hash-faint h-4 flex-1" aria-hidden />
          </div>
          {decks.length === 0 && (
            <p className="card-pop mt-4 p-6 text-sm text-neutral-700">
              No decks yet. Upload a PPTX or PDF above — or open the{" "}
              <Link className="font-bold underline" href="/decks/deck_demo/review?mock=1">demo deck review</Link>.
            </p>
          )}
          <ul className="mt-4 space-y-4">
            {decks.map((d) => (
              <li key={d.id} className="card-pop flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-4">
                  <span className="bg-dots flex h-12 w-12 shrink-0 items-center justify-center border-2 border-ink bg-white font-mono text-lg font-black">
                    {d.slides.length}
                  </span>
                  <div>
                    <p className="font-bold">{d.title}</p>
                    <p className="font-mono text-xs text-neutral-500">
                      {d.slides.length} slides ·{" "}
                      <span className={d.status === "processing" ? "font-bold text-amber-700" : "font-bold text-moss"}>
                        {d.status}{d.status === "processing" ? " · converting…" : ""}
                      </span>
                    </p>
                  </div>
                </div>
                <Link
                  href={`/decks/${encodeURIComponent(d.id)}/review${mock ? "?mock=1" : ""}`}
                  title={`Review ${d.title}`}
                  className="btn-ink shrink-0"
                >
                  Review →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
