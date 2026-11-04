"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Box, DeckElement, Effect, Slide } from "@slidr/shared";

function live(effects: Effect[]): Effect[] {
  const now = Date.now();
  return effects.filter((e) => e.expiresAt > now);
}

export function SlideView(props: {
  slide: Slide;
  effects?: Effect[];
  editable?: boolean;
  selectedId?: string | null;
  showBoxes?: boolean;
  onSelect?: (id: string | null) => void;
  onBoxChange?: (id: string, box: Box) => void;
  className?: string;
}) {
  const { slide, effects = [], editable = false, selectedId = null, showBoxes = false } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => { setImgOk(true); }, [slide.id, slide.imageUrl]);

  // Re-render while effects are live so expired ones clear even with no new state.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (effects.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [effects.length]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const active = live(effects);
  const zoom = active.find((e) => e.kind === "zoom");
  const highlights = active.filter((e) => e.kind === "highlight");
  const linkFx = active.find((e) => e.kind === "link");
  const byId = new Map(slide.elements.map((e) => [e.id, e]));

  // Eased zoom transform toward the target box.
  let transform = "none";
  if (zoom) {
    const el = byId.get(zoom.elementId);
    if (el) {
      const s = Math.min(1 / Math.max(el.box.w, 0.05), 1 / Math.max(el.box.h, 0.05), 3);
      const cx = (el.box.x + el.box.w / 2) * size.w;
      const cy = (el.box.y + el.box.h / 2) * size.h;
      transform = `translate(${size.w / 2 - s * cx}px, ${size.h / 2 - s * cy}px) scale(${s})`;
    }
  }

  const pct = (n: number) => `${n * 100}%`;

  const onPointerDown = (ev: React.PointerEvent, el: DeckElement) => {
    if (!editable) return;
    ev.stopPropagation();
    props.onSelect?.(el.id);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = (ev.clientX - rect.left) / rect.width - el.box.x;
    const startY = (ev.clientY - rect.top) / rect.height - el.box.y;
    setDrag({ id: el.id, dx: startX, dy: startY });
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (!editable || !drag) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const el = byId.get(drag.id);
    if (!el) return;
    const nx = Math.min(1 - el.box.w, Math.max(0, (ev.clientX - rect.left) / rect.width - drag.dx));
    const ny = Math.min(1 - el.box.h, Math.max(0, (ev.clientY - rect.top) / rect.height - drag.dy));
    props.onBoxChange?.(drag.id, { ...el.box, x: nx, y: ny });
  };

  const linkEl = linkFx ? byId.get(linkFx.elementId) : undefined;

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden bg-neutral-900 select-none ${props.className ?? ""}`}
      style={{ aspectRatio: `${slide.width} / ${slide.height}` }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
      onClick={() => editable && props.onSelect?.(null)}
    >
      <div className="slide-stage absolute inset-0" style={{ transform }}>
        {imgOk ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={slide.imageUrl}
            alt={slide.title}
            className="absolute inset-0 h-full w-full"
            draggable={false}
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="bg-dots-light absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-800 p-8 text-center">
            <p className="text-xl font-black text-white">{slide.title || "Slide image missing"}</p>
            <p className="max-w-sm font-mono text-xs text-neutral-300">
              The offline image for this slide is unavailable (browser storage was cleared). Re-upload the deck to restore it.
            </p>
          </div>
        )}
        {(showBoxes || editable) &&
          slide.elements.map((el) => (
            <div
              key={el.id}
              onPointerDown={(ev) => onPointerDown(ev, el)}
              className={`absolute border-2 ${
                selectedId === el.id ? "border-amber-500 bg-amber-400/10" : "border-sky-500/80 bg-sky-400/5"
              } ${editable ? "cursor-move" : "pointer-events-none"}`}
              style={{ left: pct(el.box.x), top: pct(el.box.y), width: pct(el.box.w), height: pct(el.box.h) }}
            >
              <span className="absolute -top-7 left-0 whitespace-nowrap border border-white/60 bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                {el.label}
              </span>
            </div>
          ))}
        {highlights.map((fx) => {
          const el = byId.get(fx.elementId);
          if (!el) return null;
          // Outline-only glow: the graph itself stays fully visible, never covered.
          return (
            <div
              key={fx.id}
              className="fx-highlight pointer-events-none absolute"
              style={{
                left: pct(el.box.x), top: pct(el.box.y), width: pct(el.box.w), height: pct(el.box.h),
                boxShadow: "0 0 0 3px #f5a623, 0 0 28px rgba(245,166,35,.75), 0 0 0 9999px rgba(8,10,12,.55)",
              }}
            >
              <span className="absolute -top-7 left-0 whitespace-nowrap border border-white/60 bg-spot px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink">
                {el.label}
              </span>
            </div>
          );
        })}
      </div>
      {linkEl?.url && (
        <div
          className="absolute bottom-4 right-4 max-w-xs border-2 border-white bg-neutral-900/95 p-4 text-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-spot">● Link</p>
          <p className="mt-1 text-sm font-medium">{linkEl.label}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-neutral-300">{linkEl.url}</p>
          <a
            href={linkEl.url}
            target="_blank"
            rel="noreferrer"
            title={`Open ${linkEl.url} in a new tab — the slides keep running here`}
            className="mt-3 inline-block border-2 border-white bg-spot px-3 py-1.5 text-sm font-black text-ink transition-transform hover:-translate-y-0.5"
          >
            Open link ↗
          </a>
          <p className="mt-2 font-mono text-[11px] text-neutral-400">Opens in a new tab · slides keep running here</p>
        </div>
      )}
    </div>
  );
}
