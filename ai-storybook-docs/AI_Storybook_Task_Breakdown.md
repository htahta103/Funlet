# AI Storybook Companion — Task Breakdown (MVP)

## Phase 0 — Foundations
- Confirm stack (React Native), deployment targets, and env setup.
- Define design kit: colors (day/bedtime), typography, spacing, icon set.
- Curate 4–6 safe ElevenLabs voices; choose default bedtime voice.
- Draft sample prompts/styles; finalize guardrail rules and blocklist.

## Phase 1 — Prompt-to-Story Pipeline
- Build backend endpoint to accept prompt/style/bedtime toggle; enforce length/guardrails.
- Orchestrate Dreamflow: batch or parallel page requests; store seed/style per page.
- Return progressive results (page-by-page) with IDs for later remix/export.
- Implement client creation screen with examples, style chips, bedtime toggle, CTA.
- Show generation progress UI with time estimate and cancel.

## Phase 2 — Reader & Narration
- Implement paginated reader (6–8 pages) with swipe navigation and page indicator.
- Integrate ElevenLabs streaming TTS; map narrator + up to 2 character voices.
- Add voice picker bottom sheet with preview; cache selected voices.
- Add per-page play/pause, auto-play through pages, subtitles default on.
- Handle TTS retries and narrator fallback; surface inline errors.

## Phase 3 — Remix & Bedtime Mode
- Add per-page “Remix image” calling Dreamflow with stored seed/style/text.
- Keep text/voice mapping stable after remix; update thumbnail on success.
- Bedtime mode UI theme (dimmed palette, reduced motion) and soft voice preset.

## Phase 4 — Export & Sharing
- Server-side export job: stitch images + TTS audio + captions (FFmpeg).
- Client export flow: choose aspect (portrait/square), include subtitles toggle; poll/export status.
- Save video to device and share sheet integration; handle retries.

## Phase 5 — Persistence & Offline
- Local library: store story metadata, cover thumbnail, cached audio/images.
- Offline behavior: block new generation/export; allow playback of cached stories.
- Delete/manage stories; confirm dialogs.

## Phase 6 — Quality, Safety, Analytics
- Implement prompt blocklist and friendly errors; cap text length.
- Add loading/error states for gen/TTS/export; add retries with limits.
- Instrument metrics: creation success, time-to-first-page, TTS latency, remix/export rates.
- Accessibility: large tap targets, captions, bedtime contrast, voice hints.

## Phase 7 — Launch Checklist
- Golden path tested on iOS/Android; regression on reader/TTS/remix/export.
- Performance checks vs targets: first page <10s; TTS start <1.5s; export <20s.
- Voice and style curation locked; bedtime theme verified.
- Crash/exception logging enabled; analytics dashboards for KPIs.
