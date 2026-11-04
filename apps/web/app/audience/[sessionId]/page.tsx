"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Deck, SessionState } from "@slidr/shared";
import { SlideView } from "../../../components/SlideView";
import { api, useMock } from "../../../lib/api";
import { FakeHub, getMockDeck } from "../../../lib/mock";
import { hydrateDeck } from "../../../lib/offline";
import { readCachedDeck } from "../../../lib/stage";
import { PilotSocket, type ConnStatus, type HubClient } from "../../../lib/ws";

export default function AudiencePage({ params }: { params: { sessionId: string } }) {
  const sessionId = decodeURIComponent(params.sessionId);
  const mock = useMock();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [hint, setHint] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const loadDeck = useCallback(async (deckId: string) => {
    if (mock) {
      const d = getMockDeck(deckId) ?? getMockDeck("deck_demo");
      setDeck(d ? await hydrateDeck(d) : d);
      return;
    }
    try {
      setDeck(await hydrateDeck(await api.getDeck(deckId)));
    } catch {
      const cached = readCachedDeck(deckId);
      if (cached) setDeck(await hydrateDeck(cached));
    }
  }, [mock]);

  useEffect(() => {
    if (!mock) {
      const deckId = sessionStorage.getItem(`slidr.session.${sessionId}`);
      const client: HubClient = new PilotSocket(sessionId, "audience");
      client.onState((s) => {
        setState(s);
        setDeck((prev) => {
          if (!prev || prev.id !== s.deckId) void loadDeck(s.deckId);
          return prev;
        });
      });
      client.onStatus((s) => setStatus(s));
      client.connect();
      if (deckId) void loadDeck(deckId);
      return () => client.disconnect();
    }
    // Mock: mirror the presenter window over BroadcastChannel.
    const bc = new BroadcastChannel(`slidr.${sessionId}`);
    let gotState = false;
    let solo: FakeHub | null = null;
    bc.onmessage = (ev: MessageEvent<{ kind: string; state?: SessionState }>) => {
      if (ev.data?.kind === "state" && ev.data.state) {
        gotState = true;
        // A late presenter beats the standalone fallback: stop the solo show.
        if (solo) { solo.disconnect(); solo = null; }
        setStatus("open");
        setState(ev.data.state);
        const id = ev.data.state.deckId;
        setDeck((prev) => {
          if (!prev || prev.id !== id) void loadDeck(id);
          return prev;
        });
      }
    };
    // The presenter may mount after us: keep asking for state until it answers.
    bc.postMessage({ kind: "hello" });
    const hello = setInterval(() => {
      if (!gotState) bc.postMessage({ kind: "hello" });
    }, 500);
    // Standalone fallback: no presenter window — run the scripted cycle alone.
    const deckId = sessionStorage.getItem(`slidr.session.${sessionId}`) || "deck_demo";
    const t = setTimeout(() => {
      if (gotState) return;
      const hub = new FakeHub(sessionId, getMockDeck(deckId) ?? getMockDeck("deck_demo")!, "audience");
      solo = hub;
      hub.onState((s) => setState(s));
      hub.onStatus((s) => setStatus(s));
      hub.connect();
      void loadDeck(deckId);
      hub.startCycle();
    }, 2500);
    return () => { clearTimeout(t); clearInterval(hello); bc.close(); solo?.disconnect(); };
  }, [sessionId, mock, loadDeck]);

  const goFullscreen = useCallback(() => {
    // Browsers only allow fullscreen from a gesture inside this window,
    // so the first click on the display takes it fullscreen.
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
    setHint(false);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const slide = deck && state ? deck.slides[state.slideIndex] : null;
  const now = Date.now();
  const activeLinkUrl = (() => {
    if (!slide || !state) return null;
    const fx = state.effects.find((e) => e.kind === "link" && e.expiresAt > now);
    if (!fx) return null;
    return slide.elements.find((el) => el.id === fx.elementId)?.url ?? null;
  })();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") goFullscreen();
      // Open the overlaid link in a new tab; the slides keep running here.
      if ((e.key === "o" || e.key === "O") && activeLinkUrl) {
        window.open(activeLinkUrl, "_blank", "noopener");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goFullscreen, activeLinkUrl]);

  // Cursor stays hidden on stage, except while a link card needs clicking.
  const hideCursor = isFullscreen && !activeLinkUrl;

  return (
    <main className={`${hideCursor ? "audience-cursor-none" : ""} flex min-h-screen items-center justify-center bg-black`} onClick={goFullscreen}>
      {slide ? (
        <SlideView
          slide={slide}
          effects={state?.effects ?? []}
          className="max-h-screen w-full"
        />
      ) : (
        <p className="font-mono text-sm text-neutral-400">
          {status === "open" ? "Waiting for the presenter…" : `Connecting… (${status})`}
        </p>
      )}
      {!isFullscreen && slide && (
        <button
          onClick={(e) => { e.stopPropagation(); goFullscreen(); }}
          title="Take the projector display fullscreen"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 border-2 border-white bg-spot px-6 py-3 text-base font-black text-ink shadow-[4px_4px_0_0_rgba(255,255,255,0.9)] transition-transform hover:-translate-y-0.5"
        >
          ⛶ Go fullscreen
        </button>
      )}
      {!slide && hint && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 border border-neutral-700 bg-neutral-900/90 px-4 py-2 font-mono text-xs text-neutral-300">
          Drag this window onto the projector · press F for fullscreen
        </div>
      )}
      {status !== "open" && slide && (
        <div className="absolute right-4 top-4 h-2 w-2 rounded-full bg-amber-400" title={`reconnecting (${status})`} />
      )}
    </main>
  );
}
