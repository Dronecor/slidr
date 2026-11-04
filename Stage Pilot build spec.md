# Stage Pilot: build spec

Nov 4, 2026 · @king · Anything marked **Verify** is unconfirmed; test it in the first hour.

Stage Pilot is a web app that shows your deck on the projector and drives it from your voice: it highlights figures, zooms images, opens links and changes slides when your speech says it is time. This spec fixes the architecture, providers, contracts, two-person split and schedule for the Meta hackathon.

## Decisions

- **Web app, not an extension.** Google Slides and PowerPoint Online draw slides on a canvas, so an extension cannot address one chart or figure inside them. In your own renderer every element has a box you can highlight, zoom or click.
- **Upload, then present from Stage Pilot.** You upload a PPTX or PDF in the app; each slide becomes an image plus a map of its elements. Present opens an audience window you drag onto the projector over HDMI, the way you would with PowerPoint. Driving the real PowerPoint or Slides window is out of scope; the Chrome extension is the "what's next" line of your pitch.
- **The laptop mic is the input.** Speech comes from the laptop's microphone, or any input the browser lists (USB mic, wireless receiver, sound card or mixer feed), chosen in the Presenter view. There is no phone in this build. The input sits behind one interface, so another source can be added later without touching the engine.
- **Runs on your laptop first, deployed later.** No server of your own is needed. For the demo, a small Node server runs on the laptop beside the web app. For the judges' link, the same code deploys to one host that supports WebSockets (Render, Railway or Fly.io are candidates; see Running it).
- **Deadline.** A third-party listing gives project submission as 5 Nov 2026, 6:30 AM IST, which is about 02:00 Lagos time tonight. Your 4-hour cap (23:20) leaves roughly 2.5 hours of buffer. Confirm the time on the official Meta hackathon page now, because this listing is not Meta's.
- **Meta stack end to end.** Credits cover the Meta Model API ($150 per selected participant): Muse Voice Transcribe for live speech, Muse Spark 1.3 for slide vision, intent decisions and structured output. Judges see Meta models doing every AI job.
- **Quality bar.** Every demo-critical path (upload, review, highlight, zoom, auto-advance, manual override, present on a projector) is built properly. Link opening and SAM-based image targeting sit behind interfaces so they can ship late without breaking anything.

## Screens and setup

Stage Pilot is one web app with four screens, plus a small Node server that holds the Meta API key and runs the AI logic. You work in the main window; clicking Present opens a second window for the audience.

| Screen | Where it runs | What it is for |
| --- | --- | --- |
| Library | Laptop, main window | Open the app, upload a PPTX or PDF, see your decks, watch processing progress, open a deck. |
| Review | Laptop, main window | Each slide with the AI's boxes drawn on it. Drag, rename, delete or add elements, then click Present. |
| Presenter view | Laptop, main window, after Present | Your private screen: mic picker with level meter, live transcript, last action with its reason and confidence, Auto, Assist and Manual switch, undo, next-slide preview, timer. Like PowerPoint's Presenter View. |
| Audience window | Opens on Present; drag it to the projector, fullscreen | The slide and its effects only. No cursor, no menus. |

- **Choosing the mic.** The Presenter view lists the browser's audio inputs, remembers the last choice, shows a live level meter, and warns if the input disappears or goes silent for more than a few seconds. A USB or wireless lapel mic, or a sound-card feed, is just another entry in the list.
- **Mic permission.** Browsers allow microphone capture only on HTTPS or localhost. Running on the laptop uses localhost; the deployed host provides HTTPS.
- **Placing the audience window.** Use the browser's Window Management API to open it straight on the external screen; fall back to window.open, drag, then fullscreen.
- **Staying in sync.** Both windows connect to the server over a WebSocket. The server holds the current slide and effects, so the audience window always shows what the Presenter view says.
- **Echo and Q&A.** Keep laptop speakers muted, since sound from a video would be transcribed as you. Audience questions are also picked up; the hold-on-questions rule stops the deck reacting to them.
- **Bad venue wifi.** Bring a phone hotspot for the laptop; speech and AI calls need the internet. The deck is cached in the browser, so if the network drops the audience window keeps its slide, the Presenter view flips to Manual, and keyboard control still works.
- **No phone.** A phone mic and phone remote are not part of this build. If a clicker is wanted later, it is a small page of next, back, undo and pause buttons.

## Providers

The Meta Model API base is `https://api.meta.ai/v1` with a Bearer key, and it accepts OpenAI chat completions, Responses and Anthropic-style Messages requests, so any standard SDK works.

| Job | Provider and model | Why | Verify before building |
| --- | --- | --- | --- |
| Live speech to text | Muse Voice Transcribe, `muse-voice-transcribe-1.0`, `wss://api.meta.ai/v1/asr/realtime` (docs via Pipecat) | Streaming transcripts with interim and final frames, endpointing, code-switching, $0.18 per audio hour | Audio format and sample rate (integrations send PCM16 frames); accuracy on your accent |
| Slide vision, intent decisions, structured output | Muse Spark 1.3, `muse-spark-1.3` (capabilities) | Image and PDF input, JSON-schema output, tool calling | Round-trip latency at minimal reasoning; exact `reasoning_effort` values for 1.3 |
| Photo-region targeting (stretch) | SAM 3.1 on the Model API | Lets "the person on the left" zoom to the right pixels | Endpoint and request shape, not yet confirmed |
| Backup speech | Browser Web Speech API | Free, zero setup, saves the demo if the Meta socket fails | Chrome only, weaker accuracy |
| Deck conversion | LibreOffice headless, then pdf.js or pdfium | PPTX to PDF to one PNG per slide | LibreOffice installed on your laptop and on the deploy host; fonts installed |
| Decks and images | Supabase Storage and Postgres | Fast to stand up | Public bucket for slide PNGs; or store files on the server's disk for the laptop demo |
| Realtime server | Node with `ws`. On your laptop for the demo; later one host that supports WebSockets (Render, Railway or Fly.io) | WebSockets and long-lived audio do not suit Vercel-style serverless | Current free tiers, whether the instance sleeps, and whether LibreOffice can run there |

- **Keep audio away from Muse Spark.** The OpenRouter listing says audio understanding in Spark 1.3 is not fully supported; Voice Transcribe handles all audio.
- **Relay audio through your server.** Browsers cannot set an Authorization header on a WebSocket, and the API key must never ship to a client.
- **Skip the Contributor tier for private decks.** It stretches credits much further but uses prompts to improve Meta's products.
- **No embeddings model.** None turned up in the Meta offering, so slide matching uses BM25 and fuzzy phrase matching locally, which is faster anyway.

## Deck ingestion

An upload becomes a presentable deck in about a minute, and every step is cached so presenting never waits on analysis.

1. **Upload** a PPTX or PDF in the Library and keep the original.
2. **Convert** PPTX to PDF with LibreOffice headless, then render one PNG per slide at 1920 px wide into Supabase Storage.
3. **Extract structure.** From a PPTX, read shape positions, pictures, chart XML and hyperlinks directly for exact boxes. From a PDF, use pdf.js text positions and link annotations.
4. **Vision pass.** Send each slide PNG plus its extracted text to Muse Spark and ask for an element list as JSON: type, short label, box normalised to 0 to 1, and spoken aliases ("revenue chart", "the 62 percent figure"). Where step 3 gave exact boxes, snap the model's boxes to them.
5. **Narrative pass.** One call over all slide summaries returns key points per slide, a one-line summary, the cue that signals the move to the next slide, and trigger phrases.
6. **Review screen.** The Review page draws every box over its slide. You can drag, rename, delete or add elements before going live, which also gives judges a visible look at the AI's output.
7. **Index.** Build a local BM25 index of key points and speaker notes per slide for the live matcher. Speaker notes, when present, are treated as your script and weighted highest.

- **Google Slides link (stretch).** Pasting a link to a link-shared deck and fetching it as PPTX would remove the manual export step. Not yet tested, so it ships only if time allows.
- **Charts that arrive as images.** The model gives one box for the whole chart plus approximate boxes for labelled parts such as a single bar. Cap at 12 elements per slide to keep decisions fast.

## Intent engine

Two paths read the same rolling transcript, and the target is under 1.5 s from spoken word to on-screen effect.

- **Fast path (under 50 ms, no model).** A command grammar on interim text: "next slide", "go back", "go to slide 4", "zoom in on the chart" (matched against element aliases), "pause", "resume", "undo". It fires immediately.
- **Semantic path.** Runs when Voice Transcribe emits a final segment, or when interim text has been stable for about 1.2 s. One Muse Spark call with structured output, minimal reasoning, temperature 0 and a small output cap. The static prefix (rules, schema, deck summary) is cacheable; the dynamic part is the current slide's elements and key points with covered flags, the next slide's title and cue, the last \~20 s of transcript and the last three actions.
- **Fusion.** The local BM25 score of the transcript against the current slide's key points runs beside the model. If the two disagree on advancing, the engine does nothing.

| Action | Minimum confidence | Rule |
| --- | --- | --- |
| Highlight | 0.60 | Same target not re-fired for 8 s; clears after 6 s or when you move to another element |
| Zoom | 0.70 | One at a time; returns to full slide after 8 s |
| Open link | 0.90 | Only on an explicit cue such as "open the demo"; shown in an overlay card, not a new tab |
| Next slide (inferred) | 0.85 | At least 70% of key points covered, or a transition cue heard; never skips more than one slide |
| Next slide (spoken) | none | Fires immediately |
| Previous slide | none | Spoken or manual only, never automatic |

- **Hold on questions.** Phrases like "any questions" or "let's take questions" freeze auto-advance until you resume.
- **Three modes.** Auto executes; Assist shows the suggestion in the Presenter view for one tap; Manual turns the model off and keeps only buttons and keys.
- **Undo and kill switch.** Space stops the model instantly; undo reverts the last action.
- **Latency is unverified.** Launch coverage reports a final transcript about 0.16 s after you stop speaking. Measure it yourself with your voice and log every decision with its latency.
- **Replay harness.** A script that feeds a timestamped transcript through the engine and prints actions against expected ones lets Dev B tune thresholds without speaking aloud for an hour.

## Architecture map

One repo, two deployable parts (web app and server) and one shared package.

```
stage-pilot/
  apps/web        Next.js + Tailwind. Pages: Library, Review, Presenter, Audience
  apps/hub        Node + ws. Session state, audio relay, intent engine, ingestion worker
  packages/shared zod schemas and TypeScript types for every contract below
  tools/replay    transcript replay harness for tuning thresholds
  .env.example    Meta API key, Supabase keys
```

Data flow, in order:

1. The Presenter view captures the mic and sends PCM16 frames over a WebSocket to the hub.
2. The hub relays frames to Muse Voice Transcribe and receives interim and final transcripts.
3. The hub writes transcripts into a rolling buffer and runs the fast path on interim text, the semantic path on final or stable text.
4. The hub applies the confidence rules, updates session state and broadcasts it.
5. The Audience window renders state. The Presenter view shows state plus the reasoning.

The hub is the Node server. It is the only component that holds the Meta API key and the only writer of session state. The windows send commands, never state.

## Running it

- **Demo day: everything on your laptop.** One command starts the web app and the hub. Open the Library at localhost, upload, click Present. The Meta API key sits in a `.env` file and never reaches the browser. Only the Meta API calls and deck storage need the internet.
- **Judges' link: deploy later.** The same code goes to one host that allows long-lived WebSocket connections, because live audio does not suit Vercel-style serverless hosting. Render, Railway and Fly.io are candidates; **Verify** current free tiers, whether the instance sleeps (a sleeping instance would break a live demo), and whether LibreOffice can run there. The host provides HTTPS.
- **If the host cannot run LibreOffice,** convert on your laptop and upload the slide PNGs, or accept PDF uploads only on the hosted version.
- **No VPS, no Caddy.** Nothing in this build needs a server you manage.

## Contracts

All shapes live in `packages/shared` as zod schemas. Both devs import them; neither redefines them. Change a schema only by agreeing in chat first and bumping `v`.

### Deck

```json
{
  "id": "deck_01",
  "title": "Q3 Investor Update",
  "status": "processing | review | ready | failed",
  "slides": [
    {
      "id": "s1",
      "index": 0,
      "imageUrl": "https://.../s1.png",
      "width": 1920,
      "height": 1080,
      "title": "The problem",
      "notes": "Speaker notes if present",
      "summary": "One line",
      "keyPoints": [{ "id": "s1k1", "text": "62 percent of teams lose time", "weight": 1 }],
      "nextCue": "which brings me to our solution",
      "triggerPhrases": ["moving on to the solution"],
      "elements": [
        {
          "id": "s1e1",
          "type": "figure | chart | image | link | text | chart_part",
          "label": "62 percent stat",
          "box": { "x": 0.12, "y": 0.3, "w": 0.4, "h": 0.25 },
          "aliases": ["the 62 percent figure", "that number"],
          "url": null,
          "parentId": null,
          "source": "pptx | pdf | model | user"
        }
      ]
    }
  ]
}
```

Rules: boxes are normalised 0 to 1 from the top left. At most 12 elements per slide. `parentId` links a bar to its chart. `source: user` marks review-screen edits, which the pipeline must never overwrite.

### Session state (hub to every client)

```json
{
  "sessionId": "ABCD12",
  "deckId": "deck_01",
  "slideIndex": 2,
  "mode": "auto | assist | manual",
  "paused": false,
  "holdForQuestions": false,
  "effects": [
    { "id": "fx9", "kind": "highlight | zoom | link", "elementId": "s3e2",
      "startedAt": 1762290000000, "expiresAt": 1762290006000 }
  ],
  "pending": null,
  "stateVersion": 41
}
```

`pending` holds the suggested action in Assist mode until a tap accepts or dismisses it. Clients render `effects` as given and drop any with `expiresAt` in the past. Display applies a state only if `stateVersion` is higher than the last one it saw.

### WebSocket envelope

Every message is JSON `{ "v": 1, "type": "...", "seq": 12, "payload": {} }`, except audio, which is binary PCM16 frames after an `audio.start` message.

| Direction | Type | Payload |
| --- | --- | --- |
| Window to hub | `join` | `sessionId`, `role` (audience or presenter) |
| Presenter to hub | `audio.start` / `audio.stop` | `sampleRate`, `channels` (verify the format Voice Transcribe wants) |
| Presenter to hub | `cmd` | `name`: next, back, goto, undo, pause, resume, setMode, clearEffect, hold; plus `args` |
| Presenter to hub | `suggestion.accept` / `suggestion.dismiss` | `pendingId` |
| Hub to both windows | `state` | full session state, sent on join and after every change |
| Hub to presenter | `transcript` | `text`, `final` (bool), `ts` |
| Hub to presenter | `decision` | action, target, confidence, reason, path (fast, semantic, fusion), `latencyMs`, `applied` (bool) |
| Hub to presenter | `health` | ASR socket status, model latency p50 and p95, fallback in use |
| Hub to both windows | `error` | `code`, `message`, `recoverable` |

Reconnect rule: clients retry with backoff of 0.5 s doubling to 5 s, and send `join` again; the hub answers with a full `state`. Display never blanks while reconnecting.

### Muse Spark decision output

The semantic path asks for this JSON schema and nothing else:

```json
{
  "action": "none | highlight | zoom | open_link | next",
  "targetId": "s3e2 or null",
  "confidence": 0.0,
  "coveredKeyPointIds": ["s3k1", "s3k2"],
  "reason": "One sentence the presenter can read in the Presenter view"
}
```

The hub validates with zod, rejects unknown `targetId` values, and treats any invalid or late response (over 1.2 s) as `none`. The model never sees the confidence table; the hub applies it.

### HTTP endpoints (hub)

| Endpoint | Purpose |
| --- | --- |
| `POST /decks` | Upload PPTX or PDF, returns `deckId`, starts ingestion |
| `GET /decks` | List decks for the Library |
| `GET /decks/:id` | Deck JSON and ingestion progress per step |
| `PUT /decks/:id/slides/:sid/elements` | Save Review page edits |
| `POST /sessions` | Called by Present: creates a session for a deck, returns `sessionId` for both windows |
| `GET /health` | Used by the host's health check |

### Interfaces for late features

```ts
interface LinkOpener { open(url: string): Promise<{ shown: boolean }> }
interface ImageTargeter { locate(slideId: string, phrase: string): Promise<Box | null> }
interface AudioSource { start(): Promise<void>; stop(): void; onFrame(cb: (pcm16: ArrayBuffer) => void): void }
```

Ship `LinkOpener` as an overlay card first. Ship `ImageTargeter` as a stub returning `null`, so a spoken target with no match falls back to highlighting the whole image element. SAM goes in later without changing callers.

### Storage

Supabase Postgres: `decks` (id, title, status, original\_path, json jsonb, created\_at). Slide PNGs in a public bucket at `decks/{deckId}/{slideIndex}.png`. The deck JSON is one jsonb column; no separate element tables are needed at this scale. Session state lives in hub memory only and is lost on restart by design.

## Two-person split

The split follows what people see versus what the system decides. Dev A builds the app you click and the screens the audience sees. Dev B builds the server, the speech and AI logic, and the deck processing. They meet at the contracts above.

### Dev A: the app you see

Owns `apps/web`.

- **Library:** upload form, deck list, per-step processing progress.
- **Review:** each slide with draggable, renamable boxes; add and delete elements; save; the Present button.
- **Presenter view:** mic picker with level meter, live transcript, last action with its reason and confidence, Auto, Assist and Manual switch, undo, next-slide preview, timer, keyboard shortcuts (arrows, Space as kill switch, U for undo, M for mode).
- **Audience window:** slide renderer, highlight (glow with dimmed surroundings), zoom (eased transform to the box), link overlay card, fullscreen, no cursor, Window Management placement with fallback.
- **Mic capture:** the `AudioSource` for the laptop mic (getUserMedia, AudioWorklet, PCM16 frames over the WebSocket), device switching, a warning when the input is lost.
- **Offline behaviour:** cache slide images in the browser, hold the slide on disconnect, flip to Manual.
- **Demo polish:** transitions, empty and error states, the look judges see first.

### Dev B: the brain

Owns `apps/hub` and `tools/replay`.

- **Server:** sessions, state machine, broadcast, reconnect handling, health check.
- **Speech:** relay audio to Voice Transcribe, handle interim and final frames, the Web Speech fallback hook, latency measurement with your voice.
- **Deck ingestion:** upload endpoint, LibreOffice conversion, PNG rendering, PPTX and PDF structure extraction, vision pass, narrative pass, BM25 index.
- **Intent engine:** command grammar, semantic call with cached prefix, BM25 fusion, confidence table, cooldowns, hold on questions, modes, undo stack.
- **Logging and tuning:** log every decision with its latency; the replay harness; threshold tuning against the demo script.
- **Deploy:** pick the host in the first hour, get one hosted version running by the evening, final deploy after the freeze.

### Together

`packages/shared` is written together in the first 20 minutes: Dev B drafts the schemas from the Contracts section, Dev A reviews, then both import from it and neither redefines anything.

| Dev A needs | From Dev B | By |
| --- | --- | --- |
| A fake hub that serves a hard-coded deck and cycles scripted effects | Hub stub | 19:50 |
| Real upload, deck JSON and progress | `POST /decks` and `GET /decks/:id` | 21:00 |
| Real decisions and transcripts | Fast path, then semantic path | 21:45 |

| Dev B needs | From Dev A | By |
| --- | --- | --- |
| A test page that sends scripted `cmd` messages | Minimal page | 20:00 |
| Mic frames arriving at the hub | `AudioSource` sending PCM16 | 21:00 |
| Review edits saved through the endpoint | Review page | 21:30 |

Working rules: small PRs into `main` every 30 to 45 minutes, nobody edits the other's folder without asking, integration happens on the real stack with the real mic and projector, and each dev records a 60-second clip of their half in case the other half breaks.

## Schedule

The clock assumes a 19:20 start in Lagos, the 23:20 build cap, and the Meta deadline buffer to roughly 02:00 after you confirm the time. Priority order if anything slips: upload to display, manual control, voice commands, highlight, auto-advance, zoom, review screen polish, link opening, SAM.

| Time | Dev A | Dev B |
| --- | --- | --- |
| 19:20 to 19:40 | Scaffold web app, Tailwind, the four pages | Scaffold hub, `packages/shared`, Supabase project, pick the deploy host |
| 19:40 to 20:20 | Audience window and Presenter view against the fake hub | Hub state machine, fake hub, Voice Transcribe socket test, measure latency with your voice |
| 20:20 to 21:20 | Mic capture and device picker, effects, Library and Review pages | Ingestion pipeline end to end, command grammar |
| 21:20 to 22:10 | Upload flow, offline behaviour, polish | Semantic path, fusion, confidence table, modes, undo |
| 22:10 to 22:50 | Integration on the laptop with the real mic and projector | Replay harness, tune thresholds with the demo script, first hosted deploy |
| 22:50 to 23:20 | Fix the worst failures, then freeze features | Fix the worst failures, then freeze features |
| 23:20 to 00:30 | Record the demo video, backup recording | Final deploy, README and submission |
| 00:30 to 02:00 | Buffer only. No new features | Buffer only. Confirm the submission went through |

The cap is a decision, not a target: if integration is green early, spend the time on testing with your voice, not on new features.

## Demo deck and script

Build a 6-slide deck as a real PPTX so the whole pipeline is shown, not a hard-coded fixture. Write the spoken script first, with specific numbers, then phrase lines so they hit the aliases naturally.

| Slide | Content | What the demo shows |
| --- | --- | --- |
| 1 Title | Product name, tagline | Voice "go to slide 2" or inferred advance |
| 2 Problem | A large stat such as "62%" | Highlight when you say the number |
| 3 Chart | Bar chart of quarterly revenue | Highlight one bar, then zoom the chart |
| 4 Image | Product screenshot | Zoom the screenshot when you refer to it |
| 5 Link | "Watch the demo" | Overlay card on "open the demo" |
| 6 Close | Three key figures | Highlight each figure in turn, then hold on "any questions" |

Show the review screen briefly before going live. It makes the AI's work visible to judges.

## Testing and acceptance

Each item is pass or fail on the real stack, with phone mic and projector.

1. Upload a 6-slide PPTX in the Library; every slide is presentable in under 90 seconds.
2. Click Present: the audience window opens on the projector, fullscreen, with no cursor.
3. "Next slide" and "go back" act in under 300 ms from the interim text.
4. A highlight appears within 1.5 s of the spoken cue on at least 8 of 10 tries.
5. Auto-advance fires only after the key points are covered or a cue is heard, and never skips a slide.
6. Space stops the model instantly; undo restores the previous state.
7. Unplug the venue wifi: the audience window holds the slide, the Presenter view shows Manual, and keys still work.
8. Kill the Meta socket: the Web Speech fallback takes over without a restart.
9. Mic unplugged and replugged, or switched in the picker, mid-session: audio resumes without a page reload.
10. A full run of the demo script, three times in a row, with no operator intervention.

Also log every decision with latency and review the log after each run. The replay harness should replay the demo script plus one run where you ad-lib, to catch false positives.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Voice Transcribe socket fails or lags | Switch to the browser's Web Speech API (Chrome), flagged in the Presenter view |
| Model latency above 1.5 s | Lean on the fast path; use Assist mode so a slow suggestion is one tap, not a miss |
| LibreOffice renders fonts badly | Install the deck's fonts; ask for PDF export as the alternative |
| Vision boxes are inaccurate | The Review page lets you fix them; snap to exact PPTX boxes where available |
| False advance during a pause | Fusion rule, 85% confidence and key-point coverage; Space as kill switch |
| Venue wifi drops | Phone hotspot for the laptop; cached deck; Manual mode |
| Laptop mic too far or noisy | Test at the distance you will stand; plug in a USB or wireless lapel mic and pick it in the Presenter view |
| Browser blocks mic or fullscreen | Run on localhost; test the exact laptop and projector the day before |
| Free host sleeps or cannot run LibreOffice | Demo from the laptop; the hosted link is for judges; convert decks locally if needed |
| Deadline time is wrong | Confirm on Meta's official page now; if earlier, cut after step 7 of the priority order |

## Submission checklist

- Repo public or shared as the rules require, with no API keys in history. Rotate any key that was ever committed.
- README: what it is, architecture diagram, setup in under 10 minutes, env variables, how to run the replay harness, known limits.
- Live URL on HTTPS and a short test deck for judges.
- Demo video under the length limit, with a backup recording.
- Submission text that names the Meta models used for each AI job: Muse Voice Transcribe for speech, Muse Spark 1.3 for vision and decisions.
- Pitch close: Stage Pilot today, the Chrome extension for native Slides and PowerPoint next.

## Verify first (first 30 minutes)

1. Official hackathon deadline and time zone.
2. Model API key works; one Muse Spark call with JSON-schema output; measure round trip.
3. Voice Transcribe: audio format and sample rate, interim and final frames, latency, accuracy on your accent and at stage distance.
4. Exact `reasoning_effort` values accepted by Muse Spark 1.3 and whether prefix caching is automatic.
5. Whether SAM 3.1 is reachable on the Model API; if not, keep `ImageTargeter` as the stub.
6. LibreOffice on your laptop renders the demo PPTX correctly.
7. Window Management API permission works on the actual laptop and projector.
8. Deploy host: supports WebSockets, current free tier, does not sleep, can run LibreOffice.
