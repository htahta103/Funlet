# AI Storybook Companion — MVP PRD

## Summary
Mobile app where users enter a prompt; Dreamflow generates illustrated pages; ElevenLabs narrates each page with selectable character voices. MVP optimizes for a smooth, low-latency, kid-friendly reading experience with quick remixing and bedtime mode.

## Goals (MVP)
- Generate a short story (6–8 pages) from a prompt with images and text under ~45s total.
- One-tap narration per page with curated ElevenLabs voices; optional auto-play through pages.
- Remix any page’s art without breaking the story text.
- Bedtime mode: softer palette/typography and calmer voice preset.
- Save/share as short video (visuals + narration + captions).

## Non-Goals (MVP)
- Accounts/social login.
- Multi-language beyond English.
- Long-form books (>12 pages) or heavy text editing.
- User-uploaded images or collaboration.

## Target Users
- Parents reading to kids (ages 3–8).
- Young creators/teachers who want fast, illustrated stories.

## UX Principles
- Fast first result: show meaningful progress and time estimates.
- Kid-safe defaults: safe voices, blocked prompts, gentle palette.
- Minimal taps: primary path is prompt → generate → read → share.
- Clear states: “generating…”, “remixing…”, “exporting…” with retries.

## User Stories
- Enter a short prompt and get a ready-to-read story in under a minute.
- Tap play to hear narrator; tap characters to hear distinct voices.
- Regenerate a page’s image without losing text.
- Toggle bedtime mode for softer visuals and narration.
- Save or share the story as a video with subtitles.

## Core Flow (Happy Path)
1) Landing: prompt input (with examples), style chips (whimsical/comic/watercolor), bedtime toggle, CTA “Create my story”.
2) Generation: friendly progress with page-by-page fill; show time estimate.
3) Story reader: swipe pages; each page shows image, text, play button; optional auto-play through pages.
4) Remix: per-page “Remix image” regenerates art; text preserved; non-blocking.
5) Voice picker: curated narrator + 1–2 character voices with quick preview.
6) Export: choose aspect (portrait/square), confirm voice, include subtitles; render and save/share.
7) Library: saved stories with cover, last-play state; offline playback for cached items.

## Wireframes (Text Draft)
- Landing / Prompt
  - Header: logo + “Library”.
  - Body: prompt field; sample chips; style selector; bedtime toggle; primary button.
  - Footer: “How it works” mini strip.
- Generation Progress
  - Progress bar with “Page X of 8 ready”; small illustrations appearing as they finish.
  - Secondary button: “Cancel”.
- Story Reader (Page)
  - Top: page indicator (3/8) + “Remix” button.
  - Card: generated image (top), short text (bottom).
  - Controls: play/pause, voice chip(s), auto-play toggle; subtitles on by default.
  - Bottom bar: “Back” | “Share”.
- Voice Picker (Bottom Sheet)
  - List of 4–6 curated voices; “Preview” per row; narrator and character slots.
- Bedtime Mode State
  - Dimmed background, softer palette, reduced animation; default soft narrator voice.
- Library
  - Grid/list of covers with title + time; tap to resume/read; overflow: delete/share.
- Export Modal
  - Options: portrait/square; include subtitles toggle; “Export”; inline status + retry.

## Feature Scope (MVP)
- Prompt-to-story: title + brief plot + style selector; guardrails on prompt length/content.
- Pagination: 6–8 pages; swipe navigation.
- Page visuals: Dreamflow per page; store seed/style for reproducibility.
- Narration: ElevenLabs streaming; narrator + up to 2 character voices; auto-play option.
- Remix: per-page regeneration; keeps text and voice mapping.
- Bedtime mode: UI theme + soft voice preset; lower brightness animations.
- Export: server-side composition to video with captions; save/share to device.
- Persistence: local story list with thumbnails and cached audio/images.
- Safety: prompt filters; kid-safe default voices and styles.

## Technical Notes
- Mobile: React Native (recommended) for faster integration with JS SDKs.
- Backend: lightweight orchestrator for Dreamflow + ElevenLabs, prompt guardrails, export job queue.
- Storage: cloud object storage for images/audio; signed URLs; device caching.
- Export: server-side FFmpeg to stitch images + TTS + subtitles; webhooks/polling for status.
- Telemetry: creation success, time-to-first-page, TTS latency, remix frequency, export completion.

## Performance Targets
- Time to first page visual: <10s on Wi‑Fi.
- Full story generated: <30–45s for 8 pages.
- TTS start after tap: <1.5s (with streaming).
- Export: <20s for 8-page video with audio/captions.

## Integration Details
- Dreamflow: batch page prompts; allow parallel requests; expose seed/style for undo/remix; non-blocking per-page updates.
- ElevenLabs: streaming TTS; pre-cache chosen voices at story start; map narrator/characters; retry once then fallback to narrator voice; capture timestamps for captions.

## Edge Cases & Fallbacks
- Image gen fails: inline error, retry/remix, placeholder page.
- TTS fails: retry; fallback to narrator voice; show retry button.
- Network loss: block generation/export; allow local playback of cached stories.
- Long/unsafe prompts: truncate with notice; block unsafe terms with friendly error.

## Metrics / KPIs
- Creation success rate.
- Time to first page; total time to story.
- Narration start latency; auto-play completion rate.
- Remix per story; export completion rate.
- Crash-free sessions; error rates on gen/TTS/export.

## Milestones (MVP)
- M0: Wireframes + design kit (voices, styles, bedtime theme).
- M1: Prompt-to-story generation (images + text) with progress.
- M2: Reader with per-page TTS, auto-play, remix.
- M3: Export to video with captions; sharing.
- M4: Polish: bedtime mode, guardrails, caching, analytics.
