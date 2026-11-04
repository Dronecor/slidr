"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Deck,
  Mode,
  SessionState,
  TranscriptPayload,
} from "@stage-pilot/shared";
import { SlideView } from "../../../components/SlideView";
import { api, useMock } from "../../../lib/api";
import { FakeHub, getMockDeck } from "../../../lib/mock";
import { MicAudioSource, type AudioDevice } from "../../../lib/audio";
import { hydrateDeck } from "../../../lib/offline";
import { getScreens, openAudienceWindow, placeDisplay, readCachedDeck, type ScreenInfo } from "../../../lib/stage";
import { PilotSocket, type ConnStatus, type DecisionEvent, type HealthEvent, type HubClient } from "../../../lib/ws";

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The hub broadcasts state but no per-decision frames, so the Last action
 * panel derives the visible action from consecutive states (mock mode sends
 * real decisions and skips this).
 */
function deriveDecision(prev: SessionState, cur: SessionState): DecisionEvent | null {
  const base = {
    confidence: null,
    reason: "Observed from hub state (the hub sends no decision frames)",
    path: "hub",
    latencyMs: 0,
    applied: true,
  } as const;
  if (cur.slideIndex !== prev.slideIndex) {
    return { action: cur.slideIndex > prev.slideIndex ? "next" : "back", targetId: null, ...base };
  }
  const before = new Set(prev.effects.map((e) => e.id));
  const added = cur.effects.find((e) => !before.has(e.id));
  if (added) {
    return {
      action: added.kind === "link" ? "open_link" : added.kind,
      targetId: added.elementId,
      ...base,
    };
  }
  return null;
}

export default function PresenterPage({ params }: { params: { sessionId: string } }) {
  const sessionId = decodeURIComponent(params.sessionId);
  const mock = useMock();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [transcripts, setTranscripts] = useState<TranscriptPayload[]>([]);
  const [interim, setInterim] = useState("");
  const [lastDecision, setLastDecision] = useState<DecisionEvent | null>(null);
  const [health, setHealth] = useState<HealthEvent | null>(null);
  const [hubError, setHubError] = useState<{ code: string; message: string } | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [micOn, setMicOn] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [micWarn, setMicWarn] = useState<string | null>(null);
  const [scriptLine, setScriptLine] = useState("");
  const [gotoIdx, setGotoIdx] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [screens, setScreens] = useState<ScreenInfo[] | null | "denied">(null);
  const [displayNote, setDisplayNote] = useState<string | null>(null);

  const clientRef = useRef<HubClient | null>(null);
  const micRef = useRef<MicAudioSource | null>(null);
  const micWired = useRef(false);
  if (!micRef.current && typeof window !== "undefined") micRef.current = new MicAudioSource();

  // Load deck for this session.
  useEffect(() => {
    const deckId = sessionStorage.getItem(`slidr.session.${sessionId}`);
    (async () => {
      if (mock) {
        const d = getMockDeck(deckId || "deck_demo");
        setDeck(d ? await hydrateDeck(d) : d);
        return;
      }
      try {
        if (deckId) setDeck(await hydrateDeck(await api.getDeck(deckId)));
        return;
      } catch { /* fall through to cache */ }
      if (deckId) {
        const cached = readCachedDeck(deckId);
        if (cached) setDeck(await hydrateDeck(cached));
      }
    })();
  }, [sessionId, mock]);

  // Connect hub client once the deck is known (mock needs it; socket doesn't).
  useEffect(() => {
    if (mock && !deck) return;
    const client: HubClient = mock
      ? new FakeHub(sessionId, deck as Deck, "presenter")
      : new PilotSocket(sessionId, "presenter");
    clientRef.current = client;
    let prev: SessionState | null = null;
    client.onState((s) => {
      const derived = !mock && prev ? deriveDecision(prev, s) : null;
      prev = s;
      setState(s);
      setHubError(null);
      if (derived) setLastDecision(derived);
    });
    client.onStatus((s) => setStatus(s));
    client.onTranscript((t) => {
      if (t.final) {
        setInterim("");
        setTranscripts((prev) => [...prev.slice(-11), t]);
      } else setInterim(t.text);
    });
    client.onDecision((d) => setLastDecision(d));
    client.onHealth((h) => setHealth(h));
    client.onErrorMsg((e) => setHubError({ code: e.code, message: e.message }));
    client.connect();
    return () => { client.disconnect(); clientRef.current = null; };
  }, [sessionId, mock, deck]);

  // Mock: mirror state to the audience window over BroadcastChannel.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!mock || !state) return;
    const bc = new BroadcastChannel(`slidr.${sessionId}`);
    bc.postMessage({ kind: "state", state });
    bc.close();
  }, [mock, sessionId, state]);

  // Real hub: it exposes latency stats over HTTP /health (no WS health frame).
  useEffect(() => {
    if (mock) return;
    let stop = false;
    const poll = async () => {
      try {
        const h = await api.health();
        if (!stop) {
          setHealth({
            asrStatus: "unknown",
            modelLatencyP50Ms: h.p50 ?? null,
            modelLatencyP95Ms: h.p95 ?? null,
            fallbackInUse: false,
            decisions: h.decisions,
          });
        }
      } catch { /* hub down: keep the last reading */ }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [mock]);

  // Mock: answer late audience windows asking for the current state.
  useEffect(() => {
    if (!mock) return;
    const bc = new BroadcastChannel(`slidr.${sessionId}`);
    bc.onmessage = (ev: MessageEvent<{ kind?: string }>) => {
      if (ev.data?.kind === "hello" && stateRef.current) {
        bc.postMessage({ kind: "state", state: stateRef.current });
      }
    };
    return () => bc.close();
  }, [mock, sessionId]);

  // Timer.
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => clearInterval(t);
  }, []);

  // Mic device list (+ remember last choice).
  useEffect(() => {
    MicAudioSource.devices().then((ds) => {
      setDevices(ds);
      const saved = localStorage.getItem("slidr.mic");
      if (saved && ds.some((d) => d.deviceId === saved)) setDeviceId(saved);
      else if (ds[0]) setDeviceId(ds[0].deviceId);
    }).catch(() => undefined);
    const onChange = () => {
      MicAudioSource.devices().then(setDevices).catch(() => undefined);
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  const toggleMic = useCallback(async () => {
    const mic = micRef.current;
    const client = clientRef.current;
    if (!mic || micStarting) return;
    if (micOn) {
      await mic.stop();
      client?.stopAudio();
      setMicOn(false);
      setLevel(0);
      return;
    }
    setMicWarn(null);
    setMicStarting(true);
    try {
      if (!micWired.current) {
        micWired.current = true;
        mic.onFrame((buf) => clientRef.current?.sendAudioFrame(buf));
        mic.onLevel((l) => setLevel(l));
        mic.onLost(() => setMicWarn("Microphone lost or silent — check the input, then restart the mic."));
      }
      await mic.start(deviceId || undefined);
      if (deviceId) localStorage.setItem("slidr.mic", deviceId);
      // Labels only appear after permission is granted — refresh the list.
      try {
        const fresh = await MicAudioSource.devices();
        if (fresh.length > 0) {
          setDevices(fresh);
          if (!fresh.some((d) => d.deviceId === deviceId) && fresh[0]) {
            setDeviceId(fresh[0].deviceId);
          }
        }
      } catch { /* keep existing list */ }
      client?.startAudio(16000, 1);
      setMicOn(true);
    } catch {
      setMicWarn("Microphone blocked — click the lock icon, allow the mic, and use localhost or HTTPS.");
    } finally {
      setMicStarting(false);
    }
  }, [micOn, micStarting, deviceId]);

  const switchDevice = useCallback(async (id: string) => {
    setDeviceId(id);
    localStorage.setItem("slidr.mic", id);
    if (micRef.current?.running) {
      try {
        await micRef.current.start(id);
      } catch {
        setMicWarn("Could not switch input mid-session — try restarting the mic.");
      }
    }
  }, []);

  const cmd = useCallback((name: "next" | "back" | "goto" | "undo" | "pause" | "resume" | "setMode" | "clearEffect" | "hold", args: Record<string, unknown> = {}) => {
    clientRef.current?.sendCmd(name, args);
  }, []);

  const cycleMode = useCallback(() => {
    const order: Mode[] = ["auto", "assist", "manual"];
    const cur = state?.mode ?? "auto";
    cmd("setMode", { mode: order[(order.indexOf(cur) + 1) % order.length] });
  }, [state?.mode, cmd]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown": e.preventDefault(); cmd("next"); break;
        case "ArrowLeft":
        case "ArrowUp": e.preventDefault(); cmd("back"); break;
        case " ": e.preventDefault(); cmd("pause"); break; // kill switch
        case "u": case "U": cmd("undo"); break;
        case "m": case "M": cycleMode(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmd, cycleMode]);

  const offline = status === "reconnecting" || status === "closed";
  const slide = deck && state ? deck.slides[state.slideIndex] : null;
  const nextSlide = deck && state ? deck.slides[state.slideIndex + 1] ?? null : null;
  const displayMode: Mode = offline ? "manual" : (state?.mode ?? "auto");

  const openAudience = useCallback(async () => {
    setDisplayNote(null);
    const w = await openAudienceWindow(sessionId, mock);
    if (!w) setDisplayNote("Popup blocked — allow popups for this site and try again.");
  }, [sessionId, mock]);

  const detectScreens = useCallback(async () => {
    const list = await getScreens();
    setScreens(list ?? "denied");
  }, []);

  const moveToProjector = useCallback(async () => {
    setDisplayNote(null);
    // Same window name reuses the already-open display window.
    const w = await openAudienceWindow(sessionId, mock);
    if (!w) {
      setDisplayNote("Popup blocked — allow popups for this site and try again.");
      return;
    }
    const moved = await placeDisplay(w);
    setDisplayNote(
      moved
        ? "Display sent to the projector — click Go fullscreen in that window."
        : "Could not reach a second screen — drag the display window onto the projector, then Go fullscreen."
    );
  }, [sessionId, mock]);

  return (
    <main className="min-h-screen bg-dots-faint pb-16">
      <div className="border-b-2 border-ink bg-ink bg-dots-light text-white">
        <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${status === "open" ? "bg-green-400" : "bg-spot live-dot"}`} title={status} />
            <div>
              <h1 className="text-xl font-black tracking-tight">Presenter view</h1>
              <p className="font-mono text-xs text-neutral-300">
                session {sessionId} · {deck?.title ?? "loading…"} · {status}
                {mock ? " · mock hub" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="border-2 border-white/70 px-3 py-1 font-mono text-2xl font-bold tabular-nums">{fmtTime(elapsed)}</span>
            <button onClick={openAudience} title="Open the projector display in a new window, then drag it to the projector" className="btn-spot">
              Open audience window
            </button>
          </div>
        </header>
        <div className="bg-hash h-2 w-full opacity-40" aria-hidden />
      </div>
      <div className="mx-auto max-w-6xl px-6">

      {offline && (
        <p className="mt-4 border-2 border-ink bg-amber-100 p-3 text-sm font-medium">
          Connection lost — audience holds the last slide, you are in Manual. Reconnecting… keyboard still works.
        </p>
      )}
      {state?.holdForQuestions && (
        <p className="mt-4 border-2 border-ink bg-sky-100 p-3 text-sm font-medium">
          Holding for questions — auto-advance paused. Press Resume to continue.
        </p>
      )}
      {hubError && (
        <p className="mt-4 border-2 border-ink bg-red-100 p-3 text-sm font-medium">
          Hub error {hubError.code}: {hubError.message}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Live slide + next preview */}
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div>
              <p className="mb-1 font-mono text-xs uppercase tracking-wide text-neutral-500">
                Live · slide {(state?.slideIndex ?? 0) + 1}{state?.paused ? " · paused" : ""}
              </p>
              {slide ? (
                <SlideView slide={slide} effects={state?.effects ?? []} className="w-full border-2 border-ink shadow-hard" />
              ) : (
                <div className="border-2 border-ink bg-white bg-dots-faint p-10 text-sm text-neutral-500">Waiting for state…</div>
              )}
            </div>
            <div>
              <p className="mb-1 font-mono text-xs uppercase tracking-wide text-neutral-500">Next</p>
              {nextSlide ? (
                <button
                  onClick={() => cmd("next")}
                  title="Click to advance to this slide"
                  className="block w-full text-left transition-transform hover:-translate-y-0.5"
                >
                  <SlideView slide={nextSlide} className="w-full border-2 border-ink opacity-95" />
                </button>
              ) : (
                <div className="border-2 border-dashed border-ink bg-white p-6 text-xs text-neutral-500">Last slide</div>
              )}
            </div>
          </div>

          {/* Transport */}
          <div className="panel-pop flex flex-wrap items-center gap-2 p-3 shadow-hard-sm">
            <button onClick={() => cmd("back")} title="Previous slide (←)" className="btn-paper">← Back</button>
            <button onClick={() => cmd("next")} title="Next slide (→)" className="btn-paper">Next →</button>
            <button onClick={() => cmd("undo")} title="Undo the last action (U)" className="btn-paper">Undo (U)</button>
            {state?.paused ? (
              <button onClick={() => cmd("resume")} title="Resume the voice engine" className="btn-paper !text-green-700">Resume</button>
            ) : (
              <button onClick={() => cmd("pause")} title="Kill switch: stop the model instantly (Space)" className="btn-paper !text-red-700">Stop model (Space)</button>
            )}
            <button onClick={() => cmd("clearEffect")} title="Clear all highlights, zooms and link cards" className="btn-paper">Clear effects</button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(gotoIdx, 10);
                if (Number.isFinite(n) && deck) {
                  cmd("goto", { index: Math.max(0, Math.min(deck.slides.length - 1, n - 1)) });
                }
                setGotoIdx("");
              }}
              className="flex items-center gap-1"
              title="Jump to a slide number"
            >
              <input
                value={gotoIdx}
                onChange={(e) => setGotoIdx(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="#"
                aria-label="Go to slide number"
                className="w-12 border-2 border-ink bg-white px-2 py-1.5 text-center font-mono text-sm font-bold outline-none focus:bg-amber-50"
              />
              <button type="submit" className="btn-paper" title="Jump to slide number">Go</button>
            </form>
            <div className="tab-strip ml-auto" role="group" aria-label="Mode">
              {(["auto", "assist", "manual"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => cmd("setMode", { mode: m })}
                  title={m === "auto" ? "Auto: voice actions apply immediately" : m === "assist" ? "Assist: suggestions wait for your tap" : "Manual: voice off, buttons and keys only (M to cycle)"}
                  className={`px-3 py-1 text-sm font-bold ${displayMode === m ? "bg-ink text-white" : "hover:bg-amber-50"}`}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {state?.pending && (
            <div className="border-2 border-ink bg-sky-100 p-3 shadow-hard-sm">
              <p className="text-sm"><strong>Suggestion:</strong> {state.pending.action} → {state.pending.targetId ?? "—"} ({Math.round(state.pending.confidence * 100)}%)</p>
              <p className="text-xs text-neutral-600">{state.pending.reason}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => clientRef.current?.acceptSuggestion(state.pending!.id)} className="btn-ink px-3 py-1">Accept</button>
                <button onClick={() => clientRef.current?.dismissSuggestion(state.pending!.id)} className="btn-paper px-3 py-1">Dismiss</button>
              </div>
            </div>
          )}

          {/* Transcript */}
          <section className="panel-pop shadow-hard-sm">
            <h2 className="border-b-2 border-ink bg-dots-faint px-3 py-2 text-sm font-black">Live transcript</h2>
            <div className="h-44 space-y-1 overflow-y-auto p-3 text-sm">
              {transcripts.map((t, i) => (
                <p key={`${t.ts}-${i}`}><span className="font-mono text-[11px] text-neutral-400">{new Date(t.ts).toLocaleTimeString()} </span>{t.text}</p>
              ))}
              {interim && <p className="text-neutral-400">{interim} …</p>}
              {transcripts.length === 0 && !interim && <p className="text-neutral-500">Speak and the transcript appears here.</p>}
            </div>
          </section>

          {mock && (
            <section className="border-2 border-dashed border-ink bg-white p-3">
              <h2 className="text-sm font-black">Mock speech <span className="font-mono text-xs font-normal text-neutral-500">(rehearse without a mic)</span></h2>
              <div className="mt-2 flex gap-2">
                <input
                  value={scriptLine}
                  onChange={(e) => setScriptLine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && scriptLine.trim()) {
                      (clientRef.current as FakeHub | null)?.script(scriptLine.trim());
                      setScriptLine("");
                    }
                  }}
                  placeholder='Try: "62 percent of teams" · "next slide" · "zoom in on the chart"'
                  className="input-pop"
                />
                <button
                  onClick={() => {
                    if (scriptLine.trim()) {
                      (clientRef.current as FakeHub | null)?.script(scriptLine.trim());
                      setScriptLine("");
                    }
                  }}
                  className="btn-paper shrink-0"
                >
                  Send
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          {/* Mic */}
          <section className="card-pop p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black">Microphone</h2>
              {micOn
                ? <span className="chip-ink !bg-moss !border-moss"><span className="live-dot mr-1 inline-block h-2 w-2 rounded-full bg-white align-middle" />live</span>
                : <span className="chip-paper">off</span>}
            </div>
            <select
              value={deviceId}
              onChange={(e) => void switchDevice(e.target.value)}
              className="input-pop mt-2"
              title="Pick any input the browser sees: laptop mic, USB mic, wireless receiver, mixer feed"
            >
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
              {devices.length === 0 && <option value="">Default input</option>}
            </select>
            <div className="mt-2 h-3 w-full border-2 border-ink bg-white p-[1px]" title="Live input level — speak and this bar should dance">
              <div className={`h-full transition-[width] ${micOn ? "bg-moss" : "bg-ink"}`} style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <button
              onClick={() => void toggleMic()}
              disabled={micStarting}
              title={micOn ? "Stop capturing audio" : "Start capturing — your browser will ask for mic permission"}
              className={`mt-3 w-full ${micOn ? "btn-paper !text-red-700" : "btn-ink"}`}
            >
              {micStarting ? "Starting…" : micOn ? "● Listening — stop" : "○ Start mic"}
            </button>
            {!micOn && !micWarn && (
              <p className="mt-2 text-xs text-neutral-600">Your browser will ask for permission on the first click. A USB or lapel mic is just another entry above.</p>
            )}
            {micWarn && <p className="mt-2 border-2 border-ink bg-amber-100 p-2 text-xs font-medium">{micWarn}</p>}
            <p className="mt-2 font-mono text-[11px] text-neutral-500">16 kHz mono PCM16 → hub → Muse Voice Transcribe</p>
          </section>

          {/* Display */}
          <section className="card-pop p-3">
            <h2 className="text-sm font-black">Display</h2>
            <p className="mt-1 font-mono text-[11px] text-neutral-500">
              {screens === null && "Projector setup not checked yet."}
              {screens === "denied" && "Screen access unavailable — drag the window by hand."}
              {Array.isArray(screens) && screens.length <= 1 && "One screen — Duplicate mode, or no projector. Fullscreen the display on this screen."}
              {Array.isArray(screens) && screens.length > 1 && `${screens.length} screens — Extend mode. Send the display to the projector.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => void detectScreens()} title="Ask the browser how many screens are connected" className="btn-paper px-2 py-1 text-xs">Detect screens</button>
              <button onClick={() => void moveToProjector()} title="Open the display window and move it to the projector screen" className="btn-paper px-2 py-1 text-xs">Send to projector</button>
            </div>
            {displayNote && <p className="mt-2 border-2 border-ink bg-amber-100 p-2 text-xs font-medium">{displayNote}</p>}
            <p className="mt-2 text-xs text-neutral-600">
              Duplicate: Go fullscreen on this screen — the projector mirrors it.
              Extend: send the display over first, then Go fullscreen there.
            </p>
          </section>

          {/* Last action */}
          <section className="card-pop p-3">
            <h2 className="text-sm font-black">Last action</h2>
            {lastDecision ? (
              <div className="mt-2 text-sm">
                <p><strong>{lastDecision.action}</strong> → {lastDecision.target ?? lastDecision.targetId ?? "—"}</p>
                <p className="text-neutral-600">{lastDecision.reason}</p>
                <p className="mt-1 font-mono text-[11px] text-neutral-500">
                  conf {lastDecision.confidence == null ? "—" : lastDecision.confidence.toFixed(2)} · {lastDecision.path} · {lastDecision.latencyMs} ms · {lastDecision.applied ? "applied" : "ignored"}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">No decisions yet.</p>
            )}
            {health && (
              <p className="mt-2 border-t border-neutral-200 pt-2 font-mono text-[11px] text-neutral-500">
                asr {health.asrStatus ?? health.asr ?? "?"} · p50 {health.modelLatencyP50Ms ?? health.p50 ?? "?"} ms · p95 {health.modelLatencyP95Ms ?? health.p95 ?? "?"} ms{(health.fallbackInUse ?? health.fallback) ? " · FALLBACK" : ""}{health.decisions != null ? ` · ${health.decisions} decisions` : ""}
              </p>
            )}
          </section>

          <section className="panel-pop bg-dots-faint p-3 text-xs text-neutral-600">
            <h2 className="text-sm font-black text-neutral-900">Keys</h2>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
              <li>←/→ slides · Space stop model</li>
              <li>U undo · M mode</li>
            </ul>
          </section>
        </aside>
      </div>
      </div>
    </main>
  );
}
