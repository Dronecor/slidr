# slidr (Stage Pilot)

Web app that shows your deck on the projector and drives it from your voice. This repo contains the **backend + AI hub** (Dev B) and the **web frontend** (Dev A, `apps/web`); both talk over the contracts in `packages/shared`.

## Layout

- `packages/shared` — zod schemas + TypeScript types for every contract (Deck, Session state, WS envelope, Spark decision). Single source of truth; neither side redefines them.
- `apps/hub` — Node + `ws` server: session state machine, audio relay, intent engine, ingestion worker. Only component that holds the Meta API key.
- `apps/web` — Next.js frontend: landing, library, review, presenter view, audience window. No API keys; reaches the hub over HTTP + WebSocket.
- `tools/replay` — transcript replay harness for tuning thresholds without speaking aloud.

## Run

```bash
npm install
cp .env.example .env   # fill META_API_KEY, SUPABASE_* — nothing is hardcoded
npm run build
npm start --workspace=@stage-pilot/hub   # or: npm run start:hub
npm test               # per-slice tests (contracts, state, grammar, fusion, ingestion, replay)
node tools/replay/dist/index.js <transcript.json>
```

Frontend, in a second terminal:

```bash
npm run dev:web        # http://localhost:3000 (hub expected at :8787, see .env.example)
```

Append `?mock=1` to any web URL to rehearse against the in-browser fake hub with no backend: upload renders PDFs locally, and the mock speech box fires scripted decisions.

Without `META_API_KEY` the hub runs with deterministic fake clients (clearly logged as `fake-client mode`) so the frontend can integrate immediately. With a key, real Muse Spark 1.3 + Voice Transcribe are used. Storage defaults to local disk (`.data/`); set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for Supabase Postgres/Storage.

## Hub API

HTTP: `POST /decks` (file bytes + `X-File-Name`/`X-Deck-Title` headers), `GET /decks`, `GET /decks/:id`, `PUT /decks/:id/slides/:sid/elements`, `POST /sessions`, `GET /health`, `GET /files/decks/:deckId/:index.png`.

WebSocket: JSON envelope `{v:1, type, seq, payload}`. Client sends `join`, `audio.start`/`audio.stop`, `cmd`, `suggestion.accept`/`dismiss`, binary PCM16 frames after `audio.start`, plus `transcript.inject` for fallback/testing. Hub sends `state`, `transcript`, `decision` (via logs/health), `health`, `error`.

Demo deck: `POST /sessions {"deckId":"demo"}` works with no upload.

## Known limits

- LibreOffice (`soffice`) + `pdftoppm`/`pdftotext` must be installed for real PPTX→PDF→PNG conversion; without them ingestion still completes with fallback images and empty extracted text.
- Session state is in hub memory only (lost on restart, by design). SAM image targeting ships as a stub behind `ImageTargeter`.
