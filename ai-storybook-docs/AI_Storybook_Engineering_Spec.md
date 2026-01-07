# AI Storybook Companion — Engineering Spec (MVP)

## Design Tokens (Draft)
- Colors (day): primary `#5A6CF3`, accent `#FFB347`, surface `#F7F8FC`, text `#1E2430`.
- Colors (bedtime): primary `#3A4A9C`, accent `#F2CFAE`, surface `#0F1320`, text `#E8ECF5`, reduce vibrance 15%.
- States: success `#4BB543`, warning `#F6C343`, error `#E4565C`.
- Typography: Title `24/32` semi-bold, Body `16/24` regular, Caption `14/20`.
- Radii: cards `16`, buttons `12`; Shadows: subtle y=4 blur=16 (day), disabled for bedtime.
- Motion: standard 200–250ms; bedtime reduce to 100ms fade only.

## Core Client Screens (RN)
- `CreateScreen`: prompt input, style chips, bedtime toggle, CTA; examples list.
- `ProgressScreen`: shows page-by-page progress; cancel.
- `ReaderScreen`: paginated view with image, text, controls (play/pause, auto-play, voice chips), subtitles bar, remix button.
- `VoiceSheet`: bottom sheet for narrator/character voices with preview.
- `ExportScreen`: aspect select, subtitles toggle, export status.
- `LibraryScreen`: list/grid of saved stories with overflow actions.

## Data Models (Client)
```ts
type Page = {
  id: string;
  text: string;
  imageUrl: string;
  seed?: string;
  style?: string;
};

type Story = {
  id: string;
  title: string;
  pages: Page[];
  createdAt: string;
  voices: { narrator: VoiceId; character1?: VoiceId; character2?: VoiceId };
  bedtime: boolean;
  status: "draft" | "ready" | "exporting" | "exported" | "error";
  exportUrl?: string;
};
```

## API Contracts (Draft)
- `POST /story`  
  - Body: `{ prompt, style, bedtime, pageCount? }`  
  - Returns: `{ storyId, estimatedSeconds, pages: PageStatus[] }`
- `GET /story/:id/progress`  
  - Returns: `{ pages: [{ id, status: "pending"|"ready"|"error", imageUrl?, text }], done: boolean }`
- `POST /story/:id/remix/:pageId`  
  - Body: `{ seed?, style?, text }`  
  - Returns: `{ pageId, imageUrl, seed }`
- `POST /story/:id/tts`  
  - Body: `{ voices: { narrator, character1?, character2? }, pages: [{ id, text }] }`  
  - Returns: stream or `{ audioUrls: [{ pageId, url, captions }] }`
- `POST /story/:id/export`  
  - Body: `{ aspect: "portrait"|"square", subtitles: boolean }`  
  - Returns: `{ exportId }`
- `GET /export/:exportId/status`  
  - Returns: `{ status: "pending"|"rendering"|"ready"|"error", url? }`

## ElevenLabs Integration
- Use streaming TTS for low latency; cache selected voices once at story start.
- Map narrator/characters; if character voice fails, fall back to narrator.
- Capture word/phoneme timestamps for captions; store per page.

## Dreamflow Integration
- Batch page generations; allow parallel up to N (tune for cost/latency).
- Store `seed` and `style` per page to support remix/undo.
- Non-blocking UI: show page-by-page readiness; allow remix while other pages load.

## Export Service
- FFmpeg job stitches ordered images + TTS audio + captions to MP4 (H.264 + AAC).
- Defaults: 1080x1920 portrait; square optional. 30fps stills with per-page hold + crossfade.
- Subtitles baked-in; keep separate .srt for accessibility if needed.
- Status via polling; retry on transient failures (max 2).

## Offline & Caching
- On-device cache for images/audio per story; library reads from cache first.
- Block new generation/export offline; allow playback of cached stories with notice.

## Error Handling
- Gen fail: inline page error, retry/remix options, placeholder image fallback.
- TTS fail: retry once; fallback to narrator; surface toast + inline icon.
- Export fail: show retry; keep partial artifacts until success.

## Instrumentation (Client events)
- `story_create_start/success/fail`, `time_to_first_page`, `time_to_full_story`.
- `tts_start/latency/fail`, `remix_start/success/fail`, `export_start/success/fail`.
- Playback: `page_play`, `autoplay_complete`.
