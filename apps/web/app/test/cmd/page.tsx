"use client";

import { useRef, useState } from "react";
import type { CmdName, SessionState } from "@stage-pilot/shared";
import { PilotSocket } from "../../../lib/ws";

const CMDS: CmdName[] = ["next", "back", "goto", "undo", "pause", "resume", "setMode", "clearEffect", "hold"];

/** Minimal scripted-cmd sender for Dev B hub testing. Not part of the demo. */
export default function CmdTestPage() {
  const [sessionId, setSessionId] = useState("TEST01");
  const [gotoIdx, setGotoIdx] = useState("2");
  const [mode, setMode] = useState("auto");
  const [log, setLog] = useState<string[]>([]);
  const sockRef = useRef<PilotSocket | null>(null);

  const push = (line: string) => setLog((prev) => [...prev.slice(-29), `${new Date().toLocaleTimeString()} ${line}`]);

  const connect = () => {
    sockRef.current?.disconnect();
    const sock = new PilotSocket(sessionId, "presenter");
    sockRef.current = sock;
    sock.onStatus((s) => push(`status=${s}`));
    sock.onState((s: SessionState) => push(`state v${s.stateVersion} slide=${s.slideIndex} mode=${s.mode} fx=${s.effects.length}`));
    sock.onTranscript((t) => push(`transcript final=${t.final} ${t.text.slice(0, 60)}`));
    sock.onDecision((d) => push(`decision ${d.action} conf=${d.confidence} applied=${d.applied}`));
    sock.onErrorMsg((e) => push(`error ${e.code} ${e.message}`));
    sock.connect();
    push(`connecting session=${sessionId}`);
  };

  const send = (name: CmdName) => {
    const args: Record<string, unknown> = {};
    if (name === "goto") args.index = Number(gotoIdx);
    if (name === "setMode") args.mode = mode;
    sockRef.current?.sendCmd(name, args);
    push(`→ cmd ${name} ${JSON.stringify(args)}`);
  };

  return (
    <main className="min-h-screen bg-dots-faint px-6 py-10">
      <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-black">Hub cmd test</h1>
      <p className="mt-1 font-mono text-xs text-neutral-500">Dev B: the hub listens on ws://localhost:8787 — click connect.</p>
      <div className="mt-4 flex gap-2">
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="input-pop font-mono" />
        <button onClick={connect} className="btn-ink shrink-0">Connect</button>
        <button onClick={() => sockRef.current?.disconnect()} className="btn-paper shrink-0">Disconnect</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CMDS.map((c) => (
          <button key={c} onClick={() => send(c)} className="btn-paper font-mono">{c}</button>
        ))}
      </div>
      <div className="mt-3 flex gap-3 text-sm">
        <label className="font-bold">goto index <input value={gotoIdx} onChange={(e) => setGotoIdx(e.target.value)} className="input-pop ml-1 !w-16 font-mono" /></label>
        <label className="font-bold">mode
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="input-pop ml-1 !w-auto font-mono">
            <option value="auto">auto</option>
            <option value="assist">assist</option>
            <option value="manual">manual</option>
          </select>
        </label>
      </div>
      <pre className="mt-4 h-80 overflow-y-auto border-2 border-ink bg-white p-3 font-mono text-xs shadow-hard-sm">{log.join("\n") || "log…"}</pre>
      </div>
    </main>
  );
}
