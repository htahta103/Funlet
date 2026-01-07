# AI Storybook Companion — Text Wireframes (MVP)

Legend: `[]` buttons, `( )` toggles, `{ }` inputs, `---` dividers.

## 1) Landing / Prompt
```
Logo                         [Library]
--------------------------------------
Title: "Create a Story"
{ Prompt field ..................... }
Chips: [A sleepy dragon] [Space picnic] [Forest friends]
Style: [Whimsical] [Comic] [Watercolor]
Toggle: ( ) Bedtime mode
[Create my story]
Mini-strip: "How it works" → tiny 3-step visuals
```

## 2) Generation Progress
```
< Back                               [Cancel]
----------------------------------------------
Title: "Generating your story"
Progress bar: Page 3 of 8 ready  █████░░░░
Thumbnails appear as pages finish (tap to preview disabled)
Tip text: "You can remix any page later."
```

## 3) Story Reader (Page)
```
< Back        3 / 8               [Share]
-----------------------------------------
[Remix image]
[ Generated illustration (card) ]

Story text (2–3 lines)

Controls:
[Play/Pause]  [Auto-play toggle ( )]  Voice chips: [Narrator] [Character]
Subtitles: on by default (caption bar below text)
```

## 4) Voice Picker (Bottom Sheet)
```
Pull handle
Title: "Voices"
Tabs: [Narrator] [Character 1] [Character 2]
List:
- Calm Night — soft, bedtime  [Preview] (selected)
- Bright Day — upbeat         [Preview]
- Cozy Storyteller            [Preview]
- Adventurer                  [Preview]
[Apply]
```

## 5) Bedtime Mode (State)
```
Global: dim background, muted palette, reduced motion
Reader controls use soft accent color; default voice = Calm Night
Brightness hint: "Screen dimmed for bedtime"
```

## 6) Library
```
Header: Logo           [Create new]
-----------------------------------
List/grid of cards:
[Thumb]  "The Sleepy Dragon"   2m ago   [••]
[Thumb]  "Space Picnic"        Yesterday [••]
Card tap → resume reader
Overflow [••]: Delete / Share
```

## 7) Export Flow
```
[Back]                        Export Story
-----------------------------------------
Aspect: [Portrait] [Square]
Subtitles: (x) Include
Voice: Narrator (Calm Night)
[Export]
Status: "Rendering... 40%" with retry on failure
```

## 8) Remix Flow (Inline)
- Tap [Remix image] → show spinner overlay on the image card; text and controls remain usable.
- On success: image swaps, brief toast "Remixed".
- On failure: inline error with [Retry] and [Use previous].
