import Link from "next/link";
import { Logo } from "../components/Logo";

export default function LandingPage({ searchParams }: { searchParams: { mock?: string } }) {
  const mockSuffix = searchParams?.mock !== undefined ? "?mock=1" : "";
  const libraryHref = `/library${mockSuffix}`;

  return (
    <main className="min-h-screen bg-dots-faint">
      {/* Top bar */}
      <div className="border-b-2 border-ink bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <Logo size={40} />
          <span className="text-xl font-black tracking-tight">slidr</span>
          <Link href={libraryHref} className="btn-ink ml-auto !px-3 !py-1.5" title="Open your deck library">
            Start presenting →
          </Link>
        </div>
        <div className="bg-hash h-3 w-full" aria-hidden />
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-16">
        {/* Hero */}
        <section className="mt-10 grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight">
              Your slides,
              <br />
              listening.
            </h1>
            <p className="mt-4 max-w-md text-lg text-neutral-700">
              slidr drives your deck from your voice. Say the number and the
              figure glows. Mention the chart and it zooms. Finish the point
              and the slide advances.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link
                href={libraryHref}
                title="Upload a deck and start a live session"
                className="btn-spot !px-8 !py-3 !text-lg"
              >
                Start presenting →
              </Link>
              <Link href={`${libraryHref}#how`} className="font-bold underline underline-offset-4">
                How it works
              </Link>
            </div>
            <p className="mt-4 font-mono text-xs text-neutral-500">
              No clicker. No “next slide please”. Just you talking.
            </p>
          </div>

          {/* Talking slide sketch */}
          <div className="card-pop rotate-1 p-5" aria-hidden>
            <div className="border-2 border-ink bg-white p-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-neutral-500">slide 3 · revenue</p>
              <div className="mt-2 flex h-28 items-end gap-2 border-b-2 border-ink pb-0">
                {[35, 55, 45, 80].map((h, i) => (
                  <div
                    key={i}
                    className={`w-full border-2 border-b-0 border-ink ${i === 3 ? "bg-spot" : "bg-dots-faint bg-white"}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <p className="mt-3 border-2 border-ink bg-ink px-2 py-1 font-mono text-xs text-white">
                “revenue doubled in Q4” → <span className="font-bold text-spot">zoom ×2</span>
              </p>
            </div>
          </div>
        </section>

        {/* Steps */}
        <section id="how" className="mt-14 scroll-mt-6">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight">Three steps to showtime</h2>
            <div className="bg-hash-faint h-4 flex-1" aria-hidden />
          </div>
          <ol className="mt-6 grid gap-5 md:grid-cols-3">
            {[
              { n: "01", t: "Upload your deck", d: "Drop in a PPTX or PDF. Every slide is converted and the AI maps each figure, chart, image and link." },
              { n: "02", t: "Review the boxes", d: "See exactly what the AI found. Drag a box, rename it, teach it your words — then hit Present." },
              { n: "03", t: "Just talk", d: "Your voice drives the show: highlights, zooms, links and slide changes, live on the projector." },
            ].map((s) => (
              <li key={s.n} className="card-pop bg-white p-5">
                <span className="bg-dots inline-block border-2 border-ink px-2 py-0.5 font-mono text-sm font-black">{s.n}</span>
                <h3 className="mt-3 text-lg font-black">{s.t}</h3>
                <p className="mt-1 text-sm text-neutral-700">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Voice commands */}
        <section className="card-pop mt-10 bg-ink p-6 text-white">
          <h2 className="text-2xl font-black tracking-tight">Say it, see it</h2>
          <ul className="mt-4 space-y-2 font-mono text-sm">
            {[
              ["“Sixty-two percent of teams…”", "the figure glows"],
              ["“Zoom in on the chart”", "eased zoom, back in 8 seconds"],
              ["“Open the demo”", "link card, no tab chaos"],
              ["“Any questions?”", "auto-advance holds for Q&A"],
              ["Spacebar", "kill switch — the model stops instantly"],
            ].map(([say, does]) => (
              <li key={say} className="flex flex-wrap items-baseline gap-x-3 border-b border-white/15 pb-2">
                <span className="font-bold text-spot">{say}</span>
                <span className="text-neutral-300">→ {does}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href={libraryHref} title="Upload a deck and start a live session" className="btn-spot">
              Start presenting →
            </Link>
            <span className="font-mono text-xs text-neutral-300">Auto · Assist · Manual — you stay in charge</span>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-4 font-mono text-xs text-neutral-500">
          <span className="font-black text-ink">slidr</span>
          <span>voice-driven presenting</span>
          <span className="ml-auto">speech → highlights → zooms → links</span>
        </footer>
      </div>
    </main>
  );
}
