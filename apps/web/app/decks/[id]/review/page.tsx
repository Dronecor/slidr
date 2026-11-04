"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Box, Deck, ElementType, SlideElement } from "@stage-pilot/shared";
import { SlideView } from "../../../../components/SlideView";
import { api, useMock } from "../../../../lib/api";
import { dehydrateDeck, hydrateDeck } from "../../../../lib/offline";
import { cacheDeck, displayName, displayUrl, placeDisplay, preopenDisplay } from "../../../../lib/stage";
import { getMockDeck, listMockDecks, saveMockDecks } from "../../../../lib/mock";

const TYPES: ElementType[] = ["figure", "chart", "image", "link", "text", "chart_part"];

export default function ReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const mock = useMock();
  const deckId = decodeURIComponent(params.id);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (mock) {
        const d = getMockDeck(deckId);
        setDeck(d ? await hydrateDeck(d) : d);
        return;
      }
      try {
        setDeck(await hydrateDeck(await api.getDeck(deckId)));
      } catch {
        const d = getMockDeck(deckId);
        setDeck(d ? await hydrateDeck(d) : d);
        setError("Hub unreachable — editing a local copy.");
      }
    })();
  }, [deckId, mock]);

  const slide = deck?.slides[slideIdx] ?? null;
  const selected = slide?.elements.find((e) => e.id === selectedId) ?? null;

  const mutateSlide = useCallback((fn: (els: SlideElement[]) => SlideElement[]) => {
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === slideIdx ? { ...s, elements: fn(s.elements) } : s
      );
      return { ...prev, slides };
    });
    setDirty(true);
  }, [slideIdx]);

  const onBoxChange = useCallback((id: string, box: Box) => {
    mutateSlide((els) => els.map((e) => (e.id === id ? { ...e, box, source: "user" as const } : e)));
  }, [mutateSlide]);

  const updateSelected = useCallback((patch: Partial<SlideElement>) => {
    if (!selectedId) return;
    mutateSlide((els) => els.map((e) => (e.id === selectedId ? { ...e, ...patch, source: "user" as const } : e)));
  }, [mutateSlide, selectedId]);

  const addElement = useCallback(() => {
    mutateSlide((els) => {
      if (els.length >= 12) return els;
      const n = els.length + 1;
      return [...els, {
        id: `s${slideIdx + 1}e_user${Date.now() % 100000}`,
        type: "figure" as const,
        label: `Element ${n}`,
        box: { x: 0.3, y: 0.35, w: 0.25, h: 0.15 },
        aliases: [], url: null, parentId: null, source: "user" as const,
      }];
    });
  }, [mutateSlide, slideIdx]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    mutateSlide((els) => els.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  }, [mutateSlide, selectedId]);

  const save = useCallback(async () => {
    if (!deck || !slide) return;
    setSaving(true);
    setError(null);
    try {
      if (!mock) {
        await api.saveElements(deck.id, slide.id, slide.elements);
      } else {
        const decks = listMockDecks().map((d) => (d.id === deck.id ? dehydrateDeck(structuredClone(deck)) : d));
        saveMockDecks(decks);
      }
      setDirty(false);
    } catch {
      setError("Save failed — hub unreachable. Edits are kept locally.");
      const decks = listMockDecks().map((d) => (d.id === deck.id ? dehydrateDeck(structuredClone(deck)) : d));
      saveMockDecks(decks);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [deck, slide, mock]);

  const present = useCallback(async () => {
    if (!deck) return;
    // Open the display window synchronously in this click so popup blockers
    // allow it; navigate it to the session once the session exists.
    const display = preopenDisplay("slidr-audience-pending");
    if (!display) {
      setError("Popup blocked — allow popups for this site, or open the display from the Presenter view.");
    }
    const showDisplay = (sid: string, isMock: boolean) => {
      if (!display) return;
      try {
        display.name = displayName(sid);
        display.location.href = displayUrl(sid, isMock);
        void placeDisplay(display);
      } catch { /* Presenter view can reopen it */ }
    };
    await save();
    await cacheDeck(dehydrateDeck(structuredClone(deck)));
    if (mock) {
      const sid = `MOCK${Math.floor(Math.random() * 9000 + 1000)}`;
      sessionStorage.setItem(`slidr.session.${sid}`, deck.id);
      showDisplay(sid, true);
      router.push(`/present/${sid}?mock=1`);
      return;
    }
    try {
      const { sessionId } = await api.createSession(deck.id);
      sessionStorage.setItem(`slidr.session.${sessionId}`, deck.id);
      showDisplay(sessionId, false);
      router.push(`/present/${sessionId}`);
    } catch {
      // Hub unreachable: present fully offline instead of failing.
      // The display window stays open and both windows run the local engine.
      const sid = `LOCAL${Math.floor(Math.random() * 9000 + 1000)}`;
      sessionStorage.setItem(`slidr.session.${sid}`, deck.id);
      showDisplay(sid, true);
      router.push(`/present/${sid}?mock=1`);
    }
  }, [deck, mock, router, save]);

  if (!deck || !slide) {
    return <main className="min-h-screen bg-dots-faint px-6 py-10"><p className="mx-auto max-w-6xl text-sm text-neutral-600">Loading deck…</p></main>;
  }

  return (
    <main className="min-h-screen bg-dots-faint pb-16">
      <div className="border-b-2 border-ink bg-white">
        <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <div>
            <Link href={mock ? "/library?mock=1" : "/library"} className="font-mono text-xs font-bold uppercase tracking-wider underline">← Library</Link>
            <h1 className="mt-1 text-2xl font-black tracking-tight">{deck.title}</h1>
            <p className="mt-1 font-mono text-xs text-neutral-500">
              <span className="chip-paper mr-2">review</span>
              drag boxes to fix the AI{dirty ? " · unsaved changes" : ""}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => void save()} disabled={saving || !dirty} title="Save this slide's boxes" className="btn-paper">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => void present()} title="Save, open the projector display, and open the Presenter view" className="btn-spot">
              Present →
            </button>
          </div>
        </header>
        <div className="bg-hash h-3 w-full" aria-hidden />
      </div>
      <div className="mx-auto max-w-6xl px-6">
      {error && <p className="mt-4 border-2 border-ink bg-amber-100 p-3 text-sm font-medium">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <SlideView
            slide={slide}
            editable
            showBoxes
            selectedId={selectedId}
            onSelect={setSelectedId}
            onBoxChange={onBoxChange}
            className="w-full border-2 border-ink shadow-hard"
          />
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => { setSlideIdx((i) => Math.max(0, i - 1)); setSelectedId(null); }}
              disabled={slideIdx === 0}
              className="btn-paper"
            >
              ← Prev
            </button>
            <span className="font-mono text-xs text-neutral-600">Slide {slideIdx + 1} / {deck.slides.length} · {slide.title}</span>
            <button
              onClick={() => { setSlideIdx((i) => Math.min(deck.slides.length - 1, i + 1)); setSelectedId(null); }}
              disabled={slideIdx === deck.slides.length - 1}
              className="btn-paper"
            >
              Next →
            </button>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
            {deck.slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => { setSlideIdx(i); setSelectedId(null); }}
                className={`h-9 w-9 shrink-0 border-2 font-mono text-sm font-black ${i === slideIdx ? "border-ink bg-ink text-white" : "border-ink bg-white hover:bg-neutral-100"}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        <aside className="card-pop h-fit p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Elements ({slide.elements.length}/12)</h2>
            <button onClick={addElement} disabled={slide.elements.length >= 12} className="btn-paper px-2 py-1 text-xs">+ Add</button>
          </div>
          <ul className="mt-3 space-y-2">
            {slide.elements.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={`w-full truncate border-2 px-2 py-1.5 text-left text-sm font-medium ${e.id === selectedId ? "border-ink bg-ink text-white" : "border-ink bg-white hover:bg-neutral-100"}`}
                >
                  {e.label} <span className="font-mono text-[11px] opacity-70">{e.type}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="mt-4 space-y-3 border-t-2 border-ink pt-4">
              <label className="block text-xs font-bold">Label
                <input value={selected.label} onChange={(e) => updateSelected({ label: e.target.value })} className="input-pop mt-1" />
              </label>
              <label className="block text-xs font-bold">Type
                <select value={selected.type} onChange={(e) => updateSelected({ type: e.target.value as ElementType })} className="input-pop mt-1">
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold">Aliases (comma separated)
                <input value={selected.aliases.join(", ")} onChange={(e) => updateSelected({ aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="input-pop mt-1" />
              </label>
              {selected.type === "link" && (
                <label className="block text-xs font-bold">URL
                  <input value={selected.url ?? ""} onChange={(e) => updateSelected({ url: e.target.value || null })} className="input-pop mt-1 font-mono text-xs" />
                </label>
              )}
              <p className="font-mono text-[11px] text-neutral-500">
                box {selected.box.x.toFixed(2)}, {selected.box.y.toFixed(2)}, {selected.box.w.toFixed(2)}×{selected.box.h.toFixed(2)} · {selected.source}
              </p>
              <button onClick={deleteSelected} className="w-full border-2 border-ink bg-white px-2 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50">Delete element</button>
            </div>
          )}
        </aside>
      </div>
      </div>
    </main>
  );
}
