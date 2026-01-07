# AI Storybook Companion — 3-Week Build Plan (MVP)

Assumes small team (1–2 mobile, 1 backend), React Native, lightweight backend.

## Week 1 — Foundations & Gen Pipeline
- Env setup, design tokens (day/bedtime), icon set, sample prompts/styles.
- ElevenLabs: select 4–6 voices; implement preview; caching strategy defined.
- Dreamflow: orchestration endpoint scaffolding; prompt guardrails/blocklist.
- Client: Landing screen (prompt, style chips, bedtime toggle), generation progress UI (stubbed data).
- Backend: text-to-story scaffold; Dreamflow mock returns; page-by-page progress contract.

## Week 2 — Reader, Narration, Remix
- Reader: paginated pages, image/text layout, page indicator, subtitles on by default.
- ElevenLabs integration: streaming TTS per page; narrator + character mapping; retry + fallback.
- Voice picker bottom sheet with preview; cache voices on selection.
- Remix: per-page regenerate call; keep text stable; update card thumbnail; non-blocking UI.
- Bedtime mode theme + soft voice default; reduced motion flag.

## Week 3 — Export, Persistence, Polish
- Export service: server-side FFmpeg stitch (images + TTS + captions); polling and retries.
- Client export flow: aspect select, subtitles toggle, status/retry, share sheet.
- Local library: store story metadata, cover thumb, cached audio/images; delete/manage.
- Offline handling: block new gen/export; allow playback of cached stories with messaging.
- QA/perf: measure time-to-first-page, TTS start latency, export duration; fix hotspots.
- Analytics: log creation success, timing, remix/export rates, errors.

## Cut/Tradeoffs if Time Tight
- Limit to narrator-only voice in Week 2; add character voices post-MVP.
- Export only portrait with subtitles on; add square later.
- Cap pages to 6 instead of 8 to hit perf targets.
