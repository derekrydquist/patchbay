# CLAUDE.md — PatchBay

This file is the instruction manual for Claude Code when working on this project.
Read it fully before making any changes.

---

## What Is PatchBay?

PatchBay is a collaborative songwriting platform for bands. It lets band members in different
locations upload recorded ideas for each instrument, assemble those ideas into a demo on a
shared timeline, and track production progress — all without a studio engineer in the middle.

**The one-liner:** PatchBay is a shared space for a band to track song progress by organizing
recorded ideas and assembling them into fully realized demos.

**What it is NOT:** A recording tool, a mixer, or a mastering suite. PatchBay is arrangement
and collaboration only.

---

## Project History

This project was originally scaffolded by Replit and used as a design prototype. It was
previously called "Song-Weaver-Suite" and "Studio Lux" in some parts of the code. All
references should be renamed to **PatchBay** going forward.

The frontend UI is largely designed and functional. The backend is fully built out — real API
routes, database persistence, file uploads, and audio playback all work end-to-end. The primary
remaining work is:

1. Implementing auth (user accounts, roles, permissions) — Passport.js is installed but not wired up
2. Real-time collaboration — WebSockets (`ws`) are installed but not used yet
3. Deployment infrastructure (file storage, hosting)

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend framework | React 19 + TypeScript | |
| Routing | Wouter | Lightweight, replaces React Router |
| State / data fetching | TanStack Query (React Query) | Installed and wired up — `QueryClientProvider` is in `main.tsx` |
| UI components | shadcn/ui + Radix UI | All components live in `client/src/components/ui/` |
| Styling | Tailwind CSS v4 | |
| Drag and drop | dnd-kit | Used on the Timeline |
| Backend | Express 5 (Node.js) | |
| ORM | Drizzle ORM | |
| Database | SQLite (via better-sqlite3) | See Database section below |
| Build tool | Vite 7 | |
| Language runtime | tsx (for running TypeScript directly) | |

---

## Project Structure

```
patchbay/
├── client/                     # All frontend code
│   ├── index.html
│   └── src/
│       ├── App.tsx             # Router — three main routes: / (Dashboard), /songs/:songId (SongHome), /songs/:songId/workspace (Workspace)
│       ├── main.tsx            # React entry point
│       ├── pages/
│       │   ├── Dashboard.tsx   # Landing page — all songs, cross-song task list, activity feed
│       │   ├── SongHome.tsx    # Per-song homepage — resume last session, tasks, file browser, activity feed
│       │   ├── Workspace.tsx   # Main DAW view — timeline, buckets, production tracker
│       │   ├── home.tsx        # (Unused / legacy — can be removed)
│       │   └── not-found.tsx   # 404 page
│       ├── components/
│       │   ├── daw/            # Core PatchBay-specific components
│       │   │   ├── Timeline.tsx        # The arrangement timeline — drag clips onto tracks
│       │   │   ├── Track.tsx           # A single instrument row in the timeline
│       │   │   ├── Clip.tsx            # An audio clip (in bucket or on timeline)
│       │   │   ├── MediaBucket.tsx     # File browser / upload panel (left side of Workspace)
│       │   │   ├── Transport.tsx       # Play/pause/BPM/loop controls (top bar of Workspace)
│       │   │   ├── ProductionTracker.tsx  # Kanban task board for song progress
│       │   │   ├── ExportDialog.tsx    # Export song dialog
│       │   │   ├── Ruler.tsx           # Timeline time ruler
│       │   │   └── DawScrollbar.tsx    # Custom scrollbar for timeline
│       │   └── ui/             # shadcn/ui component library — DO NOT manually edit
│       ├── hooks/
│       │   └── use-mobile.tsx
│       └── lib/
│           ├── daw-data.ts     # ALL mock data + TypeScript types — this is the data model
│           ├── queryClient.ts  # TanStack Query configuration
│           └── utils.ts        # Tailwind class utility (cn())
├── server/
│   ├── index.ts        # Express server entry — sets up middleware, starts on port 3001
│   ├── routes.ts       # API route registration — all implemented routes go here
│   ├── storage.ts      # Data access layer — SQLiteStorage implements IStorage
│   └── vite.ts         # Vite dev server integration (do not modify)
├── shared/
│   └── schema.ts       # Drizzle ORM schema — shared between server and client types
├── package.json
├── vite.config.ts      # Vite config — aliases: @ = client/src, @shared = shared/
├── drizzle.config.ts   # Drizzle config — points at DATABASE_URL
├── tsconfig.json
└── CLAUDE.md           # This file
```

---

## Database

**We use SQLite** (not PostgreSQL). This requires no server, no cloud account, and no
environment setup. Data is stored in a single file: `patchbay.db` in the project root.

### Why not PostgreSQL?
The original Replit scaffold configured PostgreSQL, but that requires a running database
server. SQLite is a file-based database that works anywhere Node.js runs. Drizzle ORM
supports both; switching to PostgreSQL later (for deployment) is straightforward.

### Setup
Install the SQLite adapter:
```bash
npm install better-sqlite3 @types/better-sqlite3
```

### Drizzle config for SQLite
`drizzle.config.ts` should use:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: "./patchbay.db" },
});
```

### Running migrations
```bash
npm run db:push
```

This has already been run — `patchbay.db` exists in the project root with all tables created.

### Server database module

`server/db.ts` initializes the connection and exports the Drizzle `db` instance. Import it in
any server file that needs direct DB access. The storage layer (`server/storage.ts`) wraps all
queries in an `IStorage` interface — prefer using `storage` from there rather than `db` directly
in route handlers.

### Schema source of truth

`shared/schema.ts` defines all tables and exports both `Insert*` and `Select` types for each.
`ClipMetadata` is defined there (not in `daw-data.ts`) so it can be shared by server and client.

### Tables

| Table | Purpose |
|---|---|
| `users` | Auth — username/password accounts |
| `songs` | Top-level song container (name, bpm, sections JSON) |
| `instrument_tracks` | One row per instrument per song (Drums, Bass, etc.); has `active` boolean — false = hidden |
| `ideas` | A section slot per instrument (e.g. "Drums — Verse 1"); has `active` boolean — false = hidden |
| `deleted_sections` | Tracks intentionally deleted default sections (songId + sectionName) so bootstrap doesn't re-add them |
| `clips` | Versions uploaded to a bucket idea (linked to `ideas`); `isFinal` marks the chosen version |
| `timeline_clips` | Clips placed on the arrangement timeline (linked to `instrument_tracks`); `isFinal` mirrors the corresponding bucket clip's final state; `trimStart` (real, default 0) and `trimEnd` (real, nullable) store non-destructive trim points in seconds |
| `clip_comments` | Timestamped comments on bucket clips |
| `production_tasks` | Kanban tasks linked to a song |
| `task_subtasks` | Checklist items on a task |
| `task_comments` | Comments on a task |

**`timeline_clips` vs `clips`:** These are intentionally separate tables. `clips` holds the uploaded source material (versions inside bucket ideas). `timeline_clips` holds the arranged instances placed on the timeline with a `start` time. Dragging from the bucket to the timeline creates a new `timeline_clips` row — it does not move the source clip.

### Default song bootstrap

`server/storage.ts` exports `DEFAULT_SONG_ID = "patchbay-default"`. The first call to `GET /api/songs/:id/timeline` auto-creates this song and its five default instrument tracks if they don't exist yet (using `INSERT OR IGNORE`). The default track IDs are stable strings: `track-drums`, `track-bass`, `track-guitar-1`, `track-guitar-2`, `track-vocals`.

`storage.ts` also exports `DEFAULT_SECTIONS = ["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Outro"]`. The bootstrap inserts 35 idea rows (5 tracks × 7 sections) using stable IDs like `idea-track-drums-0`, and 35 production task rows using stable IDs like `task-track-drums-0`. Both ideas and tasks use `onConflictDoNothing()` — existing rows (including hidden ones) are preserved. Default tracks check for existence first: if a track exists with `active = false`, the bootstrap skips it entirely (does not re-show it). All mechanisms ensure hide/restore persists across server restarts.

### Track IDs must be stable

`INITIAL_TRACKS` in `daw-data.ts` uses the same stable string IDs (`track-drums`, etc.) — **not** `nanoid()`. This is required because the timeline's live sync matches local `Track` objects to `ApiTrack` objects by `id`, and `timelineClips.trackId` is a DB foreign key that must match. If IDs diverge, the live sync silently mismatches tracks and DB relationships break. Do not change `INITIAL_TRACKS` to use generated IDs.

---

## Timeline Behavior

### Design principles — do not revert without discussion

These are intentional product decisions, not implementation details:

- **Clips are always contiguous** — no gaps, no overlaps within a track
- **Section-locking is enforced** — a clip can only live in its matching section column
- **Position is always derived, never stored independently** — `clip.start` is always the output of `recalcAllStarts`, never set from a cursor pixel offset or arbitrary value
- **The timeline is plug-and-play by design** — complexity that belongs in a freeform DAW does not belong in PatchBay

### Mental model

The timeline is a **grid**: rows are instrument tracks, columns are song sections (Intro, Verse 1, Chorus 1, …). Each cell in the grid can hold an ordered array of clips. A clip belongs to exactly one section and can only be placed in that section's column — a Verse 1 clip can never land in the Chorus 1 column. PatchBay enforces this in the UI before the user releases the mouse.

### Section columns

Sections are derived entirely from the clips currently on the tracks — there is no independent section list. A section only exists if at least one clip with that `sectionName` is on the timeline. When the last clip for a section is removed, the column disappears immediately.

Section column **order** is stored as an explicit `sectionOrder: string[]` state in `Timeline`. This is the authoritative order — not inferred from `MOCK_SONG.sections`. It is initialized from `MOCK_SONG.sections` on first load, updated when clips are dropped, and pruned by a `useEffect` that removes sections with no clips. A `sectionOrderRef` keeps it accessible inside stale-closure handlers.

Three pure functions (module-level in `Timeline.tsx`) maintain section geometry. All three take `sectionOrder` as their second argument:
- **`getActiveSections(tracks, sectionOrder)`** — returns ordered section names present in clips, using `sectionOrder` as the authoritative sequence. Sections not yet in `sectionOrder` are appended at the end.
- **`computeSectionLayout(tracks, sectionOrder)`** — calls `getActiveSections`, then computes each section's absolute `start` (seconds) and `duration` (sum of effective trimmed durations per track, max across tracks, floored at `MIN_SECTION_WIDTH = 4s`). Effective duration = `(c.trimEnd ?? c.duration) - (c.trimStart ?? 0)`. Returns `SectionInfo[]`.
- **`recalcAllStarts(tracks, sectionOrder)`** — calls `computeSectionLayout` internally and recalculates `clip.start` for every clip using effective trimmed durations to advance position. This is the single source of truth for positions.

The `sectionLayout` `useMemo` inside `Timeline` calls `computeSectionLayout(tracks, sectionOrder)` and is the authoritative list for rendering (section headers, `SectionCell` widths, invalid-section grayout):
```ts
{ name: string; start: number; duration: number }[]
```

**Always pass `sectionOrder` to `recalcAllStarts`.** Never call it with only `tracks`. Handlers inside `useEffect(fn, [])` must use `sectionOrderRef.current` instead of the `sectionOrder` closure variable (stale closure).

### Droppable zones

There are two kinds of droppable zones in the clip-drag `DndContext`:

**1. Track rows** — bare track ID (e.g. `"track-drums"`). One per track. The droppable element is the sections container div inside `TimelineTrack` — it spans the full row from after the 256px header to the right edge. `disabled: isInvalidDrop` when the dragged clip belongs to a different instrument.

**2. Gap zones** — `gap||${gapIndex}` — **clip-boundary** zones within the active drag's section. `gapIndex = 0` is before the first clip; `gapIndex = N` is after clip N−1 (i.e. between clips N−1 and N). Dropping here **reorders clips within the section** — it is not a section column operation. These are rendered as `GapZone` components (defined in `Timeline.tsx`) via a `gapZones` `useMemo` that runs whenever `activeDragData` changes. They are always rendered (not gated on `isDragging`) so their DOM nodes exist for the live rect check. Each zone is 20px wide, centered on the boundary, spanning the full track-area height.

**`GapZone` implementation:** Uses a `refCallback` that writes to both `setNodeRef` (dnd-kit) and a local `nodeRef.current` (for live rect), so the collision function can call `container.node.current?.getBoundingClientRect()` to bypass the stale `droppableRects` cache. `isOver` alone drives the gold insertion line — no state threaded from the parent.

**`gapZones` useMemo:** Reads `activeDragData.trackId` and `activeDragData.clip.sectionName` to find the track and section, then walks the section's clips in order using effective durations to compute each boundary's absolute pixel position (`256 + posSec * zoom`). Returns `[]` when no drag is active.

**Section column reordering** is handled entirely by a **separate inner `DndContext`** that wraps only the section header row. It does not use gap zone IDs — it uses `handleSectionDragMove` (nearest-gap heuristic) and `handleSectionDragEnd` → `reorderSectionOrder`. Clip drag and section-column drag are completely independent drag contexts with no shared drop targets.

**`reorderSectionOrder(sectionOrder, sectionName, gapIndex, activeNames)`** — pure function used only by the section-header DndContext. `activeNames` is `sectionLayout.map(s => s.name)`. It removes the section from its current position, adjusts `gapIndex` for the resulting index shift, and splices the section back in. Returns the new ordered array.

**There are no per-section-cell droppables.** The old `${trackId}||${sectionName}` format was replaced. `SectionCell` is a pure visual component with no dnd-kit involvement.

**Collision detection** — the outer `DndContext` uses the custom `trackFirstCollision` function (defined module-level in `Timeline.tsx`). The outer `DndContext` also sets `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` to force dnd-kit to remeasure droppables on every render — necessary because gap zones mount and reposition mid-drag.

Gap zones are checked **first** using a live `container.node.current?.getBoundingClientRect()` call (falls back to cached rect if the ref is null). This bypasses the stale `droppableRects` cache for freshly-mounted or repositioned zones. Track rows are checked **second** by vertical band only — any X position on the row matches, preventing `overId: null` in empty horizontal track space.

`handleDragMove` checks `overId.startsWith('gap||')` first. When over a gap, it sets `isOverGap = true` and clears `insertionPoint`. Otherwise it sets `isOverGap = false` and clears `insertionPoint`.

**`handleDragEnd` gap drop — clip reorder:**
- **Bucket clip**: calls `insertClipInSection(targetTrack.id, clipSectionName, clip, gapIndex)`. No index adjustment needed — inserting a new clip, not removing an existing one.
- **Timeline clip**: removes the clip from `sectionClips`, computes `adjustedGapIndex = oldIndex < gapIndex ? gapIndex - 1 : gapIndex` (removal shifts subsequent indices down by 1), splices the clip back at `Math.min(adjustedGapIndex, withoutClip.length)`, calls `recalcAllStarts`, and PATCHes all clips whose `start` changed to the server. Uses `clipFromState` (the clip from current `tracks` state, not the stale drag-data closure) to get current `trimStart`/`trimEnd`.

On a track-row drop, `overId` is the trackId directly — see clip reorder section below.

### Position calculation — `recalcAllStarts`

`recalcAllStarts(tracks, sectionOrder)` is the single source of truth for all clip start times. It:
1. Calls `computeSectionLayout(tracks, sectionOrder)` to get each section's absolute start offset (widest track in that section determines section width)
2. For each track, walks each section's clip array in order and sets `clip.start = sectionOffset + sum of preceding effective trimmed durations`

**Effective duration** — everywhere clip length is used for layout (section width, snap position, mute-state range check, drag overlay width), use `(clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)` rather than raw `clip.duration`. `clip.duration` is the full file length and is never modified.

Call it after every insert, remove, or section reorder. It takes the full tracks array and the current `sectionOrder` and returns a new array with all starts updated. Because it is pure, it can be called inside `setTracks(prev => ...)` safely.

`insertClipInSection` accepts an optional `newOrder` parameter. When a gap drop pre-computes the new `sectionOrder`, pass it here so the recalc uses the already-updated order instead of the stale closure value.

**Do not reintroduce `recalcStarts` (the old global version).** The section-scoped model replaced it. Never derive `clip.start` from a pixel value or cursor position.

### Insertion indicators

There is one active insertion indicator during drag:

**Column-level** — each `GapZone` component renders its own gold vertical line via dnd-kit's `isOver` state when the drag pointer is over it. No separate state is needed; the indicator is owned entirely by the `GapZone`.

**`insertionPoint` is always `null` during drag.** `handleDragMove` unconditionally calls `setInsertionPoint(null)`. As a result, all track-row drops append to the end of the section (`idx = undefined` in `insertClipInSection`). The `SectionCell` gold vertical line never renders during live drag. Do not reintroduce cursor-position–based insertion indicator logic — it caused a "stuck at position zero" visual bug and is incompatible with the full-track droppable model.

### Drop validation (what is rejected)

| Condition | Result |
|---|---|
| Bucket clip's instrument ≠ track name | Reject — `isInvalidDrop` disables the droppable |
| Timeline clip dropped onto different track | Reject — `isInvalidDrop` disables the droppable |
| `over` is null on drag end | Reject — no droppable was hit |

**During drag — visual feedback:**
- **Invalid tracks** get a semi-transparent dark overlay (`rgba(0,0,0,0.5)`) rendered as an absolutely positioned child div with explicit inline styles (`position: absolute`, `left/top/bottom/right: 0`, `zIndex: 20`). The track row's own opacity does not change.
- **Valid track** gets a gold border rendered as an absolutely positioned child div with explicit inline styles (`border: 1px solid rgba(212,175,55,0.6)`). No opacity change, no dimming inside the track.
- `isDragging` is passed as a prop from `Timeline` (`activeDragData !== null`) to each `TimelineTrack` — not from `useDndMonitor` or any hook inside Track.tsx. This ensures all tracks receive the same drag state in the same render pass.
- All overlay positioning uses explicit inline styles, not Tailwind `inset-0`, to avoid paint-clipping issues on wide scrollable containers.
- **The track-level overlay is the single source of truth for all drag visual feedback.** `SectionCell` must never have drag-aware styling of any kind — no opacity, no grayscale, no filter, no className conditions that reference drag state. Clips and cells always render at full brightness regardless of drag state. (A previous `isInvalid && 'opacity-25 grayscale'` on `SectionCell` caused hard-to-trace clip dimming and was removed — do not reintroduce it.)
- **`Clip.tsx` must have zero drag-aware styling.** No `isDragging &&` conditional classes on `TimelineClip` or `BucketClip`. The `DragOverlay` renders the floating ghost separately; the original clip element in the track must not change appearance during drag.
- **The timeline itself does not change during drag.** No ghost section columns are injected speculatively. `sectionLayout` is used directly for all rendering; the old `effectiveSectionLayout` speculative-injection memo has been removed.

### Clip reorder via track-row drop

Dropping a timeline clip onto its own track row (not a gap zone) reorders it within its section using `delta.x` as a proxy for intent:

- `delta.x < 0` (dragged leftward) → move clip to **index 0** (beginning of section)
- `delta.x >= 0` (dragged rightward or no horizontal movement) → move clip to **end of section** (`withoutClip.length`)

**Left-boundary guard:** Before processing a leftward drop, the handler checks whether the pointer released inside the 256px instrument panel. It reads `activatorEvent.clientX + delta.x` and compares to `timelineRef.current.getBoundingClientRect().left`. If the cursor is left of the track area, the drop is cancelled. This prevents accidental reorders when the user drags a clip toward the panel and releases.

**Trim-safe splicing (`clipFromPrev`):** Inside `setTracks(prev => ...)`, the clip must be read from `prev` state rather than from the stale drag-data closure. The closure captures `clip` at drag-start, which may have stale `trimStart`/`trimEnd` if the clip was trimmed after the drag began. `clipFromPrev = sectionClips.find(c => c.id === clip.id) ?? clip` ensures `recalcAllStarts` sees current trim values and computes correct effective durations.

**Index adjustment for capturedPoint (unused path):** If `insertionPoint` ever resumes (currently always null during drag), `oldIndex < newIndex → newIndex -= 1` corrects for the removal shift — same logic as the gap zone `adjustedGapIndex`.

After splicing, `recalcAllStarts(draft, sectionOrder)` is called inside `setTracks`, and all clips whose `start` changed are PATCHed to the server.

### Drag data — `trackId` requirements

**`BucketClip`** embeds `trackId` in its dnd-kit drag data: `{ clip: {...}, type: 'bucket-clip', trackId }`. `Timeline.handleDragStart` stores it in `activeDragData`. All drop validation (wrong-track rejection, `isInvalidDrop` render, `gapZones` useMemo) uses this `trackId`. The MOCK_SONG instrument-name lookup is a fallback for legacy mock clips only — real API clips always have `trackId` set.

**`TimelineClip`** must also embed `trackId` in its drag data: `{ clip: {...}, type: 'clip', trackId }`. Without it, gap drops and track-row reorders fail silently because `dragData?.trackId` is undefined and the handlers bail early. `trackId` is threaded as a prop: `Timeline` → `TimelineTrack` (passes `trackId={track.id}`) → `SectionCell` (prop `trackId: string`) → `TimelineClip` (prop `trackId?: string`).

`clipSectionName` in `handleDragEnd` is read as `dragData?.clip?.sectionName ?? dragData?.sectionName` — the double path handles real API clips (sectionName at top level of dragData) vs. mock clips (on dragData.clip).

### Stale closure rule

All event handlers registered inside `useEffect(fn, [])` (e.g. `handleRemoveClip`, `handleToggleMute`) must use `setTracks(prev => ...)` and read current state from `prev`, not from the `tracks` variable in the outer closure (which is permanently `[]` in those handlers).

The same problem applies to `sectionOrder`. Handlers inside `useEffect(fn, [])` that call `recalcAllStarts` must use `sectionOrderRef.current` (a ref kept in sync via a separate `useEffect`), not the `sectionOrder` closure variable.

`insertClipInSection` is called from non-stale contexts (recreated on every render), so it can read `sectionOrder` directly from the closure.

### API calls after mutations

Every insert fires a `POST /api/tracks/:trackId/clips` for the new clip, then `PATCH /api/timeline-clips/:id` for every existing clip whose `start` changed. Every remove fires `DELETE` then patches shifted clips. All are fire-and-forget (`.catch(console.error)`).

### Timeline polling and live track sync

The timeline `useQuery` has `refetchInterval: 3000` and an explicit `queryFn` that fetches `/api/songs/${SONG_ID}/timeline`. This means the timeline is always at most 3 seconds out of date when instruments are added or removed from outside the timeline view.

There are two `useEffect`s that sync `apiTracks` into the local `tracks` state:

1. **Initial load** (guarded by `tracksInitialized.current`): runs once on first non-null `apiTracks`, converts and sets the full tracks array, sets `sectionOrder`. After this, `tracksInitialized.current = true` and this branch never runs again.

2. **Live sync** (runs on every `apiTracks` poll): removes any tracks missing from `apiTracks`, syncs clips for existing tracks from the API response, and appends any new tracks. Preserves local `muted`/`solo`/`volume` state. New tracks start with empty clips. Clip sync is needed so that when a section is hidden (which deletes its timeline clips on the server), the timeline removes those clips within 3 seconds without a manual refresh.

**Do not merge the two effects.** The initial-load guard exists to prevent the API response from clobbering clip state that the user has added to the timeline mid-session (before the refetch fires).

---

## Environment Variables

Create a `.env` file in the project root. It is already in `.gitignore`.

```
# Required for SQLite — path to the database file
DATABASE_URL=./patchbay.db

# Required for sessions — generate a random string
SESSION_SECRET=replace-this-with-a-long-random-string

# Set automatically by npm scripts — do not set manually
# NODE_ENV=development
```

---

## Running the App

```bash
# Install dependencies (first time only)
npm install

# Start the development server (runs both Express backend + Vite frontend)
npm run dev
```

The app runs at: **http://localhost:3001**

Both the API (`/api/...` routes) and the frontend are served from port 3001.
Vite proxies API requests in development automatically via `server/vite.ts`.

Port 5000 is used by macOS AirPlay Receiver and cannot be used.

---

## Data Model (Types)

All core TypeScript types are defined in `client/src/lib/daw-data.ts`. This is the
single source of truth for the data model until each entity gets a proper Drizzle schema.

The key entities are:

### Song
The top-level container. Has a name, BPM, an ordered list of sections (e.g. "Intro",
"Verse 1", "Chorus"), and a list of InstrumentFolders.

### InstrumentFolder
One instrument's contribution to a song (e.g. "Drums", "Bass", "Vocals"). Contains
a list of Ideas, one per song section.

### Idea
A song section from a specific instrument (e.g. "Drums — Verse 1"). Contains multiple
Versions (takes/recordings the user has uploaded).

### Clip (Version)
A single uploaded audio file. Has:
- `src` — URL to the audio file
- `duration` — full length of the audio file in seconds (never modified by trim)
- `sectionName` — which section of the song it belongs to
- `isFinal` — whether this version has been marked as complete
- `trimStart` — seconds to skip from the beginning (0 = no left trim); only on `timeline_clips`
- `trimEnd` — cutoff point in seconds (null = no right trim, plays to end); only on `timeline_clips`
- `metadata` — BPM, key, time signature, format, uploaded-by, etc.
- `comments` — timestamped comments left by band members

### ProductionTask
A task in the production tracker. Has status (`todo`, `in-progress`, `complete`, `will-not-play`),
priority, assignee, due date, `instrument`, `sectionName`, and optional comments. One task is
bootstrapped per instrument × section combination using deterministic IDs `task-{trackId}-{sectionIndex}`.

---

## User Roles

PatchBay has three roles:

| Role | Permissions |
|---|---|
| **Band Leader** (admin) | Full read/write on all tracks. Can manage members, assign instruments, set due dates, change any status. |
| **Band Member** (power user) | Full edit rights on their own assigned instrument only. Read-only on others. Can create a personal version of a project. |
| **Engineer/Producer** (viewer) | Read-only. Can comment and @mention. Cannot upload or edit clips. |

When implementing auth or any permission checks, always consult this table.

---

## Core Features & Status

| Feature | Status | Notes |
|---|---|---|
| Dashboard page | ✅ Done | Fully wired to real API; song cards styled as gradient banners (gold chevron, BPM badge); cross-song task list filtered to current user sorted by due date; activity feed polling every 10s |
| SongHome page | ✅ Done | Per-song homepage at `/songs/:songId`; "Resume Last Session" banner (reads `localStorage`); task list filtered to current user with 5-task cap + expand; file browser (MediaBucket); activity feed with deep-link navigation to workspace |
| Workspace page | ✅ UI done | Layout and components complete; timeline is fully persisted to DB; Transport still uses mock data |
| Timeline with drag-and-drop | ✅ Done | Full-track droppable with custom collision detection; gap zones at clip boundaries enable clip reordering within a section; track-row drop snaps leftward drags to index 0, rightward to end; invalid tracks get dark overlay (rgba 0,0,0,0.5) at zIndex 20; valid track shows full-row gold border; MeasuringStrategy.Always + live getBoundingClientRect() in collision function for reliable gap zone hits; no speculative section injection during drag |
| Section header drag-to-reorder | ✅ Done | Separate inner DndContext from clip drag; dragging a section header moves entire column and all clips across all tracks; insertion line shows between columns; recalcAllStarts runs on drop; section headers are sticky (top-8 z-10 bg-[#09090b]) — pin below the ruler on vertical scroll while remaining draggable |
| Right-click context menu (timeline) | ✅ Done | Right-click timeline background → "Clear Timeline" (server checks for finals first; simple dialog if none, enhanced dialog with "Leave Final Clips" / "Clear All" if finals exist); right-click track header → "Remove Instrument" (AlertDialog confirmation); right-click timeline clip → Replace submenu (fetches real bucket versions from `/api/timeline-clips/:id/replacements` on open; confirmation dialog if clip is final; PATCHes name/src/duration/type/color + isFinal:false on select); "Show in File Browser" (dispatches `find-in-bucket` CustomEvent; MediaBucket navigates to matching instrument + section) |
| Media Bucket (file browser) | ✅ Done | Fully wired to real API; fetches bucket from `/api/songs/:id/bucket`; upload persists files to disk + DB; clips draggable to timeline with correct track validation; "Add Section" adds a section idea across all tracks simultaneously; right-click instrument → hides instrument (soft-delete, restorable); right-click section → hides section idea (soft-delete, restorable); "Add Instrument" and "Add Section" dialogs show restore dropdowns when hidden items exist |
| File upload (persist files) | ✅ Done | `POST /api/upload` — multer memory storage, 50MB limit, audio/* filter; writes to `uploads/`; extracts duration via music-metadata (two-attempt with mimetype then without); falls back to 5s if duration < 1; returns `{ url, duration, format, originalFileName }` |
| Transport (play/pause/BPM) | ✅ Done | Pure controls component — dispatches `toggle-play`, `update-bpm`, `toggle-loop`, `update-master-volume` events; no audio logic of its own; dummy CDN audio system removed |
| Production Tracker (Kanban) | ✅ Done | Fully wired to real API; fetches tasks from `/api/songs/:id/production-tasks`; tasks bootstrapped alongside ideas using deterministic IDs `task-{trackId}-{sectionIndex}`; task detail modal with status/assignee/due-date editing (optimistic updates), comment thread with inline edit/delete; bidirectional sync with clip isFinal state; complete cells show final clip name; automatic system comments on status changes; "complete" status is gated — requires a timeline clip or final bucket clip to exist; 400 response shown as destructive toast; cells show human comment count badge from `GET /api/songs/:songId/task-comment-counts`; modal has a gold "Done" button in the footer to close; "Saved" flash indicator appears next to the updated field label for 1500ms after a successful PATCH (driven by `patchTask.onSuccess` inspecting `variables`); "Will Not Play" uses `Ban` icon and `text-red-400/70` with a dark red cell background (`bg-red-950/30`) and inset border glow; auto-opens task modal when `?taskId=` is in the URL (used by activity feed deep links) |
| Activity feed | ✅ Done | Shown on Dashboard (cross-song) and SongHome (per-song); aggregates 4 event types from existing tables — file uploads, clips marked final, clip comments, task comments/status changes; polls every 10s via `refetchInterval`; file uploads: "Jordan added X to Instrument — Section"; mark-final: "Jordan marked X as final" (sourced from task_comments with accurate timestamp); status changes: "Jordan changed status to X — Instrument · Section"; clip comments: "You commented on Instrument · Section"; task comments: "You commented on Instrument · Section task"; rows are deep-link clickable — status-change and task-comment events navigate to `?tab=production&taskId=`, clip-comment events navigate to `?instrument=X&section=Y&clipId=Z&openComments=true`, all other events navigate to `?instrument=X&section=Y`. See Activity Feed architecture section below. |
| Tab URL persistence (Workspace) | ✅ Done | Active tab (`Arrangement` / `Production`) is synced to `?tab=arrangement` or `?tab=production` in the URL. Page refresh restores the correct tab. Implemented in `Workspace.tsx` via wouter's `useLocation`. |
| Export Dialog | ✅ Done | Fully functional; renders timeline via `OfflineAudioContext` (44100Hz stereo); trim-aware — uses `source.start(when, trimStartSecs, trimDuration)` so only the trimmed region renders; WAV export uses inline PCM encoder (RIFF header + interleaved int16 samples); MP3 export uses `@breezystack/lamejs` (ESM-compatible fork); Normalize Audio scales all samples to 0 dBFS before encoding; Export Stems renders each track in isolation and bundles as a zip via `JSZip`; file save uses `showSaveFilePicker` in Chrome/Edge with anchor-download fallback for Safari/Firefox; `AbortError` (user cancelled picker) handled cleanly with no fallback; filename convention: `song_title_MMDDYYYY.format` (slugified, no special chars); stems zip: `song_title_MMDDYYYY_stems.zip`; per-stem files: `song_title_MMDDYYYY_instrument_name.format`; `GET /api/songs/:id/timeline` now returns `{ songName, tracks }` (Timeline.tsx queryFn extracts `tracks` with an Array.isArray guard for backward compat); `Transport` accepts `songId` prop threaded from `Workspace` |
| User auth / login | ❌ Not built | Passport.js is installed |
| Real API endpoints | ✅ Done | Songs CRUD, timeline CRUD, bucket/ideas/clips CRUD, file upload, cross-song tasks, activity feed — all built |
| Database schema | ✅ Built | All tables created via `db:push` |
| Audio hover preview (Media Bucket) | ✅ Done | Hovering a `BucketClip` in `Clip.tsx` plays the clip at 0.7 volume via `new Audio(clip.src)`; mouse leave pauses and resets; unmount cleanup via `useEffect` return. Only `BucketClip` — `TimelineClip` is untouched. No-ops if `clip.src` is null. |
| Audio playback from real files | ✅ Done | Full per-clip audio system in `Timeline.tsx` — see Audio Playback System in Planned Features below |
| Non-destructive clip trim | ✅ Done | Trim handles on timeline clips; `trimStart`/`trimEnd` stored in `timeline_clips`; `clip.duration` never modified; effective duration used throughout layout; `PATCH /api/timeline-clips/:id/trim`; "Reset Trim" context menu item |
| Clip session notes (More Info panel) | ✅ Done | `ClipInfoWindow` in `Clip.tsx` — full comment CRUD (GET/POST/PATCH/DELETE) against `clip_comments` table via `effectiveId = bucketClipId ?? clip.id`; "Add Note" shortcut in both `BucketClip` and `TimelineClip` right-click menus opens the panel and focuses the input via `focusNotes` prop; @ mention autocomplete on the notes input matches the ProductionTracker pattern |
| Timeline clip waveform | ✅ Done | `<canvas>` inside each `TimelineClip`; decoded once via `AudioContext.decodeAudioData`, cached in `decodedBufferRef`; redrawn on trim change and on zoom/resize via `ResizeObserver`; rendered at device pixel ratio for retina sharpness; trim-aware (only the active region is drawn); fails silently |
| Email notifications | ❌ Not built | Spec item for future |
| @mentions (system-wide) | ❌ Not built | @ mention autocomplete exists in clip notes and production tracker comments, but there are no push notifications or @mention feeds yet |
| Video → audio stripping | ❌ Not built | Spec item for future |
| AI trim detection on upload | ❌ Not built | Spec item for future |

---

## API Conventions

All API routes live under `/api/`. Define them in `server/routes.ts`.

Always return JSON. Use standard HTTP status codes. Wrap errors as:
```json
{ "message": "Human-readable error description" }
```

### Implemented endpoints

```
GET    /api/songs                        — list all songs (ordered by createdAt)
GET    /api/songs/:id                    — get a song with nested tracks → ideas → clips
POST   /api/songs                        — create a song; body: { name, bpm?, sections }
PATCH  /api/songs/:id                    — partial update of song metadata
DELETE /api/songs/:id                    — delete a song and all associated data

GET    /api/tasks                        — list all production tasks across all songs; includes
                                           songId and songName fields for cross-song context;
                                           used by Dashboard task widget
GET    /api/activity                     — aggregated activity feed across all songs; returns
                                           ActivityEvent[] sorted by timestamp desc — see
                                           Activity Feed architecture section
GET    /api/songs/:songId/activity       — same as /api/activity but filtered to one song

GET    /api/songs/:id/timeline           — get instrument tracks with their placed timeline clips
                                           auto-bootstraps the default song + tracks if missing
POST   /api/tracks/:trackId/clips        — place a clip on the timeline; body: InsertTimelineClip;
                                           auto-sets isFinal: true if a final bucket clip already
                                           exists for this track+section
PATCH  /api/timeline-clips/:id           — update a placed clip (start position, etc.); also accepts
                                           { isFinal: bool, author? } to mark/unmark the clip as
                                           final — syncs the bucket clip via syncFinalClipFromTimeline,
                                           marks ALL same-name timeline clips on the track final (or
                                           clears them), clears sibling names in the same section,
                                           and updates the linked production task status
PATCH  /api/timeline-clips/:id/trim      — update trim points only; body: { trimStart: number,
                                           trimEnd: number | null }; does not touch isFinal or start;
                                           client calls queryClient.invalidateQueries on success to
                                           push updated trimStart/trimEnd into the tracks state
DELETE /api/timeline-clips/:id           — remove a clip from the timeline
GET    /api/timeline-clips/:id/replacements — returns bucket clips that can replace this timeline clip:
                                              looks up the clip's trackId+sectionName → idea → all
                                              clips for that idea, excluding the one whose name matches
                                              the current clip. Fields: id, name, duration, src,
                                              isFinal, createdAt. Ordered by createdAt asc. Returns []
                                              if clip not found or has no sectionName.
GET    /api/songs/:songId/timeline-has-finals     — returns { hasFinals: boolean }; true if any
                                                    timeline clip with isFinal=true exists for this song
DELETE /api/songs/:songId/timeline-clips/non-final — deletes all non-final timeline clips for the song,
                                                      then recomputes and persists correct start values
                                                      for the remaining final clips → 204

GET    /api/songs/:id/bucket             — full bucket tree: tracks → ideas → clips (active only)
POST   /api/songs/:id/tracks             — create a new instrument track; body: { name }; server
                                           generates id, sets type "audio", color, sortOrder 999;
                                           also creates one idea per DEFAULT_SECTION automatically
DELETE /api/tracks/:trackId              — hide a track (active=false); also deletes its timeline clips
POST   /api/tracks/:trackId/restore      — restore a hidden track (active=true)
GET    /api/songs/:songId/hidden-tracks  — list hidden tracks for a song
POST   /api/tracks/:trackId/ideas        — create an idea (section slot) under a track;
                                           server generates id and defaults sortOrder to 0
PATCH  /api/ideas/:ideaId               — hide an idea (active=false); also deletes timeline clips
                                           for that track+section
POST   /api/ideas/:ideaId/restore        — restore a hidden idea (active=true)
GET    /api/tracks/:trackId/hidden-ideas — list hidden ideas for a track
POST   /api/ideas/:ideaId/clips          — attach a clip record to an idea
PATCH  /api/clips/:clipId               — partial update of a bucket clip; when isFinal: true,
                                           clears isFinal on all sibling bucket clips (same ideaId),
                                           marks ALL same-name timeline clips on the track as final,
                                           and clears sibling timeline clips (same trackId+sectionName,
                                           different name); when isFinal: false, clears all same-name
                                           timeline clips on the track
GET    /api/clips/:clipId/comments       — list comments on a bucket clip (ordered by timestamp asc)
POST   /api/clips/:clipId/comments       — add a comment; body: { author, text }; timestamp set to Date.now()
PATCH  /api/clip-comments/:id            — edit a comment's text; body: { text }
DELETE /api/clip-comments/:id            — delete a comment → 204

POST   /api/upload                       — upload an audio file; multipart fields: file, instrument,
                                           section, ideaId; returns { url, duration, format, originalFileName }

GET    /api/songs/:songId/task-comment-counts      — map of { taskId → count } for human comments
                                                     (excludes author = "System" or "Unknown")

GET    /api/songs/:songId/production-tasks        — list all tasks for a song
PATCH  /api/production-tasks/:id                  — partial update of a task (status, assignee, dueDate, etc.)
GET    /api/production-tasks/:id/comments         — list comments on a task
POST   /api/production-tasks/:id/comments         — add a comment; body: { author, text }
PATCH  /api/task-comments/:id                     — edit a comment's text; body: { text }
DELETE /api/task-comments/:id                     — delete a comment → 204
```

---

## File Uploads

The upload pipeline is fully implemented. Here's how it works end-to-end:

1. **Client** (`MediaBucket.tsx`) — `POST /api/upload` as multipart with fields: `file`, `instrument`, `section`, `ideaId`. On success, immediately fires `POST /api/ideas/:ideaId/clips` to persist the clip record to the DB.
2. **Server** (`server/routes.ts`) — multer uses memory storage (50MB limit, audio/* filter). The handler:
   - Counts existing clips for the idea to assign the next version number
   - Writes the buffer to `uploads/{instrument}_{section}_v{n}.{ext}`
   - Extracts duration via `music-metadata`'s `parseBuffer` — first attempt with mimetype, second without (auto-detect). Falls back to `duration = 5` if result is `< 1`
   - Returns `{ url: '/uploads/...', duration, format, originalFileName }`
3. **Static serving** — `server/index.ts` serves `/uploads` via `express.static` so `<audio src="/uploads/...">` works directly in the browser.

Files are stored in `uploads/` in the project root (git-ignored). Naming convention: `{instrument}_{section}_v{n}.{ext}` where instrument and section are lowercased and spaces replaced with hyphens.

Video stripping (ffmpeg) is not yet implemented — audio-only uploads only for now.

---

## Naming & Branding

- The app is called **PatchBay** — always, everywhere
- Old names ("Song-Weaver-Suite", "Studio Lux", "GoldTrack Studio", "rest-express") have all been replaced. No further renaming needed.
- The wordmark renders as `Patch` (white) + `Bay` (gold) using a `<span className="text-primary">` split. See `Workspace.tsx` line ~53 and `Dashboard.tsx` line ~51.
- The logo icon is a music note (`Music2` from lucide-react) in a gold gradient square
- Primary brand color: `#D4AF37` (gold) — referenced as `text-primary` / `bg-primary` in Tailwind
- Dark background: `#09090b` (near-black)
- Secondary surface: `#181C26` (dark blue-gray)

---

## What To Avoid

- **Do not edit files in `client/src/components/ui/`** — these are auto-generated shadcn components. If a UI component needs customization, wrap it rather than editing it directly.
- **Do not use `any` TypeScript types** — use the interfaces defined in `daw-data.ts` or `shared/schema.ts`.
- **Do not hardcode data in components** — mock data lives in `daw-data.ts`. Real data comes from API calls via TanStack Query. The `CURRENT_USER = 'Jordan'` constant in Dashboard, SongHome, and `storage.ts` is a deliberate temporary placeholder until auth is built — it is marked with `// TODO: replace with real auth user` and should not be replicated to new components.
- **Do not break the existing UI** — the visual design is intentional and represents significant work. Backend changes should not require redesigning pages.
- **Do not add a PostgreSQL dependency** — we are using SQLite. Do not add `pg`, `postgres`, or `neon` packages.
- **Do not reintroduce free clip positioning** — clips on the timeline have no independent position. `clip.start` is always derived by `recalcAllStarts`, never set from a cursor pixel offset or stored as an arbitrary value. This is intentional.
- **Do not add overlap capability to the timeline** — PatchBay is plug-and-play, not a freeform DAW. Clips on the same track cannot overlap under any circumstances. The only valid drop targets are append-to-end or insert-between within a section column.
- **Do not remove Replit-specific vite plugins without updating `vite.config.ts`** — they are conditionally loaded only when `REPL_ID` is set, so they do no harm locally.
- **Do not set `isFinal` on clips or `timeline_clips` outside the established three-entry-point sync** — `PATCH /api/clips/:clipId`, `PATCH /api/timeline-clips/:id`, and `PATCH /api/production-tasks/:id` all cascade `isFinal` changes across bucket clips, timeline clips, and production task status using the same-name rule. A one-off `isFinal` write (direct DB update, ad-hoc route, or storage method call) will silently desync the three tables, leave stale checkmarks on same-name clip instances, and create inconsistent "Complete" task states. Always go through one of the three established entry points. See the "Same-name rule" section under isFinal ↔ task status bidirectional sync.
- **Do not set `trimStart`/`trimEnd` anywhere except `PATCH /api/timeline-clips/:id/trim`** — trim values on `timeline_clips` must only be written via this dedicated route. Setting them inline in `PATCH /api/timeline-clips/:id` or through ad-hoc DB writes bypasses the query-invalidation path that keeps `Timeline.tsx`'s local state in sync (the live-sync effect re-runs `recalcAllStarts` only when trimmed durations arrive via the normal API poll). Also: `clip.duration` must never be modified by trim — it always stores the full file length.

---

## Development Tips for Non-Developers

- **When the terminal says "port already in use":** run `pkill -f tsx` then try `npm run dev` again.
- **When TypeScript shows red underlines in VS Code:** this is usually a type error. Ask Claude Code to fix it before running.
- **The app auto-reloads** when you save a file — you don't need to restart `npm run dev` after most changes.
- **Server changes** (anything in `server/`) require the dev server to restart. Stop it with `Ctrl+C` and run `npm run dev` again.
- **If the page shows a blank screen**, open the browser console (right-click → Inspect → Console tab) and copy the red error text for Claude Code.
- **If the Vite cache gets stale** (e.g. after adding a new npm dependency to a component for the first time): stop the server, run `rm -rf node_modules/.vite`, then `npm run dev` again.
- **The dev server must be running** for the app to work. If you close the terminal it stops. Run `npm run dev` to restart it.

## If the App Goes Down

The app at `http://localhost:3001` can go offline after certain changes. Here's how to diagnose and fix it quickly.

### Step 1 — Check the terminal
Look at the VS Code terminal where `npm run dev` is running. The cause is almost always visible there as a red error message. Common ones:

- **`SyntaxError` or `TypeError`** — a code change introduced a bug that crashed the server. Share the red error text with Claude Code and ask it to fix it.
- **`EADDRINUSE: address already in use`** — a previous server process didn't shut down cleanly. Run `pkill -f tsx` then `npm run dev` again.
- **`Cannot find module`** — a new file or function was referenced before being created. Share the error with Claude Code.

### Step 2 — Restart the server
If the terminal looks frozen or shows no output, stop it with `Ctrl+C` and run:
```bash
npm run dev
```

### Step 3 — Hard refresh the browser
If the server is running but the browser shows a blank page or stale content, try `Cmd+Shift+R` in Safari to force a full reload bypassing the cache.

### When to ask Claude Code to verify
Claude Code should confirm the app is running after any change to:
- `server/index.ts` or `server/routes.ts`
- `vite.config.ts`
- `package.json` (adding or removing packages)
- `shared/schema.ts` (database schema changes)

For frontend-only changes (components, styles, pages), a server restart is not needed — Vite hot-reloads these automatically.

---

## Planned Features & Extensibility Notes

These are features that have been deliberately designed for future extension. When building them, follow the guidance here rather than starting from scratch.

### Audio playback system — ✅ Built

Real per-clip audio playback is handled entirely in `Timeline.tsx`. `Transport.tsx` is a pure controls component — it only dispatches CustomEvents and displays state. No audio logic lives in Transport.

**Key refs in `Timeline.tsx`:**
- `customAudioRefs` — `{ [clipId: string]: HTMLAudioElement }`. One `Audio` object pre-created per clip as clips appear in `tracks`. Set `audio.preload = 'auto'` so the browser buffers ahead of play. Created in a `useEffect` on `tracks`; only adds new entries, never overwrites existing ones.
- `pendingPlayRef` — `Set<string>` of clip IDs whose `.play()` Promise is still resolving. Guards against calling `.play()` again before the previous call settles, which would throw `AbortError`.
- `audioCtxRef` — persistent `AudioContext | null`. Used solely to unlock Safari's audio pipeline; not used to route audio. Closed when playback stops.
- `masterVolumeRef` — `number`, initialized to `0.8` (matching the Transport slider's default of 80). Updated by a `useEffect` listening for `update-master-volume` events (`e.detail.volume / 100`). The listener also immediately applies the new volume to all currently-playing elements in `customAudioRefs`. The rAF loop multiplies per-track volume by this ref: `audio.volume = (track.volume / 100) * masterVolumeRef.current`.

**Playhead position model:**
`playheadPositionState` (and `playheadRef`) store the playhead in **content-space pixels**: `256 + timeInSeconds * zoom`. The playhead DOM element is rendered *outside* the scrollable `timelineRef` container (it is a sibling of it, both inside the `position: relative` outer timeline div). Because of this, the rendered `left` must subtract the scroll offset: `left: ${playheadPositionState - timelineScrollLeft}px`. A `useEffect(fn, [])` registers a passive `scroll` listener on `timelineRef` to keep `timelineScrollLeft` state in sync — this triggers a re-render when the user scrolls while paused (during playback, `setPlayheadPositionState` fires every frame anyway). `handlePlayheadPointerDown` correctly adds `timelineRef.current.scrollLeft` when converting pointer clientX to content-space position. Do not position the playhead element *inside* the scrollable content — it would scroll away with the content.

**Animation loop:**
The `requestAnimationFrame` loop runs while `isPlaying === true`. Each frame:
1. Advances the playhead by `delta * zoom` pixels (zoom is pixels/second).
2. Computes `playheadTime` in seconds from the pixel position.
3. For each clip in `tracks`: if `playheadTime ∈ [clip.start, clip.start + effectiveDuration)` (where `effectiveDuration = (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)`), calls `audio.play()` guarded by `pendingPlayRef`, and sets `volume`, `muted`, and `playbackRate` every frame. When playback starts, `audio.currentTime` is set to `clip.trimStart ?? 0` so the audio begins at the trimmed in-point.
4. If the clip is out of range and not paused, calls `audio.pause()`.

**Safari AudioContext unlock:**
Safari requires `AudioContext.resume()` to be called synchronously within a user gesture window. The rAF loop fires asynchronously — outside that window — so raw `audio.play()` from the loop has a ~0.5s delay.

Fix: `Timeline.tsx` listens to the `toggle-play` CustomEvent synchronously. `Transport.tsx` dispatches this event synchronously from the play button click handler and the spacebar handler. When `isPlaying: true` arrives in that synchronous listener, `Timeline.tsx` immediately calls `audioCtxRef.current.resume()` — still within the gesture window. The `audio.play()` calls that happen frames later then run without delay.

When `isPlaying` becomes `false`: all audios are paused, `pendingPlayRef` is cleared, `audioCtxRef.current?.close()` is called, and `audioCtxRef` is set to `null`.

**Stale audio on clip replace — `clip-replaced` CustomEvent:**
When a timeline clip is replaced via `PATCH /api/timeline-clips/:id` (from the Replace submenu in `Clip.tsx`), the old `HTMLAudioElement` in `customAudioRefs` still holds the old `src` and will keep playing. Fix: `Clip.tsx` dispatches `clip-replaced` with `{ clipId }` after a successful PATCH. `Timeline.tsx` listens for this event (in a `useEffect(fn, [])`, so `customAudioRefs.current` is never stale) and pauses + removes the old element. The pre-create `useEffect` then creates a fresh `Audio` for the new `src` when `tracks` updates after the query refetch.

**Do not:**
- Move audio playback logic into `Transport.tsx` — it belongs in `Timeline.tsx` where clip positions are known.
- Call `audio.play()` outside the rAF loop without checking `pendingPlayRef` — overlapping play/pause calls throw `AbortError`.
- Create a new `AudioContext` per clip or per play call — one persistent `audioCtxRef` per play session is correct.
- Remove the `toggle-play` listener in `Timeline.tsx` that calls `audioCtxRef.current.resume()` — it is the Safari unlock and must remain synchronous with the gesture.
- Modify the pre-create `useEffect` to detect src changes via URL comparison — `audio.src` is an absolute URL while `clip.src` is a relative path; use the `clip-replaced` event instead.

### Non-destructive clip trim — ✅ Built

Timeline clips have left and right trim handles that physically resize the clip container without modifying `clip.duration`. `clip.duration` always stores the full file length; trim state is held in `trimStart` (seconds to skip from the start, default 0) and `trimEnd` (cutoff point in seconds, `null` = play to end), both stored in the `timeline_clips` DB table.

**UI — `TimelineClip` in `Clip.tsx`:**
- Gold 8px-wide handles render at `left: 0` and `right: 0` on hover (`isHovered` state, driven by `onMouseEnter`/`onMouseLeave` on the clip container)
- `displayWidth = ((trimEnd ?? clip.duration) - trimStart) * zoom` — the clip container's `width` is set to this value; the `left` position stays fixed at `(clip.start - sectionStart) * zoom` so the clip never shifts horizontally during a left-handle drag
- Drag is captured with `window.addEventListener('pointermove'/'pointerup')` (no `setPointerCapture`) to avoid conflicts with dnd-kit sensors. `e.nativeEvent.stopImmediatePropagation()` on `pointerdown` prevents dnd-kit from starting a drag
- `isTrimDragging` ref gates the `positionStyle` so dnd-kit's `style` prop (transform) is suppressed during trim drag
- Local `trimStart`/`trimEnd` state is updated on every `pointermove` frame; `patchTrim` fires on `pointerup`
- On every `pointermove` frame, `Clip.tsx` also dispatches a `trim-preview` CustomEvent: `{ clipId, trimStart, trimEnd }`. `Timeline.tsx` listens in a zero-dep `useEffect` and calls `setTracks(prev => recalcAllStarts(...))` with `sectionOrderRef.current` — so neighboring clips reflow in real time during drag without waiting for the server PATCH
- A `useEffect` syncs `trimStart`/`trimEnd` from the prop whenever the API refetches (so a live-sync poll doesn't clobber active drag state — the effect only runs when the clip is not being dragged)
- "Reset Trim" appears in the right-click context menu when `trimStart > 0 || trimEnd !== null`

**API — `PATCH /api/timeline-clips/:id/trim`:**
Accepts `{ trimStart: number, trimEnd: number | null }`. Validates both fields. Calls `storage.updateTimelineClip`. Does not touch `isFinal` or `start`. On success, `patchTrim` in `TimelineClip` calls `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` to push the new trim values into the tracks state so the rAF loop and live-sync effect see them immediately.

**Layout — effective duration everywhere:**
`computeSectionLayout`, `recalcAllStarts`, the mute-state range check, and the `DragOverlay` width all use `(clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)` instead of raw `clip.duration`. This ensures section columns expand/contract to match the audible content, not the raw file length.

**Live-sync fix:**
After a trim PATCH, the server's `start` values for sibling clips may be stale (they were computed before the trim change). The live-sync `useEffect` in `Timeline.tsx` calls `recalcAllStarts(merged, sectionOrderRef.current)` at the end of its `setTracks` callback to recompute all positions from the fresh trim values.

**New and replaced clips always start untrimmed:**
`insertClipInSection` explicitly sets `trimStart: 0, trimEnd: null` on every new clip it creates and in the `POST /api/tracks/:trackId/clips` body. Spreading from the bucket clip drag data is not sufficient because bucket clips don't carry these fields. `performReplace` in `TimelineClip` also explicitly sends `trimStart: 0, trimEnd: null` in its `PATCH /api/timeline-clips/:id` body — the general PATCH route is a partial update and would otherwise preserve the original clip's trim values on the replacement.

**Export:**
`ExportDialog.tsx` passes trim to the `OfflineAudioContext` via `source.start(when, trimStartSecs, trimDuration)` where `trimDuration = (clip.trimEnd ?? decoded.duration) - trimStartSecs`. The total export duration also uses effective trimmed durations so silence is not rendered past the trim out-point.

### Audio hover preview (Media Bucket) — ✅ Built

Implemented in `BucketClip` (`Clip.tsx`). On `onMouseEnter`, creates `new Audio(clip.src)`, sets `volume = 0.7`, and calls `.play()` (wrapped in try/catch for blocked autoplay). On `onMouseLeave`, pauses and nulls the ref. A cleanup `useEffect` pauses on unmount. No-ops if `clip.src` is falsy.

**Three-layer defense against unwanted playback:**
1. `isRightClicking` ref — set in `onContextMenu`, checked in `handleMouseEnter`; prevents audio starting when the user right-clicks
2. `contextMenuOpen` state — checked in `handleMouseEnter`; also used in `ContextMenu onOpenChange` to stop any currently-playing audio the moment the context menu opens
3. `onContextMenu` → sets `isRightClicking = true`; `onMouseLeave` resets it after 100ms to avoid race with the context menu opening

**Not in `MediaBucket.tsx`** — all audio logic lives entirely in `BucketClip`. Do not move it to MediaBucket or duplicate it on the version row wrapper there.

**`isFinal` persistence** — "Mark as Final" in the `BucketClip` context menu calls `PATCH /api/clips/:clipId` with `{ isFinal, author: 'Unknown' }`. Local state is optimistically updated and reverted on API failure. A `useEffect` syncs `isFinal` from the prop whenever the bucket query refetches: `useEffect(() => { setIsFinal(clip.isFinal ?? false); }, [clip.isFinal])`. This prevents stale local state after the bucket cache is invalidated.

On success, `BucketClip` invalidates three query keys: `['bucket', 'patchbay-default']`, `['production-tasks', 'patchbay-default']`, and `['final-clips', 'patchbay-default']`.

**Sibling-final confirmation dialog** — before marking a clip final, `BucketClip` checks `siblingClips.some(c => c.id !== clip.id && c.isFinal)`. If a sibling is already final, it shows a shadcn `AlertDialog` ("Change Final Version?") before proceeding. `siblingClips` is passed as a prop from `MediaBucket` via `siblingClips={selectedIdea.clips.map(toClip)}`. The actual API call is extracted into `executeMark(newIsFinal)` so both the direct path and the dialog confirm path call the same logic.

**Timeline clip removal guard** — `TimelineClip` shows a shadcn `AlertDialog` ("Remove Final Clip?") when a user selects "Remove Clip" from the context menu and `isFinal === true`. The clip is only deleted after the user confirms. This is managed via a `showRemoveConfirm` state in `TimelineClip`.

**Auto-isFinal on timeline clip placement** — `POST /api/tracks/:trackId/clips` checks whether a final bucket clip exists for the same `trackId + sectionName`. If one exists, the newly placed timeline clip is immediately set to `isFinal: true`. This keeps the timeline checkmark in sync when clips are placed after a version has already been marked final in the bucket.

If adding a progress indicator in the future, extend `BucketClip` — the `audioRef` is already available. Waveform visualization is implemented on `TimelineClip` only — see Timeline clip waveform section.

### Media Bucket — "Add Section"

Hovering over the Sections header in `MediaBucket.tsx` reveals a `+` button that opens a Dialog. Submitting fires `POST /api/tracks/:trackId/ideas` for **all five tracks simultaneously** via `Promise.all`, then invalidates the bucket query. This ensures every instrument always has a slot for every section.

**User-added sections always appear at the bottom of the sections list.** This is enforced at every layer:
- The mutation sends `sortOrder: track.ideas.length + i`, which is always higher than all existing idea sortOrders for that track
- `getBucket` in `storage.ts` orders ideas by `asc(ideas.sortOrder)` before returning them
- MediaBucket renders ideas in the order the API returns them — no client-side re-sort

Do not change this to alphabetical or insertion-point ordering without discussion. Append-to-bottom is the intentional UX.

### Media Bucket — hidden-tracks query invalidation

The `hiddenTracks` useQuery (key: `['hidden-tracks', DEFAULT_SONG_ID]`) has `enabled: isAddInstrumentOpen` so it only runs when the Add Instrument dialog is open. It also has `refetchOnMount: true` and `refetchOnWindowFocus: false` — this ensures it always fetches fresh data when the dialog opens, even if the cache was previously populated.

**Two places must invalidate this key** whenever an instrument is soft-deleted (hidden):
1. `deleteTrackMutation.onSuccess` in `MediaBucket.tsx` — triggered when the user removes an instrument from the bucket panel's right-click menu
2. `handleDeleteTrack` in `Timeline.tsx` — triggered when the user removes an instrument from the timeline track header right-click menu

Both fire `queryClient.invalidateQueries({ queryKey: ['hidden-tracks', SONG_ID] })`. If either is missing, the restore dropdown in the Add Instrument dialog will show stale data until a manual page refresh.

### Media Bucket — session persistence

`MediaBucket.tsx` persists the last selected instrument and section idea to `localStorage` under keys `patchbay-selected-track-${songId}` and `patchbay-selected-idea-${songId}` (scoped per song). On mount, a one-time restore effect (guarded by a `sessionRestored` ref) reads these keys and restores the selection before falling back to URL param logic. The guard ensures the restore only runs once — it does not re-run on subsequent bucket refetches, preventing the selection from snapping back on poll.

**Song name in MediaBucket header** — The "Project: …" label in MediaBucket's header uses `useQuery(['song', songId])` to fetch the song name dynamically. In the SongHome context, this cache entry is already warm (SongHome fetches the same key). In the Workspace context, it makes one small fetch. Never hardcode the song name here.

**URL param priority** — On fresh mount, `MediaBucket` checks for `?instrument=`, `?section=`, `?clipId=`, and `?openComments=` query params before falling back to localStorage. `instrument` + `section` navigate the three-column browser to the right idea. `clipId` + `openComments=true` (both must be present) set `autoOpenClipId` state, which causes the matching `BucketClip` to auto-open its More Info modal with the comment input focused. All four params are read in the same one-shot session restore `useEffect` so they resolve atomically on the first bucket data load.

**Why activity feed links navigate to `/workspace` not `/songs/:songId`** — The `sessionRestored` ref is a one-shot guard. If the user is already on SongHome and clicks an activity row that would just change the URL params on the same page, the guard has already fired and will not re-run. Navigating to `/songs/:songId/workspace` ensures MediaBucket is always a fresh component mount, so the URL param restore logic runs cleanly. Never use the `find-in-bucket` CustomEvent for activity-feed navigation — that path is for within-workspace navigation only (e.g. "Show in File Browser" from a timeline clip right-click).

### isFinal ↔ task status bidirectional sync

Marking a clip as final and changing a task's status are kept in sync automatically. There are **three entry points**, all handled in `server/routes.ts`.

#### Same-name rule (applies at all three entry points)

**Same name = same version.** If two timeline clips on the same track have the same `name`, they are the same recording placed twice. Marking one final must mark ALL of them final — regardless of which section they sit in.

**Sibling rule.** Only one version name per section per instrument can be final. When a name is marked final, all clips with a *different* name on the same `trackId + sectionName` are cleared. This is independent of the same-name rule — both run together on every `isFinal: true` write.

**Unmarking** follows the same-name rule in reverse: clearing `isFinal` on one timeline clip clears it on every clip with the same `trackId + name`.

These rules apply from all three entry points. Never write `isFinal` outside the three entry points or the rules will be silently bypassed.

**Entry point 1 — bucket clip marked final (`PATCH /api/clips/:clipId`)**

When `isFinal === true`:
- Clears `isFinal` on all sibling bucket clips in the same idea (`ideaId`, different `id`)
- Sets `isFinal: true` on ALL `timelineClips` where `trackId` matches AND `name` matches (same-name rule)
- Clears `isFinal` on all `timelineClips` where `trackId + sectionName` matches AND `name` does NOT match (sibling rule)
- If the linked task is not already "complete": walks clip → idea → track → `storage.getTaskByInstrumentSection`, calls `storage.updateTask(task.id, { status: "complete" })`, and logs `Clip marked as final: "{clip.name}"`

When `isFinal === false`:
- Clears `isFinal` on ALL `timelineClips` where `trackId` matches AND `name` matches
- If the task is currently "complete": sets task to `"in-progress"` and logs `Clip unmarked as final: "{clip.name}". Status reverted to In Progress.`

**Entry point 2 — timeline clip marked final (`PATCH /api/timeline-clips/:id`)**

`TimelineClip.handleMarkFinal` in `Clip.tsx` sends `PATCH /api/timeline-clips/:id` with `{ isFinal, author: 'Unknown' }`.

The route strips only `author` from the body before passing the remainder to `storage.updateTimelineClip`. If `clipUpdates` is empty after stripping, the route fetches the clip directly instead of calling `.set({})` on an empty object (which would throw a Drizzle error).

When `isFinal === true`, the route:
1. Calls `storage.syncFinalClipFromTimeline(clip.trackId, clip.sectionName, clip.name, isFinal)` to persist to the bucket
2. Sets `isFinal: true` on ALL `timelineClips` where `trackId` matches AND `name` matches (same-name rule)
3. Clears `isFinal` on all `timelineClips` where `trackId + sectionName` matches AND `name` does NOT match (sibling rule)
4. Looks up the track via `clip.trackId`, then calls `storage.getTaskByInstrumentSection` to find the task
5. Applies the same complete/revert logic and comment as entry point 1

When `isFinal === false`, the route:
1. Calls `storage.syncFinalClipFromTimeline` to clear the bucket clip
2. Clears `isFinal` on ALL `timelineClips` where `trackId` matches AND `name` matches
3. Applies the same task revert logic as entry point 1

On success, `TimelineClip.handleMarkFinal` invalidates: `['production-tasks', songId]`, `['final-clips', songId]`, `['bucket', songId]`, `['/api/songs/${songId}/timeline']`, `['activity']`.

**`syncFinalClipFromTimeline(trackId, sectionName, clipName, isFinal)`** (in `storage.ts`):
- Looks up the idea via `trackId + sectionName`
- Fetches all clips for that idea
- If `isFinal: true`: clears `isFinal` on all sibling clips first, then sets `isFinal = true` on the clip whose name matches `clipName` (falls back to the most recently created clip if no exact match)
- If `isFinal: false`: clears `isFinal` on any currently-final clip for that idea whose name matches `clipName`

**Entry point 3 — task manually set to "complete" (`PATCH /api/production-tasks/:id`)**

See "Complete status guard" section below.

**Task changed away from "complete" → clip unmarked**

In `PATCH /api/production-tasks/:id`, when `status` changes away from `"complete"` and the previous status was `"complete"`:
1. Call `storage.getFinalClipForTask(task.instrument, task.sectionName, task.songId)` — three sequential DB lookups: track by songId+name → idea by trackId+sectionName → clip where isFinal=true
2. If found, call `storage.updateClip(clip.id, { isFinal: false })`
3. Call `storage.addTaskComment()` with text: `Clip unmarked as final: "{clip.name}". Status changed to {new status label}.`

**Author field**

All three PATCH routes accept an optional `author` field in `req.body`. It is destructured out before passing updates to storage (so it never reaches Drizzle's `.set()`). Used as the comment author, falling back to `"Unknown"`. The frontend sends `'Unknown'` for all patches — a uniform placeholder until auth is built. Do not use `task.assignee` as the author.

**Change comment logging (manual)**

`PATCH /api/production-tasks/:id` always fetches the pre-update task (unconditional PK lookup) so it can diff every field. After `updateTask()` succeeds, three independent fire-and-forget comment blocks run:

- **Status** — if `req.body.status` differs from previous: `"Status changed to To Do"` / `"Status changed to In Progress"` / `"Status changed to Complete"` / `"Status changed to Will Not Play"`
- **Assignee** — if `'assignee' in req.body` and value differs from previous: `"Assignee set to {name}"` or `"Assignee removed"`
- **Due date** — if `'dueDate' in req.body` and value differs from previous: `"Due date set to {date}"` or `"Due date removed"`

All three use `'in taskUpdates'` checks (not truthiness) to distinguish "field was sent as empty" from "field was not sent at all".

### Complete status guard

`PATCH /api/production-tasks/:id` enforces a rule when `status === "complete"`: at least one of these conditions must be true or the request is rejected with 400.

**Condition A** — a clip exists in the timeline for this instrument+section (query `timelineClips` joined to `instrumentTracks` by trackId, filtered by `instrumentTracks.name = task.instrument`, `instrumentTracks.songId = task.songId`, `timelineClips.sectionName = task.sectionName`). Storage method: `getTimelineClipForTask(instrument, sectionName, songId)`.

**Condition B** — a bucket clip with `isFinal = true` exists for this instrument+section. Storage method: `getFinalClipForTask(instrument, sectionName, songId)`.

If **neither** passes → `400 { message: "Cannot mark as complete — no clip in the timeline or marked as final for this instrument and section." }`

If **A passes but B does not** (clip on timeline, nothing yet marked final in bucket) → the route auto-promotes a bucket clip to final:
1. Looks up the track → idea → first clip for that idea
2. Calls `storage.updateClip(bucketClip.id, { isFinal: true })`
3. Calls `storage.updateTimelineClip(timelineClipForTask.id, { isFinal: true })` to sync the timeline clip
4. Clears `isFinal` on all other timeline clips with the same `trackId + sectionName`
5. Logs `Clip marked as final: "{bucketClip.name}"` as a session note
6. Then proceeds with `updateTask()` as normal

If **B passes** (final clip already exists) → proceeds directly with `updateTask()`.

The guard runs **before** `updateTask()` is called, so a rejected request makes no DB changes.

**Frontend** — `CellModal.patchTask.mutationFn` throws on non-OK responses. `onError` calls `useToast()` with `variant: 'destructive'` and the server's message. The optimistic update is rolled back via `context.prev`. `<Toaster />` is mounted in `App.tsx` at the app root.

**`['final-clips', 'patchbay-default']` query key**

`ProductionTracker` subscribes to this key via a `useQuery` that fetches `/api/songs/${SONG_ID}/bucket` and derives a `finalClipsMap: Record<"${instrument}__${sectionName}", clipName>`. Complete cells in the grid show the actual final clip name from this map (falling back to `task.title`). The key is invalidated by both `BucketClip.handleToggleFinal` and `CellModal.patchTask.onSettled`, causing the grid to update instantly.

`patchTask.onSettled` in `CellModal` invalidates: `['production-tasks', SONG_ID]`, `['task-comments', task.id]`, `['final-clips', 'patchbay-default']`, `['bucket', 'patchbay-default']`, and `['/api/songs/patchbay-default/timeline']` (so the timeline checkmark updates within the next poll cycle).

### Clip session notes (More Info panel) — ✅ Built

`ClipInfoWindow` in `Clip.tsx` is the shared "More Info" dialog for both `BucketClip` and `TimelineClip`. It shows clip metadata stats and a full comment thread backed by the `clip_comments` table.

**`bucketClipId` prop and `effectiveId`:**
`clip_comments` rows reference `clips.id` (bucket clip IDs), never `timeline_clips.id`. When `TimelineClip` opens the panel, it must resolve the bucket clip ID from the TanStack Query cache:
```ts
const bucketData = queryClient.getQueryData<any[]>(['bucket', 'patchbay-default']);
const track = bucketData?.find((t: any) => t.id === trackId);
const idea = track?.ideas?.find((i: any) => i.sectionName === clip.sectionName);
const bucketClipId = idea?.clips?.find((c: any) => c.name === clip.name)?.id;
```
This is synchronous — no extra API call — because the bucket query is always warm. `ClipInfoWindow` then uses `effectiveId = bucketClipId ?? clip.id` for all comment API calls. `BucketClip` always passes `bucketClipId={clip.id}` directly.

**`focusNotes` prop:**
Both `BucketClip` and `TimelineClip` have a `focusNotes` state that is set to `true` when "Add Note" is selected from the context menu and reset to `false` when the dialog closes. `ClipInfoWindow` receives this as a prop and triggers `setTimeout(() => noteInputRef.current?.focus(), 150)` inside `useEffect([open, focusNotes])`.

**Comment CRUD:**
- `GET /api/clips/:clipId/comments` — fetched by `useQuery(["clip-comments", effectiveId])` with `enabled: open`
- `POST /api/clips/:clipId/comments` — `{ author: 'Unknown', text }` — invalidates the query key on success
- `PATCH /api/clip-comments/:id` — inline edit; Input shown in place of the comment text on click of pencil icon
- `DELETE /api/clip-comments/:id` — immediate, no confirmation

**@ mention autocomplete:**
Matches the ProductionTracker pattern exactly. `BAND_MEMBERS` is a module-level constant in `Clip.tsx`. `handleNoteChange` detects `/@(\w*)$/` behind the cursor and sets `mentionQuery`. `handleNoteKeyDown` handles ArrowUp/Down/Enter/Escape. The dropdown renders as an absolutely-positioned div below the Input, with colored avatar initials using `avatarColor(name)` (returns a hex string — use `style={{ backgroundColor }}`, not a CSS class). `onMouseDown + e.preventDefault()` on each dropdown item prevents the Input from blurring before the click registers.

**`avatarColor` returns hex, not a CSS class** — unlike `ProductionTracker` where the avatar helper may return a Tailwind class, `Clip.tsx`'s `avatarColor` returns a hex string. Dropdown avatar divs must use `style={{ backgroundColor: avatarColor(name) }}` with `text-black`, not a className.

### Timeline clip waveform — ✅ Built

Each `TimelineClip` in `Clip.tsx` renders a `<canvas>` waveform over its clip background. The waveform is decoded once and cached; redrawing on trim change or zoom is cheap (no re-fetch).

**Key refs in `TimelineClip`:**
- `canvasRef` — `HTMLCanvasElement | null`. The canvas is `position: absolute; top: 0; left: 0; width: 100%; height: 100%` with `zIndex: 2` — above the clip color background, below the `z-10` label and `z-20` trim handles.
- `decodedBufferRef` — `AudioBuffer | null`. Populated once after the first fetch+decode. All subsequent redraws (trim, zoom) read from this ref — no re-fetch or re-decode.
- `drawRef` — `(() => void) | null`. Reassigned in the component body on every render, so it always closes over the current `trimStart`, `trimEnd`, and `clip.duration`. The `ResizeObserver` and trim `useEffect` both call `drawRef.current?.()` with no stale-closure risk.

**Three effects:**
1. **Decode effect** `[clip.src, isOverlay]` — fetches the audio file, decodes via `AudioContext.decodeAudioData()` (channel 0 only), stores the buffer in `decodedBufferRef`, then calls `drawRef.current?.()`. Skipped for overlay clips. Fails silently. Cancellation flag prevents stale writes after unmount.
2. **Trim redraw effect** `[trimStart, trimEnd, clip.duration]` — calls `drawRef.current?.()`. Buffer is already cached; redraw is a pure canvas operation.
3. **Resize effect** `[]` — attaches a `ResizeObserver` to the canvas and calls `drawRef.current?.()` on every size change (fires on zoom-in/out since the clip container width tracks `displayWidth`).

**Draw function (`drawRef.current`):**
- Reads `canvas.offsetWidth` / `canvas.offsetHeight` for current CSS pixel dimensions.
- Applies device pixel ratio: `canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr)` — renders at physical pixel resolution, displays at CSS size.
- Slices `buffer.getChannelData(0)` to the trimmed region: `[trimStart * sampleRate, (trimEnd ?? duration) * sampleRate)`.
- Iterates one column per CSS pixel, finds min/max sample in each slice, draws a vertical `fillRect` centered at `midY`. Minimum bar height: 1px (for silence).
- Color: `rgba(0, 0, 0, 0.4)` — semi-transparent dark over the clip color.

**`isOverlay` guard:** The decode effect returns early for overlay (drag ghost) clips. No waveform fetch is initiated during drag.

**Do not** add waveform rendering to `BucketClip` — bucket clips use hover audio preview instead (see Audio hover preview section).

### Activity feed — ✅ Built

The activity feed aggregates recent events across the app into a unified timeline. It lives in `server/storage.ts` as `getActivity(songId?: string)` and is exposed via two routes.

**`ActivityEvent` interface (in `storage.ts`):**
```ts
interface ActivityEvent {
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change';
  description: string;
  timestamp: number;
  songId: string;
  songName: string;
  instrument?: string;
  sectionName?: string;
  taskId?: string;
  // present on clip-comment and task-comment events for differentiated routing
  source?: 'clip' | 'task';
  clipId?: string;
}
```

**Four event types and their sources:**

1. **`file-added`** — one event per `clips` row (joined through `ideas → instrument_tracks → songs`). Description: `"Jordan added {clipName} to {trackName} — {sectionName}"`. Timestamp: `clip.createdAt`.
2. **`marked-final`** — from `task_comments` rows where `text.startsWith('Clip marked as final:')`. Clip name is extracted from the text: `'Clip marked as final: "Guitar 2 Verse 1 V2"'` → `"Jordan marked Guitar 2 Verse 1 V2 as final"`. Timestamp is accurate (the moment the user marked it final, not the upload time). Includes `taskId` for potential deep-linking.
3. **`clip-comment`** — from `clip_comments` (joined through `clips → ideas → instrument_tracks → songs`). `author = 'Unknown'` renders as `"You"`. Description: `"You commented on {trackName} · {sectionName}"`. Includes `source: 'clip'` and `clipId`.
4. **`task-comment` / `status-change`** — from `task_comments` (joined through `production_tasks → songs`). Routed by text pattern, not by `author`:
   - `text.startsWith('Status changed to ')` → `status-change`: `"Jordan changed status to {label} — {instrument} · {sectionName}"`. Catches both new `author='System'` records and legacy `author='Unknown'` records.
   - `text.startsWith('Clip marked as final:')` → `marked-final` (see above).
   - `author === 'System'` (any other text, e.g. assignee/due-date changes, "Clip unmarked as final") → silently skipped; these are audit trail, not activity feed material.
   - All other comments → `task-comment`: `"You commented on {instrument} · {sectionName} task"`. Includes `source: 'task'` and `taskId`.

**Implementation note — system vs user comments:** Status-change and mark-final comments in `task_comments` are written with `author: 'System'` by the server. The activity feed routes them by text pattern so that new system comment types can be added to routes.ts without accidentally bleeding into the `status-change` bucket. Never use the request body's author for system-generated comments.

**JS-level merge, no SQL UNION:** Each event type is fetched with a separate Drizzle query and merged into a single `events[]` array in JavaScript, then sorted by `timestamp` descending. No SQL UNION needed.

**Frontend queries:**
```ts
// Dashboard — cross-song
useQuery({ queryKey: ['activity'], queryFn: () => fetch('/api/activity').then(r => r.json()), refetchInterval: 10000 })

// SongHome — per-song
useQuery({ queryKey: ['activity', songId], queryFn: () => fetch(`/api/songs/${songId}/activity`).then(r => r.json()), refetchInterval: 10000 })
```

**TanStack Query invalidation:** `queryClient.invalidateQueries({ queryKey: ['activity'] })` uses prefix matching — it invalidates both `['activity']` (Dashboard) and `['activity', songId]` (SongHome) simultaneously. This call should be added to the `onSuccess` of any mutation that creates activity-feed-visible data (uploads, status changes, comments). Check `routes.ts` when adding new mutations.

**Hardcoded current user:** `CURRENT_USER = 'Jordan'` appears in three places with `// TODO: replace with real auth user`:
1. `server/storage.ts` — used to attribute file-added and status-change descriptions
2. `client/src/pages/Dashboard.tsx` — used to filter the task list
3. `client/src/pages/SongHome.tsx` — used to filter the task list

When auth is built, replace all three with the real authenticated user.

**Deep-link navigation from activity rows:**

```ts
function activityUrl(songId: string, event: ActivityEvent): string {
  const base = `/songs/${songId}/workspace`;
  if (event.type === 'status-change' && event.taskId)
    return `${base}?tab=production&taskId=${event.taskId}`;
  if (event.type === 'task-comment' && event.source === 'task' && event.taskId)
    return `${base}?tab=production&taskId=${event.taskId}`;
  if (event.type === 'clip-comment' && event.source === 'clip' && event.instrument && event.sectionName) {
    const params = new URLSearchParams({
      instrument: event.instrument,
      section: event.sectionName,
      ...(event.clipId ? { clipId: event.clipId } : {}),
      openComments: 'true',
    });
    return `${base}?${params}`;
  }
  if (event.instrument && event.sectionName)
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  return `/songs/${songId}`;
}
```

- **`status-change`** and **`task-comment`** events open the workspace Production tab with the task modal auto-opened (ProductionTracker reads `?taskId=` from the URL on mount).
- **`clip-comment`** events open the workspace File Browser navigated to the matching instrument + section, then automatically open the More Info / inspection modal for the specific clip with the notes input focused. See `autoOpenInfo` prop below.
- All other events (`file-added`, `marked-final`) open the workspace File Browser via `?instrument=` + `?section=`.

**`autoOpenInfo` — clip inspection modal auto-open:**

`MediaBucket` reads `clipId` and `openComments` from the URL params inside the session restore `useEffect` (the same one-shot effect that resolves `instrument` and `section`). If both are present, it sets `autoOpenClipId` state and passes `autoOpenInfo={clip.id === autoOpenClipId}` to the matching `BucketClip`.

`BucketClip` (`Clip.tsx`) has an `autoOpenInfo?: boolean` prop. A `useEffect([autoOpenInfo])` calls `setShowInfo(true)` and `setFocusNotes(true)` when it becomes true — replicating the same trigger path as the right-click "Add Note" shortcut. The `ClipInfoWindow` then opens with the comment input focused.

**ProductionTracker auto-open modal from URL:**
```ts
const taskIdFromUrl = new URLSearchParams(window.location.search).get('taskId');
const { data: tasks = [] } = useQuery<ProductionTask[]>({ ... }); // must be declared BEFORE the useEffect

// IMPORTANT: useEffect must come AFTER the tasks declaration to avoid temporal dead zone
useEffect(() => {
  if (taskIdFromUrl && tasks.length > 0 && !activeTaskId) {
    setActiveTaskId(taskIdFromUrl);
  }
}, [taskIdFromUrl, tasks.length]);
```

The `useEffect` must come after the `tasks` query declaration in the component body — placing it before causes a `"Cannot access uninitialized variable"` runtime error due to JavaScript's temporal dead zone for `const`.

### Timeline background right-click context menu

Currently has two surfaces:

- **Background right-click** — "Clear Timeline" action. Extend via the `contextMenuPos` state + the fixed-position `<div>` near the bottom of `Timeline.tsx`'s return.
- **Track header right-click** — "Remove Instrument" action in `Track.tsx`, wrapped in an `AlertDialog` for confirmation. The `onDeleteTrack` callback prop flows from `Timeline.tsx` → `TimelineTrack` → confirmation → API call + local state removal + bucket query invalidation.

Both menus use the shadcn `ContextMenu` component (`@/components/ui/context-menu`). When adding new track-level actions, extend the `ContextMenuContent` in `Track.tsx`. When adding new global timeline actions, extend the menu in `Timeline.tsx`.

**Smart "Clear Timeline" — server-driven branching dialog:**

Clicking "Clear Timeline" in the background context menu triggers a `GET /api/songs/:songId/timeline-has-finals` call before showing any dialog. The result drives which dialog appears:

- **No finals on the timeline** (`hasFinals: false`) → simple dialog: Cancel / Clear Timeline (destructive). Same as the old behavior — clears local state and fires individual `DELETE /api/timeline-clips/:id` for each clip.
- **Finals exist** (`hasFinals: true`) → enhanced dialog: Cancel / Leave Final Clips / Clear All.
  - **Clear All** — same as the simple path; deletes everything.
  - **Leave Final Clips** — fires `DELETE /api/songs/:songId/timeline-clips/non-final` (fire-and-forget), closes the dialog immediately, then calls `queryClient.invalidateQueries` for the timeline key. No manual local state update — the live sync picks up the server result when the query refetches.

**`deleteNonFinalTimelineClips` server-side recalc:**
After deleting non-final clips, the server recomputes correct `start` values for the remaining final clips using the same algorithm as the client's `recalcAllStarts`: infers section order from the clips' pre-deletion `start` values (smallest per section), computes section widths (max total final-clip duration per section across all tracks, floored at 4s), then walks each track+section and writes updated `start` values to the DB. This ensures the client's live sync picks up geometrically correct positions without needing a client-side recalc.

`clearDialogState` in `Timeline.tsx` is a string union `'none' | 'checking' | 'simple' | 'enhanced'` (replaced the old `showClearConfirm: boolean`). The `'checking'` state covers the async server round-trip before the dialog appears.

### Timeline clip right-click — "Show in File Browser"

Right-clicking a timeline clip shows a "Show in File Browser" menu item (icon: `FolderSearch`). Clicking it dispatches a `find-in-bucket` CustomEvent with `{ trackId, sectionName, clipName }`, which causes `MediaBucket` to navigate its three-column browser to the matching instrument → section → versions view.

**`trackId` prop threading:**
`TimelineClip` receives `trackId` as an optional prop (`ClipProps.trackId?: string`). It is threaded down from `TimelineTrack` → `SectionCell` → `TimelineClip` — both `SectionCellProps.trackId: string` (required) and `ClipProps.trackId?: string` (optional). `TimelineTrack` passes `trackId={track.id}` to each `SectionCell` in the sections map.

**`find-in-bucket` CustomEvent:**
Dispatched by `TimelineClip` (`Clip.tsx`) on menu click:
```ts
window.dispatchEvent(new CustomEvent('find-in-bucket', {
  detail: { trackId, sectionName: clip.sectionName, clipName: clip.name },
}));
```

The event payload accepts either `trackId` (stable ID string) or `instrumentName` (display name string) for track lookup — whichever is available. Use `trackId` when possible; `instrumentName` is the fallback for callers that don't have the track ID.

**`MediaBucket.tsx` listener:**
A `useEffect(fn, [])` registers the handler. To avoid stale closures (the handler is registered once but `tracks` changes on every poll), `MediaBucket` keeps a `tracksRef = useRef<ApiTrack[]>([])` and syncs it inside the existing `useEffect` on `tracks`. The handler:
1. Reads `tracksRef.current` (always current)
2. Finds the matching track — first by `trackId`, then by case-insensitive `instrumentName` match
3. Finds the matching idea by case-insensitive `sectionName`
4. Calls `setSelectedTrack(track)` + `setSelectedIdea(idea)` — the three-column UI updates immediately

---

## Version Control

Git is initialized. The first commit ("Working file upload pipeline — bucket → timeline drag and drop") was made on 2026-05-01 and captures the full working state: timeline, drag-and-drop, Media Bucket with real uploads, all API endpoints.

Commit after every meaningful working milestone:
```bash
git add .
git commit -m "Brief description of what was built"
```

If something breaks badly, `git stash` or `git checkout .` can revert all uncommitted changes instantly.

`.gitignore` includes: `node_modules/`, `dist/`, `.env`, `patchbay.db`, `patchbay.db-shm`, `patchbay.db-wal`, `uploads/`, `.local/`.

---

## Open Questions / Decisions To Make

These are things that need a decision before being built:

1. **File storage for deployment:** Where do uploaded audio files live when PatchBay is on
   the internet? Options: local disk (simple, free, not scalable), AWS S3, Cloudflare R2.
   Start with local disk; plan to abstract behind a storage interface.

2. **Authentication provider:** Passport.js with username/password is installed. Could also
   use a third-party auth service (Clerk, Auth0) for easier Google/Apple sign-in.

3. **Real-time vs async:** The spec calls for async collaboration to start. WebSockets (`ws`)
   is installed. Leave real-time for a future milestone.

4. ~~**Song sections as user-defined vs enum:**~~ **Resolved.** Sections are stored as a JSON
   array of strings (`text` column with `mode: "json"`) on the `songs` table. Fully flexible.
