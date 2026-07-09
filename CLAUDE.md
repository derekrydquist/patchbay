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

1. Auth roles and permissions — basic session auth (login/logout, route guard, seeded users) is built; role-based access control (Band Leader / Band Member / Engineer) is not yet enforced
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
| Auth | express-session + bcrypt | Session cookies; bcrypt cost 10; `SessionData` augmented with `userId` |
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
│       ├── App.tsx             # Router — routes: /login (Login), / (Dashboard), /songs/:songId (SongHome), /songs/:songId/workspace (Workspace); all non-login routes wrapped in RequireAuth
│       ├── main.tsx            # React entry point; wraps app in AuthProvider + QueryClientProvider
│       ├── contexts/
│       │   └── AuthContext.tsx # Auth context — AuthProvider, useAuth(); checks /api/auth/me on mount; exposes user, isLoading, login(), logout()
│       ├── pages/
│       │   ├── Login.tsx       # Login page — dark PatchBay-branded card, username/password inputs, Sign In button, error display
│       │   ├── Dashboard.tsx   # Landing page — all songs, cross-song task list, activity feed
│       │   ├── SongHome.tsx    # Per-song homepage — two-column Overview (Resume + Tasks left, Activity sidebar right), Files tab, Review tab
│       │   ├── Workspace.tsx   # Main DAW view — timeline, buckets, production tracker
│       │   ├── home.tsx        # (Unused / legacy — can be removed)
│       │   └── not-found.tsx   # 404 page
│       ├── components/
│       │   ├── daw/            # Core PatchBay-specific components
│       │   │   ├── Timeline.tsx        # The arrangement timeline — drag clips onto tracks
│       │   │   ├── Track.tsx           # A single instrument row in the timeline
│       │   │   ├── Clip.tsx            # An audio clip (in bucket or on timeline)
│       │   │   ├── MediaBucket.tsx     # File browser / upload panel (left side of Workspace)
│       │   │   ├── UploadModal.tsx     # Shared upload dialog — used by MediaBucket and Dashboard
│       │   │   ├── Transport.tsx       # Play/pause/BPM/loop controls (top bar of Workspace)
│       │   │   ├── ProductionTracker.tsx  # Kanban task board for song progress
│       │   │   ├── ExportDialog.tsx    # Export song dialog
│       │   │   ├── Ruler.tsx           # Timeline time ruler
│       │   │   ├── DawScrollbar.tsx    # Custom scrollbar for timeline
│       │   │   └── modals/             # Controlled presentational modals (error/pending state in parent)
│       │   │       ├── AddInstrumentModal.tsx
│       │   │       └── AddSectionModal.tsx
│       │   └── ui/             # shadcn/ui component library — DO NOT manually edit
│       ├── hooks/
│       │   ├── use-mobile.tsx
│       │   └── use-bucket-mutations.ts  # Shared TanStack mutations for bucket operations (add/hide instrument, add/hide section, restore)
│       └── lib/
│           ├── daw-data.ts     # ALL mock data + TypeScript types — this is the data model
│           ├── queryClient.ts  # TanStack Query configuration
│           └── utils.ts        # Utilities: cn() for Tailwind class merging; capitalize(s) for display-layer username capitalization
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

## Navigation

### Global nav — AppHeader

`AppHeader` renders on every surface. Its left side always contains the logo, then the **Home** and **Library** nav links.

- **Logo** — always routes to `/` via an internal `setLocation('/')` call. The `onLogoClick` prop has been removed; do not reintroduce it.
- **Home** (`/?tab=dashboard`) — the activity dashboard. Nav link highlighted when `activeNav === 'home'`.
- **Library** (`/?tab=files`) — the global file browser. Nav link highlighted when `activeNav === 'library'`.
- Song-level surfaces (`SongHome`, `Workspace`) pass no `activeNav` prop — both links render dimmed; neither is highlighted.

### Tab persistence and bare-URL resolution

`Dashboard.tsx` derives `activeTab` reactively from `useSearch()` (wouter) on every render. When no `?tab=` param is present, it reads `localStorage.getItem('patchbay-last-home-tab')` as a fallback. An explicit `?tab=` param always wins — deep links are never overridden. The Home nav link always navigates to `/?tab=dashboard` (explicit param) so it reliably overrides the memory.

**Do not reintroduce a mount-only redirect `useEffect`** for tab memory — the reactive `useSearch()` derivation already handles every SPA navigation case, including navigating back to `/` from a song page.

### Song-level breadcrumb

A `/ {song name}` element is passed via `postLogoSlot`:
- **SongHome** — static `<span>` (you are already on the song's page)
- **Workspace** — `<button>` that navigates to `/songs/:songId` (Song Home)

### Workspace mode tabs

The **Arrangement | Production** tabs live in `Workspace.tsx`'s `preActionSlot` (right side of header, before the gear icon). They are **not** in `postLogoSlot`. Do not move them into the logo/breadcrumb area.

### Naming conventions

| Label | Surface | Destination |
|---|---|---|
| **Home** | Global nav link | `/?tab=dashboard` — activity dashboard |
| **Library** | Global nav link | `/?tab=files` — global file browser |
| **Song Files** | SongHome tab label | `?tab=files` — song-scoped file browser |

Never label anything just **"Files"** — it is ambiguous between Library and Song Files.

### Header type spec — do not invent new variants

Nav links and mode tabs share one font/tracking/case spec: `text-[10px] font-bold uppercase tracking-[0.2em]`

**Nav link full className** (from `AppHeader.tsx`):
```
text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 transition-colors cursor-pointer
```
Active: `text-primary` · Inactive: `text-white/40 hover:text-white/70`

**Mode tab full className** (from `Workspace.tsx` `TabsTrigger`):
```
data-[state=active]:bg-white/5 data-[state=active]:text-primary rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 h-14 text-[10px] uppercase tracking-[0.2em] font-bold transition-all cursor-pointer
```

**Song breadcrumb base** (from `SongHome.tsx`):
```
text-sm font-semibold text-white/70 truncate max-w-[200px]
```
Workspace adds hover affordance only: `hover:text-white/90 transition-colors cursor-pointer`

All interactive header elements carry `cursor-pointer`. New header elements must reuse one of these two type specs — do not introduce a third.

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
| `clip_comments` | Timestamped comments on bucket clips; `parentId` (nullable self-reference, no FK) supports one level of replies — same pattern as `song_review_comments` |
| `production_tasks` | Kanban tasks linked to a song |
| `task_subtasks` | Checklist items on a task |
| `task_comments` | Comments on a task; `parentId` (nullable self-reference, no FK) supports one level of replies |
| `song_reviews` | Exported mix files shared for review (linked to `songs`); stores src URL, format, duration, createdBy |
| `song_review_comments` | Timestamped comments on a review; `parentId` (nullable self-reference) supports one level of replies; `resolved` boolean; `editedAt` nullable ISO timestamp |
| `activity_log` | Dedicated log store for song-structure events (section added/deleted, track added/deleted, clip added/removed from timeline, clip replaced/unmarked-final, review comments). No FK dependencies — `songId` is a plain text column so events survive even if associated rows are deleted. `type` and `description` are stored verbatim; `getActivity()` passes them through without text parsing. Optional `review_id` and `comment_id` columns support deep-link routing for review-comment and review-reply events. |
| `global_settings` | Single-row config table (PK = `'global'`). Stores `defaultInstruments` (JSON string[]), `defaultSections` (JSON string[]), and `defaultBpm` (integer). `getSettings()` auto-inserts the factory row on first read so the row always exists. Used by the New Project modal to pre-populate instruments/sections/BPM. |

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

**`onAddToTimeline` (right-click "Add to Timeline")** follows the same contract as drag-drop. `BucketClip` passes `trackId` explicitly and `clip.sectionName` is read directly on the clip object — no name-parsing or substring heuristics. `Timeline`'s handler (`handleAddToTimeline`) bails with `console.warn('[AddToTimeline] missing', ...)` when either value is absent. **Known landmine:** a clip whose `section_name` is `null` in the DB (can happen with idea-sourced clips that were never associated to a section) will silently no-op on both drag-drop and right-click add — the warn fires but no placement occurs. Do not add silent fallbacks (e.g. using `tracks[0]` or deriving sectionName from the clip name string) — they silently place clips on the wrong track.

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
| Dashboard page | ✅ Done | Personalized time-of-day greeting at the top (`Good morning/afternoon/evening/night, {name}. …`) using `useAuth()` + current hour; "Your Songs" section label below it in the same muted uppercase style as "Upcoming Tasks" with a subtitle; song list capped at 3 most recently updated — a "Show all songs ↓" text button below the cards opens a shadcn `Popover` (overlays content, no layout shift) listing all songs with task count pill and navigation arrow; popover has a search input that filters songs by name in real time; closing the popover resets the search; **both the 3 recent cards and the popover filter to `type === 'song' \|\| !s.type` — `type='idea'` rows are excluded entirely**; `realSongs` is the filtered base array; `recentSongs = realSongs.slice(0, 3)`; `filteredSongs = realSongs.filter(by search)`; popover trigger guard uses `realSongs.length > 3`; two-column grid: left column (2/3) has the song list + Upcoming Tasks, right column (1/3) is a fixed-height scrollable Activity sidebar; sidebar height measured once on mount via `getBoundingClientRect()` after songs load — never updates when task list expands; stacks vertically on mobile; song cards styled as gradient banners (gold chevron, task completion pill showing X/Y tasks in gold when all done, muted otherwise); **task count pill caveat** — `taskCountsBySong` is derived from the `['all-tasks']` cache; both `complete` and `will-not-play` count as completed in `taskCountsBySong` (matching the server route); `createSong.onSuccess` must invalidate both `['songs']` and `['all-tasks']` so the pill appears immediately after song creation without a page refresh; `createSong.onSuccess` also shows a toast `"Song '{name}' created"` before navigating to the song home page; Upcoming Tasks always renders — shows "You have no upcoming tasks" empty state when none match current user; task filter is case-insensitive assignee match; cross-song task list filtered to current user sorted by due date; activity feed polls every 10s with all events in the scrollable sidebar; **greeting block** renders only when `activeTab === 'dashboard'` — a single JSX gate wraps both the heading and the subline; it never renders on the Library tab (the `<main>` element's `py-12` provides adequate top spacing); **status subline** is computed purely from queries already in flight: `overdueCount` from `activeTasks` filtered by `dueDate < today`; if none overdue, `dueSoonCount` from tasks due ≤ 7 days from now; `newFilesCount` from `file-added` activity events within the last 48h; counts are embedded as `<span className="text-primary font-semibold">` nodes in a `React.ReactNode` (not a plain string); container `<p>` uses `text-white/70` when a subline is present, `text-muted-foreground` for flavor fallback; when both clauses are zero, rotating flavor lines render instead; no new API endpoints — the subline reuses `activeTasks` and `activityEvents` already fetched for the page |
| Dashboard Files tab | ✅ Done | Master file browser on Dashboard with **Songs / Ideas** filter toggle. **Songs mode** — 4-column browser: Songs → Instruments → Sections → Files; hover-reveal `+` on SONGS header (`group/songsheader`) opens the **New Project modal** (`createSong` mutation); hover-reveal `+` on INSTRUMENTS header opens the **Add Instrument modal** (`addInstrumentSongMutation`), auto-selects via `pendingInstrumentIdRef`; hover-reveal `+` on SECTIONS header opens the **Add Section modal** (`addSectionSongMutation` — `Promise.all` over `POST /api/tracks/:id/ideas`), auto-selects via `pendingSectionNameRef`. **Ideas mode** — 3-column browser: Ideas → Parts → Files; an "Idea" is a `songs` row with `type='idea'`; its instrument_tracks are called "Parts"; files go into the first `ideas` sub-bucket of the selected Part; hover-reveal `+` on IDEAS header opens the **New Idea modal** (`createIdea` mutation), shows a toast `"Idea '{name}' created"`, navigates to `/?tab=files&filter=ideas&ideaId={newId}`, and auto-selects the new idea via `pendingNewIdeaIdRef` (see URL restoration section below); hover-reveal `+` on PARTS header opens the **Add Part modal** (`addPartMutation` — `POST /api/songs/:id/tracks` + `POST /api/tracks/:id/ideas` with sectionName = part name). **Common**: all column header `+` buttons use the `group/Xheader` hover-reveal pattern and open a Dialog modal — there are no inline text-field inputs in the file browser columns; FILES column header has a fixed `h-8` height; FILES column Upload button and drag-and-drop both open `UploadModal` (imported from `MediaBucket.tsx`) with `defaultIdeaId`, `defaultInstrumentName`, `defaultSectionName`, and `songType` pre-filled from the current column selection — the native file picker is not used; `songType='idea'` for Ideas mode, `'song'` for Songs mode; FILES column clip rows render as **`WaveformPlayerCard`** (20px canvas, play button, gold checkmark for FINAL — no text); right-click on a clip row opens a context menu: More Info (`ClipInfoWindow`), Add Note, Mark as Final, Add to Song, and **Promote to Song** (see below); clips with `addedToSongs` entries show gold pill badges with destination song names below the waveform row; **Music2 icon in SONGS column** is filled solid (`fill="currentColor"`) when `song.hasFiles === true` (from `GET /api/songs`), outline when false; Lightbulb icon in IDEAS column is filled solid when `idea.hasFiles === true`; sort: Ideas list by `createdAt` desc, Songs list by `updatedAt` desc; `seedSong` is skipped for `type='idea'` songs so new ideas start with no instrument tracks. **`createSongSource` state** (`'header' | 'browser'`, default `'header'`) — tracks how song creation was triggered. Set to `'browser'` when the SONGS column `+` button is clicked; set to `'header'` when the AppHeader New Project button or choice modal Song card is clicked. `createSong.onSuccess` branches on this: `'browser'` stays on the Files tab and auto-selects the new song (`setSelectedFile`, `setLocation('/?tab=files&filter=songs&songId=...')`); `'header'` navigates to the song home page (`setLocation('/songs/:id')`). **Activity invalidation**: all creation mutations (`createSong`, `createIdea`, `addPartMutation`, `addInstrumentSongMutation`, `addSectionSongMutation`) call `queryClient.invalidateQueries({ queryKey: ['activity'] })` in `onSuccess`. **URL param auto-selection and navigation persistence**: column clicks write the full selection state to the URL via `setLocation` — Songs mode: `?tab=files&filter=songs&songId=X&instrumentId=Y&sectionId=Z`; Ideas mode: `?tab=files&filter=ideas&ideaId=X&partId=Y` — so refreshing the page restores all three columns. Each click handler also pre-sets `appliedSearchRef.current` to the new search string before calling `setLocation`, which prevents the URL restoration effect from re-running and resetting instrument/section on the same navigation. The restoration effect (`useEffect([songs, search])`) fires when songs are available and `search` changes. It reads `instrumentId`/`sectionId` (Songs) or `partId` (Ideas) from the URL and seeds `pendingInstrumentIdRef` / `pendingSectionIdRef` for the bucket sync effect to resolve. `hasRestoredFromUrl.current` is flipped to `true` **only when an ID was present and the match succeeded** — when there is no `ideaId`/`songId` in the params, or when the ID is present but the idea hasn't appeared in the songs list yet, the flag stays `false` so subsequent retry logic can fire. A companion `useEffect([songs])` retries idea selection from the URL when `hasRestoredFromUrl.current` is still `false` and the songs query refetches with the idea now present. `appliedSearchRef` stores the last processed search string to prevent double-firing on unchanged navigations; `pendingSectionIdRef` resolves by idea ID (distinct from `pendingSectionNameRef` which resolves by section name and is used by the Add Section mutation). **`pendingNewIdeaIdRef`** — a separate ref (`useRef<string | null>(null)`) used exclusively for the post-creation selection path. `createIdea.onSuccess` sets `pendingNewIdeaIdRef.current = newIdea.id` before calling `invalidateQueries` and `setLocation`. A dedicated `useEffect([songs])` watches for this ref: when the refetched songs list contains a `type === 'idea'` entry whose `id` matches, it calls `setSelectedFile` directly and clears the ref. This bypasses the URL restoration system entirely and avoids the race between `setLocation` and the songs refetch. The bucket sync effect (`useEffect([fileBucket])`) resolves both instrument and section in the same pass when `pendingSectionIdRef` is set alongside `pendingInstrumentIdRef` — no second fetch cycle needed. |
| SongHome page | ✅ Done | Per-song homepage at `/songs/:songId`; three tabs: Overview / Files / Review; Overview uses a two-column grid: left column (2/3) has Resume Last Session card + Your Tasks (5-task cap + expand), right column (1/3) is a fixed-height scrollable Activity sidebar; sidebar height is measured once on mount via `getBoundingClientRect()` on the left column ref after tasks first load — never updates when the task list expands; stacks vertically on mobile; Review tab — see Review Tab section below |
| Files tab (SongHome) | ✅ Done | Dedicated Files tab at `/songs/:songId?tab=files` — full MediaBucket file browser and upload panel; always visible; decoupled from Overview so the Overview tab contains only Resume, Tasks, and Activity; MediaBucket is wrapped in a card container (`bg-[#181C26] rounded-xl border border-white/5 overflow-hidden`, no fixed height) so it matches the surface style of the Overview cards and auto-sizes to its content height |
| Review tab (SongHome) | ✅ Done | Per-song review tab at `/songs/:songId?tab=review` — share exported mixes, SoundCloud-style waveform player with drag-to-scrub, avatar markers on waveform, timestamped comment threads with replies, resolve/edit/delete, @ mention autocomplete, Show Resolved toggle; see Review Tab architecture section below |
| Workspace page | ✅ UI done | Layout and components complete; timeline is fully persisted to DB; Transport still uses mock data |
| Timeline with drag-and-drop | ✅ Done | Full-track droppable with custom collision detection; gap zones at clip boundaries enable clip reordering within a section; track-row drop snaps leftward drags to index 0, rightward to end; invalid tracks get dark overlay (rgba 0,0,0,0.5) at zIndex 20; valid track shows full-row gold border; MeasuringStrategy.Always + live getBoundingClientRect() in collision function for reliable gap zone hits; no speculative section injection during drag |
| Section header drag-to-reorder | ✅ Done | Separate inner DndContext from clip drag; dragging a section header moves entire column and all clips across all tracks; insertion line shows between columns; recalcAllStarts runs on drop; section headers are sticky (top-8 z-10 bg-[#09090b]) — pin below the ruler on vertical scroll while remaining draggable |
| Right-click context menu (timeline) | ✅ Done | Right-click timeline background → "Clear Timeline" (server checks for finals first; simple dialog if none, enhanced dialog with "Leave Final Clips" / "Clear All" if finals exist); right-click track header → "Remove Instrument" (AlertDialog confirmation); right-click timeline clip → Replace submenu (fetches real bucket versions from `/api/timeline-clips/:id/replacements` on open; confirmation dialog if clip is final; PATCHes name/src/duration/type/color + isFinal:false on select); "Show in File Browser" (dispatches `find-in-bucket` CustomEvent; MediaBucket navigates to matching instrument + section) |
| Media Bucket (file browser) | ✅ Done | Fully wired to real API; fetches bucket from `/api/songs/:id/bucket`; upload persists files to disk + DB; clips draggable to timeline with correct track validation; "Add Section" adds a section idea across all tracks simultaneously; right-click instrument → hides instrument (soft-delete, restorable); right-click section → hides section idea (soft-delete, restorable); "Add Instrument" and "Add Section" dialogs show restore dropdowns when hidden items exist; VERSIONS column shows compact `WaveformPlayerCard` rows (32px canvas, play button, colored left border, gold checkmark for FINAL); right-click clip → More Info / Add Note / Mark as Final / Add to Timeline / Download / **Remove** (soft-delete via `PATCH /api/clips/:clipId { active: false }`); `getBucket` filters `active = true` clips; **UploadModal** (exported from `MediaBucket.tsx`) is the single shared upload dialog used in both MediaBucket and Dashboard — see UploadModal architecture section below |
| File upload (persist files) | ✅ Done | `POST /api/upload` — multer memory storage, 50MB limit, audio/* filter; writes to `uploads/`; extracts duration via music-metadata (two-attempt with mimetype then without); falls back to 5s if duration < 1; returns `{ url, duration, format, originalFileName }` |
| Transport (play/pause/BPM) | ✅ Done | Pure controls component — dispatches `toggle-play`, `update-bpm`, `toggle-loop`, `update-master-volume` events; no audio logic of its own; dummy CDN audio system removed |
| Production Tracker (Kanban) | ✅ Done | Fully wired to real API; fetches tasks from `/api/songs/:id/production-tasks`; tasks bootstrapped alongside ideas using deterministic IDs `task-{trackId}-{sectionIndex}`; task detail modal with status/assignee/due-date editing (optimistic updates), comment thread with one-level threading (Reply link, N replies toggle, indented replies, inline reply input — same pattern as ClipInfoWindow); thread stays open after posting and scrolls new reply into view; author display uses "You" for logged-in user; section labeled "COMMENTS"; @ mention dropdowns portaled to `document.body` via `createPortal`; bidirectional sync with clip isFinal state; complete cells show final clip name; automatic system comments on status changes; "complete" status is gated — requires a timeline clip or final bucket clip to exist; 400 response shown as destructive toast; cells show human comment count badge from `GET /api/songs/:songId/task-comment-counts`; modal has a gold "Done" button in the footer to close; "Saved" flash indicator appears next to the updated field label for 1500ms after a successful PATCH (driven by `patchTask.onSuccess` inspecting `variables`); "Will Not Play" uses `Ban` icon and `text-red-400/70` with a dark red cell background (`bg-red-950/30`) and inset border glow; auto-opens task modal when `?taskId=` is in the URL (used by activity feed deep links); **visual layout** — outer container is `bg-[#09090b]` dark page background; header sits outside the card against that dark background; grid is wrapped in a `rounded-xl border border-white/5 bg-[#181C26]` card that floats inside a `p-6` padded scroll area; column and section header labels use `text-xs font-bold uppercase tracking-widest text-muted-foreground`; status indicators render as `rounded-full` pill badges with soft tinted backgrounds (`bg-primary/15`, `bg-blue-400/10`, `bg-red-950/40`, `bg-white/[0.06]`) rather than bare text |
| Activity feed | ✅ Done | Shown on Dashboard (cross-song) and SongHome (per-song); aggregates events from two sources — existing tables (clips, clip_comments, task_comments, song_reviews) and the dedicated `activity_log` table; polls every 10s via `refetchInterval`; `queryClient.invalidateQueries({ queryKey: ['activity'] })` is called in every mutation's `onSuccess` so the feed refreshes immediately on any action; see Activity Feed architecture section below. |
| Tab URL persistence (Workspace) | ✅ Done | Active tab (`Arrangement` / `Production`) is synced to `?tab=arrangement` or `?tab=production` in the URL. Page refresh restores the correct tab. Implemented in `Workspace.tsx` via wouter's `useLocation`. |
| Tab URL persistence (SongHome) | ✅ Done | Active tab (`Overview` / `Files` / `Review`) synced to URL: `?tab=files` or `?tab=review`; Overview omits the param for a clean URL. `activeTab` is derived from `useSearch()` (wouter) on every render — `tabParam === 'review' \|\| tabParam === 'files'` or falls back to `'overview'`. `autoReviewId` and `autoCommentId` are also derived from `useSearch()`. The tab button only calls `setLocation`; no separate `setActiveTab` state exists. |
| Export Dialog | ✅ Done | Fully functional; renders timeline via `OfflineAudioContext` (44100Hz stereo); trim-aware — uses `source.start(when, trimStartSecs, trimDuration)` so only the trimmed region renders; WAV export uses inline PCM encoder (RIFF header + interleaved int16 samples); MP3 export uses `@breezystack/lamejs` (ESM-compatible fork); Normalize Audio scales all samples to 0 dBFS before encoding; Export Stems renders each track in isolation and bundles as a zip via `JSZip`; file save uses `showSaveFilePicker` in Chrome/Edge with anchor-download fallback for Safari/Firefox; `AbortError` (user cancelled picker) handled cleanly with no fallback; filename convention: `song_title_MMDDYYYY.format` (slugified, no special chars); stems zip: `song_title_MMDDYYYY_stems.zip`; per-stem files: `song_title_MMDDYYYY_instrument_name.format`; `GET /api/songs/:id/timeline` now returns `{ songName, tracks }` (Timeline.tsx queryFn extracts `tracks` with an Array.isArray guard for backward compat); `Transport` accepts `songId` prop threaded from `Workspace`; fetches `/api/songs/:id` in parallel with the timeline to obtain the canonical `sections` array, then calls `recalcStartsForExport(tracks, sectionOrder)` — a module-level helper mirroring `computeSectionLayout`/`recalcAllStarts` from `Timeline.tsx` — and replaces each clip's DB `start` with the recomputed value before rendering; this is necessary because DB `start` values can be stale relative to live section geometry (e.g. after a trim change), and using them directly causes clips from different sections to overlap in the rendered output |
| Project Settings | ✅ Done | Gear menu → Project Settings modal; editable default BPM, instruments, and sections stored in `global_settings` table; inline tag editors with add/remove pills; Restore Defaults resets draft to factory values without auto-saving; New Project modal pre-populates from saved settings on open via `openProjectModal()` |
| User auth / login | ✅ Done | Session-based auth with express-session + bcrypt; POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me; six seeded users (jordan/alex/jamie/sam/taylor/riley, all with password "password"); AuthContext + useAuth() hook; RequireAuth route guard in App.tsx; /login page; real user wired into all author fields throughout client and server; role-based permissions not yet enforced |
| Real API endpoints | ✅ Done | Songs CRUD, timeline CRUD, bucket/ideas/clips CRUD, file upload, cross-song tasks, activity feed — all built |
| Database schema | ✅ Built | All tables created via `db:push` |
| Audio hover preview (Media Bucket) | ❌ Removed | Hover-to-play was removed from `BucketClip`. Playback is now explicit — click the play button on the `WaveformPlayerCard` card. No hover audio anywhere in the bucket. |
| Audio playback from real files | ✅ Done | Full per-clip audio system in `Timeline.tsx` — see Audio Playback System in Planned Features below |
| Non-destructive clip trim | ✅ Done | Trim handles on timeline clips; `trimStart`/`trimEnd` stored in `timeline_clips`; `clip.duration` never modified; effective duration used throughout layout; `PATCH /api/timeline-clips/:id/trim`; Trim submenu groups all trim actions |
| Clip session notes (More Info panel) | ✅ Done | `ClipInfoWindow` in `Clip.tsx` — full comment CRUD with one-level threading against `clip_comments` table via `effectiveId = bucketClipId ?? clip.id`; top-level comments show "Reply" link and "N replies" toggle; replies indented under parent with inline reply input; thread stays open after posting and scrolls new reply into view; "Add Note" shortcut focuses the input via `focusNotes` prop; @ mention dropdowns portaled to `document.body` via `createPortal` to escape modal overflow/transform stacking context; section header labeled "COMMENTS"; placeholder "Add a comment..." |
| More Info panel — real file metadata | ✅ Done | Upload route extracts `sampleRate`, `bitDepth`, `channels` via music-metadata and returns them with `uploadedDate`/`uploadedBy`; `ClipInfoWindow` shows Duration (formatted), Sample Rate, Bit Depth, Format, Channels, Original File Name, Uploaded By, Date Added; Peak Level computed client-side from `AudioBuffer` (passed from `TimelineClip`'s decoded waveform buffer, or decoded on-demand for `BucketClip`), stored in state not DB; Musical Intelligence fields (BPM, Time Signature, Key/Scale) are editable inputs that PATCH `metadata` on blur with a 1.5s green "Saved" flash; Meta Tags pill input adds tags on Enter, removes with ×; `'Unknown'` key value treated as empty so placeholder shows; header shows clip name only (no badge or ID) |
| Timeline clip waveform | ✅ Done | `<canvas>` inside each `TimelineClip`; decoded once via `AudioContext.decodeAudioData`, cached in `decodedBufferRef`; redrawn on trim change and on zoom/resize via `ResizeObserver`; rendered at device pixel ratio for retina sharpness; trim-aware (only the active region is drawn); fails silently |
| Email notifications | ❌ Not built | Spec item for future |
| @mentions (system-wide) | ❌ Not built | @ mention autocomplete exists in clip notes and production tracker comments, but there are no push notifications or @mention feeds yet |
| Video → audio stripping | ❌ Not built | Spec item for future |
| AI trim detection (client-side) | ✅ Done | "Detect Trim Points" in the Trim submenu — runs on the already-decoded `AudioBuffer`; 1% peak threshold, 100ms sustain windows; visual preview overlay before applying; no re-fetch |
| Apply/Reset trim to all instances | ✅ Done | "Apply Trim to All Instances" / "Reset Trim on All Instances" in Trim submenu — shown when `instanceCount > 1` and trim is active; calls `POST /api/timeline-clips/apply-trim-to-instances`; `instanceCount` threaded via `SectionCell` from `track.clips` |
| AI trim detection on upload | ❌ Not built | Server-side silence stripping on ingest — separate from client-side detection |

---

## API Conventions

All API routes live under `/api/`. Define them in `server/routes.ts`.

Always return JSON. Use standard HTTP status codes. Wrap errors as:
```json
{ "message": "Human-readable error description" }
```

### Implemented endpoints

```
GET    /api/users                        — list all users; returns [{ id, username }] (password omitted);
                                           used by assignee dropdowns and @ mention autocomplete

POST   /api/auth/login                   — body: { username, password }; normalizes username to lowercase;
                                           validates against users table via bcrypt.compare; sets
                                           req.session.userId on success; returns user object without password
POST   /api/auth/logout                  — destroys the session; returns { ok: true }
GET    /api/auth/me                      — returns current user from session (without password) or 401

GET    /api/settings                     — returns { defaultInstruments, defaultSections, defaultBpm };
                                           auto-seeds factory defaults on first call if the row is missing
PATCH  /api/settings                     — partial update; body: { defaultInstruments?, defaultSections?,
                                           defaultBpm? }; uses INSERT … ON CONFLICT DO UPDATE so the
                                           global row is always present; returns { ok: true }

GET    /api/songs                        — list all songs (ordered by createdAt); each song is
                                           annotated with `hasFiles: boolean` — computed via a
                                           JOIN (clips → ideas → instrument_tracks) that builds
                                           a Set of songIds with at least one clip; used by the
                                           Dashboard Files tab to fill the Lightbulb icon on Ideas
GET    /api/songs/:id                    — get a song with nested tracks → ideas → clips
POST   /api/songs                        — create a song; body: { name, bpm?, sections, type?,
                                           instruments? }; `type` defaults to `"song"`; when
                                           `type === "idea"`, `seedSong` is skipped so the new
                                           song has no instrument tracks or sections bootstrapped;
                                           always logs a `song-created` or `idea-created` activity
                                           event with the session-resolved username
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
POST   /api/timeline-clips/apply-trim-to-instances — bulk-sets trimStart/trimEnd on all timeline clips
                                           where trackId AND name match; body: { trackId, name,
                                           trimStart, trimEnd }; used by both "Apply Trim to All
                                           Instances" (current values) and "Reset Trim on All
                                           Instances" (trimStart: 0, trimEnd: null); single DB UPDATE
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
GET    /api/clips/:clipId/comments       — list comments on a bucket clip; returns ClipCommentWithReplies[]
                                           (top-level comments with a `replies` array); ordered by
                                           timestamp asc; replies ordered by createdAt asc
POST   /api/clips/:clipId/comments       — add a comment; body: { author, text, parentId? }; timestamp
                                           set to Date.now(); if parentId provided, validates it
                                           references a top-level comment (no grandchild replies → 400)
PATCH  /api/clip-comments/:id            — edit a comment's text; body: { text }
DELETE /api/clip-comments/:id            — deletes child replies first (no FK cascade on parentId),
                                           then deletes the parent → 204

POST   /api/upload                       — upload an audio file; multipart fields: file, instrument,
                                           section, ideaId; returns { url, duration, format, originalFileName }

GET    /api/songs/:songId/task-counts             — returns { completed: number, total: number } for
                                                     a song; counts `complete` and `will-not-play` both
                                                     as completed; `will-not-play` is a final decision

GET    /api/songs/:songId/task-comment-counts      — map of { taskId → count } for human comments
                                                     (excludes author = "System" or "Unknown")

GET    /api/songs/:songId/production-tasks        — list all tasks for a song
PATCH  /api/production-tasks/:id                  — partial update of a task (status, assignee, dueDate, etc.)
GET    /api/production-tasks/:id/comments         — list comments on a task; returns
                                                     TaskCommentWithReplies[] (top-level comments
                                                     with a `replies` array); ordered by timestamp asc
POST   /api/production-tasks/:id/comments         — add a comment; body: { author, text, parentId? };
                                                     if parentId provided, validates it references a
                                                     top-level comment (no grandchild replies → 400)
PATCH  /api/task-comments/:id                     — edit a comment's text; body: { text }
DELETE /api/task-comments/:id                     — deletes child replies first, then deletes
                                                     the parent → 204

GET    /api/songs/:songId/reviews           — list all reviews for a song (ordered by createdAt desc)
POST   /api/songs/:songId/reviews           — upload a review mix; multipart fields: file (audio);
                                             writes to uploads/reviews/{reviewId}.{ext}; returns
                                             SongReview with { id, name, src, format, duration,
                                             createdAt, createdBy }
DELETE /api/reviews/:reviewId               — delete a review and its comments

GET    /api/reviews/:reviewId/comments      — list top-level comments + nested replies for a review;
                                             ordered by timestamp asc; top-level comments include a
                                             `replies` array of child comments; returns
                                             ReviewCommentWithReplies[]
POST   /api/reviews/:reviewId/comments      — add a comment; body: { author, text, timestamp,
                                             parentId? }; validates that parentId (if set) is itself
                                             a top-level comment (no grandchild replies); sets
                                             resolved: false, editedAt: null; returns 201
PATCH  /api/review-comments/:id            — partial update; body accepts { text?, resolved? };
                                             when text is patched, sets editedAt to current ISO
                                             timestamp automatically; returns updated comment
DELETE /api/review-comments/:id            — deletes all child replies first (no FK cascade on
                                             parentId), then deletes the parent → 204
```

---

## File Uploads

The upload pipeline is fully implemented. Here's how it works end-to-end:

1. **Client** (`UploadModal` in `client/src/components/daw/UploadModal.tsx`) — `POST /api/upload` as multipart with fields: `file`, `instrument`, `section`, `ideaId`. On success, immediately fires `POST /api/ideas/:ideaId/clips` to persist the clip record to the DB.
2. **Server** (`server/routes.ts`) — multer uses memory storage (50MB limit, audio/* filter). The handler:
   - Counts existing clips for the idea to assign the next version number
   - Writes the buffer to `uploads/{instrument}_{section}_v{n}.{ext}`
   - Extracts duration via `music-metadata`'s `parseBuffer` — first attempt with mimetype, second without (auto-detect). Falls back to `duration = 5` if result is `< 1`
   - Returns `{ url: '/uploads/...', duration, format, originalFileName }`
3. **Static serving** — `server/index.ts` serves `/uploads` via `express.static` so `<audio src="/uploads/...">` works directly in the browser.

Files are stored in `uploads/` in the project root (git-ignored). Physical file naming convention: `{instrument}_{section}_v{n}.{ext}` where instrument and section are lowercased and spaces replaced with hyphens.

**Clip naming convention** differs by context:
- **Songs** (`songType === 'song'`): clip name = `${trackName} ${sectionName} V${n}` (PatchBay naming convention)
- **Ideas** (`songType === 'idea'`): clip name = original filename as uploaded (no renaming)

Video stripping (ffmpeg) is not yet implemented — audio-only uploads only for now.

---

## UploadModal Architecture

`UploadModal` lives in `client/src/components/daw/UploadModal.tsx` — the single upload dialog used everywhere in the app. It is imported by both `MediaBucket.tsx` and `Dashboard.tsx`.

```tsx
interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  defaultIdeaId?: string;         // pre-selects destination; user can still change
  defaultInstrumentName?: string; // used for physical filename when pre-filled
  defaultSectionName?: string;    // used for physical filename when pre-filled
  initialFiles?: File[];          // pre-populate pending file list on open
  songType?: 'song' | 'idea';     // controls clip naming convention (default: 'song')
  onUploadSuccess?: (result: { destTrackId: string; destIdeaId: string }) => void;
}
```

**Destination dropdown** — always shown at the top of the modal in a consistent position, visible before any files are added. Options format: `"{Instrument} → {Section}"` (e.g. `"Guitar 2 → Chorus 2"`). The selected value also displays in this format. When `defaultIdeaId` is provided, the dropdown pre-selects the matching option but the user can change it. When `defaultIdeaId` is not provided, it shows "Select Destination" placeholder.

**Instrument/section for physical filename** — `instrumentForUpload` and `sectionForUpload` use `defaultInstrumentName`/`defaultSectionName` props when the user hasn't changed the destination away from `defaultIdeaId`; otherwise fall back to `destTrack.name` / `destIdea.sectionName` from the DB. This matters for Ideas mode where the Dashboard passes `defaultSectionName = selectedFile.name` (the idea's display name) rather than the DB `sectionName`.

**Scrollable pending list** — `max-h-48 overflow-y-auto` with a thin custom scrollbar; scrolls when more than ~4 files are queued.

**Used in:**
- `MediaBucket.tsx` — opened by the header Upload button and by drag-drop onto the versions column or section rows
- `Dashboard.tsx` — opened by the FILES column Upload button and by drag-drop onto the FILES column; `defaultIdeaId` / `defaultInstrumentName` / `defaultSectionName` / `songType` pre-filled from current column selection

---

## Auth Architecture

Session-based auth using `express-session` (server-side sessions, cookie transport) and `bcrypt` (password hashing, cost 10).

### Server setup (`server/index.ts`)

```ts
declare module "express-session" { interface SessionData { userId: string; } }
app.use(session({
  secret: "patchbay-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
```

`storage.seedUsers()` is called at startup. It inserts six users (jordan, alex, jamie, sam, taylor, riley — all lowercase, all with password "password") using `INSERT OR IGNORE` semantics — safe to call on every boot.

### Auth routes (`server/routes.ts`)

- **`POST /api/auth/login`** — normalizes `username` to lowercase, looks up via `storage.getUserByUsername`, compares password with `bcrypt.compare`, sets `req.session.userId`, returns user without password field.
- **`POST /api/auth/logout`** — calls `req.session.destroy()`, returns `{ ok: true }`.
- **`GET /api/auth/me`** — reads `req.session.userId`, fetches user from DB, returns without password; 401 if not logged in.
- **`GET /api/users`** — returns all users as `[{ id, username }]` (no passwords); used by assignee dropdowns and @ mention autocomplete.

### Username normalization

Usernames are stored and queried **lowercase** (seeded in lowercase; incoming login normalized with `.toLowerCase()`). The display layer capitalizes with `capitalize(s)` from `client/src/lib/utils.ts` — a pure helper that uppercases the first character only. **Never capitalize stored values; only the display layer capitalizes.**

`capitalize()` is applied at every username render site: assignee dropdowns, mention autocomplete, comment author labels, avatar initials, and activity feed descriptions (which embed usernames at the start of the string).

### Client auth context (`client/src/contexts/AuthContext.tsx`)

```ts
interface AuthUser { id: string; username: string; }
```

`AuthProvider` checks `GET /api/auth/me` on mount to restore session state. Exposes:
- `user: AuthUser | null` — null while loading or logged out
- `isLoading: boolean` — true during the initial /api/auth/me fetch
- `login(username, password): Promise<void>` — POSTs to /api/auth/login, sets user on success, throws with server message on failure
- `logout(): Promise<void>` — POSTs to /api/auth/logout, clears user

`useAuth()` hook throws if called outside `AuthProvider`.

### Route guard (`client/src/App.tsx`)

`RequireAuth` component: returns `null` while `isLoading`, renders `<Redirect to="/login" />` if `!user`, otherwise renders children. All non-login routes are wrapped in it. The `/login` route itself redirects to `/` if the user is already authenticated (`!isLoading && user`).

### AppHeader dropdowns (`client/src/components/AppHeader.tsx`)

The header right side has two separate dropdowns — no combined settings menu:

- **Gear icon** → workspace dropdown: Project Settings, Manage Access. No section label.
- **Avatar button** (shows user initials) → user dropdown: Notification Settings, Profile Settings, then a divider and Sign Out. Sign Out calls `logout()` from `useAuth()` then `setLocation('/login')` via wouter. No section label.

This split keeps workspace-level actions (shared settings, collaborator access) separate from per-user actions (personal preferences, session management).

**Project Settings modal** — opened via the gear dropdown's "Project Settings" item. Reads current values from `useQuery(['settings'])` and seeds draft state via `openProjectSettings()`. Contains three editable fields: Default BPM (number input), Default Instruments (inline tag editor), and Default Sections (inline tag editor). Tag editors render existing values as removable pills; an inline text input appears when the `+` Add button is clicked (autoFocus, confirmed on Enter or blur, dismissed on Escape). Footer has "Restore Defaults" on the left (resets draft to `FACTORY_INSTRUMENTS` / `FACTORY_SECTIONS` / `FACTORY_BPM` — does not save automatically) and Cancel / Save Changes on the right. Save calls `PATCH /api/settings` via `useMutation`; on success invalidates `['settings']` and closes the modal. `FACTORY_INSTRUMENTS`, `FACTORY_SECTIONS`, and `FACTORY_BPM` are module-level constants in `AppHeader.tsx` (not imported from Dashboard).

**New Project modal pre-population** — `Dashboard.tsx` fetches settings via `useQuery(['settings'])`. Opening the New Project modal calls `openProjectModal()` which seeds `newBpm`, `newSections`, and `newInstruments` from the live settings cache before setting `isNewProjectOpen = true`. `closeModal()` is separate and only closes + clears the name field — it no longer resets form state, so `openProjectModal()` is the single source of truth for initial values. `createSong.mutationFn` falls back to `settings?.defaultSections` / `settings?.defaultInstruments` when the user hasn't modified those fields.

### Seeded users

| Username | Password |
|---|---|
| jordan | password |
| alex | password |
| jamie | password |
| sam | password |
| taylor | password |
| riley | password |

These are development fixtures. All usernames are lowercase. Passwords are bcrypt-hashed at cost 10 and are never returned by any API route.

### Author fields throughout the app

- **Client** — all components read `user?.username ?? 'Unknown'` from `useAuth()` and send it as `author` in POST/PATCH bodies (clip comments, task comments, review comments, mark-final actions).
- **Server** — `uploadedBy` (file upload) and `createdBy` (review upload) are resolved server-side via `req.session.userId → storage.getUser()`, falling back to `'Unknown'`. Never trust `author` from the request body for these two fields.
- **System comments** (status changes, clip-final events) use `author: 'System'` — never the request body author.

### Dynamic user list

`GET /api/users` is fetched via `useQuery(['users'])` in any component that needs a member list (assignee dropdowns in ProductionTracker, @ mention autocomplete in ClipInfoWindow and ReviewPlayer). TanStack Query deduplicates the request — all components share one network call per query key.

The `avatarColor(name)` helper in ProductionTracker and Clip.tsx uses a djb2-style hash of the username string to deterministically pick a color from a fixed palette — works for any username, not just members of a hardcoded array:
```ts
let h = 0;
for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
```

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
- **Do not hardcode data in components** — mock data lives in `daw-data.ts`. Real data comes from API calls via TanStack Query. Never hardcode a username or author — always read from `useAuth()` on the client or `req.session.userId` → `storage.getUser()` on the server.
- **Do not break the existing UI** — the visual design is intentional and represents significant work. Backend changes should not require redesigning pages.
- **Do not add a PostgreSQL dependency** — we are using SQLite. Do not add `pg`, `postgres`, or `neon` packages.
- **Do not reintroduce free clip positioning** — clips on the timeline have no independent position. `clip.start` is always derived by `recalcAllStarts`, never set from a cursor pixel offset or stored as an arbitrary value. This is intentional.
- **Do not add overlap capability to the timeline** — PatchBay is plug-and-play, not a freeform DAW. Clips on the same track cannot overlap under any circumstances. The only valid drop targets are append-to-end or insert-between within a section column.
- **Do not remove Replit-specific vite plugins without updating `vite.config.ts`** — they are conditionally loaded only when `REPL_ID` is set, so they do no harm locally.
- **Do not set `isFinal` on clips or `timeline_clips` outside the established three-entry-point sync** — `PATCH /api/clips/:clipId`, `PATCH /api/timeline-clips/:id`, and `PATCH /api/production-tasks/:id` all cascade `isFinal` changes across bucket clips, timeline clips, and production task status using the same-name rule. A one-off `isFinal` write (direct DB update, ad-hoc route, or storage method call) will silently desync the three tables, leave stale checkmarks on same-name clip instances, and create inconsistent "Complete" task states. Always go through one of the three established entry points. See the "Same-name rule" section under isFinal ↔ task status bidirectional sync.
- **Do not set `trimStart`/`trimEnd` anywhere except `PATCH /api/timeline-clips/:id/trim`** — trim values on `timeline_clips` must only be written via this dedicated route. Setting them inline in `PATCH /api/timeline-clips/:id` or through ad-hoc DB writes bypasses the query-invalidation path that keeps `Timeline.tsx`'s local state in sync (the live-sync effect re-runs `recalcAllStarts` only when trimmed durations arrive via the normal API poll). Also: `clip.duration` must never be modified by trim — it always stores the full file length.
- **Query keys: always use `bucketKeys` from `client/src/lib/bucket-api.ts`** — never raw `['bucket', ...]` literals. This prevents drift when the key shape changes.
- **Bucket mutations live in `client/src/hooks/use-bucket-mutations.ts`** — surface-specific post-success behavior (auto-select, navigation, pending refs) goes in `onCreated` callbacks at the call site, not inside the hooks themselves.
- **Never force-remount a component via a `key` bump to refresh data** — invalidate the right query key instead. A `key` bump destroys all local state and races against any async callbacks that fire after the unmount.
- **Shared creation modals live in `client/src/components/daw/modals/`** — `AddInstrumentModal` and `AddSectionModal` are controlled presentational components; error state and mutation pending state come from the parent. Both accept `onClearError?: () => void` — the modal calls it on every input keystroke so the parent can clear a stale error message. Always pass this prop at call sites that set an error state.
- **Section "remove" is per-instrument soft-hide (`useHideIdea`)** — right-clicking a section in the bucket hides that idea for one instrument only (sets `active = false` on the `ideas` row) and is fully restorable. A song-wide section-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists and `useDeleteSection` was removed from the hook file as unused; do not re-add it without a product decision on whether full section deletion belongs in the UI.
- **Do not add heuristic fallbacks to `onAddToTimeline` or `handleDragEnd`** — track resolution must use the `trackId` carried in drag data / passed by `BucketClip`. Section resolution must read `clip.sectionName` directly. Previous versions used substring track-name matching with a silent `tracks[0]` fallback and derived sectionName by parsing the clip's filename — both silently misplaced clips, especially for idea-sourced uploads whose names are raw filenames. If `trackId` or `sectionName` is missing, warn loudly and bail.

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
`playheadPositionState` (and `playheadRef`) store the playhead in **content-space pixels**: `256 + timeInSeconds * zoom`. The playhead has two DOM elements, both inside the scroller content root — no scroll-offset math anywhere:

- **Line** — `position: absolute; left: playheadPositionState; top: 0; bottom: 0` at z-40. Scrolls natively with content; zero compositor lag.
- **Flag** (draggable handle + triangle) — `position: absolute; left: playheadPositionState` inside the sticky flag band (z-35). Sticks vertically with the band; `handlePlayheadPointerDown` computes `clientX - rect.left + scrollLeft` to get content coordinates on pointermove.

See **Timeline playhead & occlusion** section below for the full z-map and WebKit sticky rules.

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
- All trim actions live inside a **▶ Trim submenu** (`ContextMenuSub`) in the `TimelineClip` right-click menu. Menu order: Detect Trim Points → Apply Trim to All Instances (conditional) → Reset Trim on All Instances (conditional) → Reset Trim (conditional). The submenu is always visible; individual items appear conditionally.

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

### AI trim detection (client-side) — ✅ Built

"Detect Trim Points" in the Trim submenu runs entirely in the browser using the `AudioBuffer` already decoded for waveform rendering — no re-fetch, no re-decode.

**Algorithm (`detectTrimPoints` in `TimelineClip`):**
1. Read channel 0 from `decodedBufferRef.current`
2. Find peak amplitude across all samples
3. Threshold = 1% of peak — filters pops/clicks that would otherwise anchor the trim at the very first sample
4. Scan forward in 100ms windows (`windowSize = Math.floor(sampleRate * 0.1)`); `trimStart` = start of first window whose average absolute amplitude exceeds threshold
5. Scan backward in 100ms windows from the end; `trimEnd` = end of last active window
6. Enforce minimum effective duration of 0.5s (expand from center if needed)

**The menu item is disabled (`disabled={!hasDecodedBuffer}`)** until the `AudioBuffer` is ready. `hasDecodedBuffer` is a state boolean set to `true` inside the decode `useEffect` after `decodedBufferRef.current` is populated. Because refs don't trigger re-renders, this state flag is required — reading `decodedBufferRef.current` directly in JSX would not reflect async updates.

**Visual preview overlay:** When `detectedTrim` state is set, two semi-transparent blue (`rgba(59,130,246,0.4)`) regions are rendered absolutely over the clip — one on the left (suggested silence to trim from start) and one on the right (from end). The active region between them shows gold **Apply** and muted **Dismiss** buttons. Both buttons use `onPointerDown` with `e.stopPropagation()` + `e.nativeEvent.stopImmediatePropagation()` to prevent dnd-kit from starting a drag. **Apply** dispatches `trim-preview` (immediate Timeline reflow), then calls `patchTrim`. **Dismiss** clears the state.

**Do not** re-read `decodedBufferRef.current` to check if decoding is complete — use `hasDecodedBuffer` state instead.

### Apply / Reset trim to all instances — ✅ Built

The same clip name placed multiple times on the same track (same `trackId + name`) represents the same recording in different sections. "Apply Trim to All Instances" stamps the selected clip's current `trimStart`/`trimEnd` onto all of them. "Reset Trim on All Instances" sets `trimStart: 0, trimEnd: null` on all of them. Both reuse `POST /api/timeline-clips/apply-trim-to-instances`.

**`instanceCount` prop threading:**
`TimelineClip` receives an `instanceCount?: number` prop (default 1). The count is computed in `SectionCell` (`Track.tsx`) per clip using the full track clip array — not just the section slice, because the same name may appear in a different section:
```ts
const instanceCount = allTrackClips.filter((c) => c.name === clip.name).length;
```
`allTrackClips` is passed from `TimelineTrack` as `track.clips` (all clips across all sections of the track). The `SectionCellProps` interface includes `allTrackClips: Clip[]`. Do not compute the instance count from query cache data — the prop is always fresh because `SectionCell` re-renders whenever `track.clips` changes.

**Both instance actions are only shown when `instanceCount > 1 && (trimStart > 0 || trimEnd !== null)`.** When N = 1 (only this clip), the items are absent entirely — no toast, no confirmation.

**Confirmation dialogs:** "Apply Trim to All Instances" shows the count as `instanceCount - 1` (excluding the selected clip itself). "Reset Trim on All Instances" shows the same count.

**After success:** `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` is called so the live-sync effect picks up the new trim values for all affected clips within the next poll cycle.

**`POST /api/timeline-clips/apply-trim-to-instances` route** is registered before `PATCH /api/timeline-clips/:id` in `routes.ts`. Although Express won't confuse a POST with a PATCH, keeping static paths before parameterized ones is the convention. The route runs a single `db.update(timelineClips).set({ trimStart, trimEnd }).where(and(eq(trackId), eq(name))).run()` — one DB round-trip regardless of instance count.

### Bucket clip cards — WaveformPlayerCard — ✅ Built

`BucketClip` in `Clip.tsx` renders a **`WaveformPlayerCard`** (`client/src/components/daw/WaveformPlayerCard.tsx`) in the VERSIONS column of `MediaBucket`. The same component is used in the Dashboard file browser (Songs and Ideas modes).

**`WaveformPlayerCard` props:** `src`, `name`, `duration`, `isFinal`, `color?` (left border), `waveformHeight?` (default 20px; MediaBucket uses 32px), `className?`.

**What it renders:**
- Thin colored left border accent (`absolute left-0 top-0 bottom-0 w-0.5`) — only when `color` is provided; MediaBucket passes `clip.color`, Dashboard omits it
- Round gold play/pause button (explicit click trigger — **no hover-to-play anywhere**)
- Clip name with gold `CheckCircle2` icon when `isFinal` — **no "FINAL" text label anywhere**
- Duration display (shows total duration when stopped, current position when playing)
- Waveform canvas: decoded once via `AudioContext.decodeAudioData`, drawn with gold playhead progress

**Drag compatibility:** `BucketClip` wraps `WaveformPlayerCard` with `ContextMenuTrigger asChild` on the dnd-kit drag div. The play button and canvas both call `e.stopPropagation()` on `onPointerDown` so they do not accidentally activate drag. Right-click anywhere opens the context menu normally via `ContextMenu`.

**Context menu items (BucketClip):** More Info · Add Note · Mark as Final / Unmark Final · Add to Timeline · Download · **Remove** (red). Remove calls `PATCH /api/clips/:clipId { active: false }` (soft-delete) and invalidates `['bucket', songId]`. The `clips` table has an `active` column (boolean, default true); `getBucket` in `storage.ts` filters `eq(clips.active, true)`.

**`isFinal` persistence** — `useEffect` syncs `isFinal` from the prop whenever the bucket query refetches. Local state is optimistically updated and reverted on API failure. `executeMark(newIsFinal)` is the shared path for both the direct toggle and the sibling-confirmation dialog.

**Sibling-final confirmation dialog** — before marking a clip final, `BucketClip` checks `siblingClips.some(c => c.id !== clip.id && c.isFinal)`. If a sibling is already final, an `AlertDialog` ("Change Final Version?") appears. `siblingClips` is passed from `MediaBucket` via `siblingClips={selectedIdea.clips.map(toClip)}`.

**Timeline clip removal guard** — `TimelineClip` shows an `AlertDialog` ("Remove Final Clip?") when a user selects "Remove Clip" from the context menu and `isFinal === true`. This is managed via `showRemoveConfirm` state in `TimelineClip`.

**Auto-isFinal on timeline clip placement** — `POST /api/tracks/:trackId/clips` checks whether a final bucket clip exists for the same `trackId + sectionName`. If one exists, the newly placed timeline clip is immediately set to `isFinal: true`.

### Media Bucket — "Add Section"

Hovering over the Sections header in `MediaBucket.tsx` reveals a `+` button that opens `AddSectionModal` (from `client/src/components/daw/modals/AddSectionModal.tsx`). Submitting calls `useAddSection` (from `use-bucket-mutations.ts`), which fires `POST /api/tracks/:trackId/ideas` for **all tracks simultaneously** via `Promise.all`, then invalidates the bucket query. This ensures every instrument always has a slot for every section.

**Duplicate-name validation (client-side):** Both `AddSectionModal` and `AddInstrumentModal` onSubmit handlers perform a pre-check against the current bucket data before mutating. For sections: `tracks.some(t => t.ideas.some(i => i.sectionName.trim().toLowerCase() === name.toLowerCase()))`. For instruments: `tracks.some(t => t.name.trim().toLowerCase() === name.toLowerCase())`. If a duplicate is found, `setAddSectionError` / `setAddInstrumentError` is called and the mutation is not fired. The error clears automatically on the next keystroke via `onClearError`. This is a courtesy UX guard — a server-side 409 is the authoritative guard and should be added as a follow-up. The same pattern applies on the Dashboard Files tab surface (`fileBucket` instead of `tracks`).

**Auto-select + scroll after creation:** `addSectionMutation.onCreated` fetches the fresh bucket via `queryClient.fetchQuery`, finds the selected track's new idea by `sectionName === <created name>`, and calls `setSelectedIdea`. A `selectedIdeaRef` + `useEffect([selectedIdea?.id])` then scrolls the idea row button into view — parity with the instrument-add pattern.

**Right-click "Remove from This Instrument"** hides the idea for that one instrument only (`useHideIdea` → `PATCH /api/ideas/:ideaId` → `active = false`). This is per-instrument, not song-wide. The "Add Section" restore dropdown shows only ideas hidden via this path (`GET /api/tracks/:trackId/hidden-ideas` returns `active = false` rows). A song-wide hard-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists on the server but is not wired to any UI action — do not add a UI affordance for it without a product discussion.

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

### Media Bucket — VERSIONS column empty state

When a section is selected but has no clips, the VERSIONS column renders a full-height dashed-border drop zone (matching the Dashboard file browser empty state style) instead of plain text:

```tsx
<div className="flex-1 p-2">
  <div className={cn(
    'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors',
    isVersionsDragOver ? 'border-primary/50 bg-primary/5' : 'border-white/[0.08]'
  )}>
    <Upload size={18} ... />
    <p ...>{isVersionsDragOver ? 'Drop to upload' : 'No files yet'}</p>
    <p ...>Drop audio files or use Upload above</p>
  </div>
</div>
```

The empty state is rendered **outside** `ScrollArea` as a `flex-1` sibling of the column header div — this is required so `h-full` on the inner bordered div has a proper flex parent (the `flex flex-col` versions column div) to fill against. When placed inside a `ScrollArea`, `h-full` has no bounded parent and the div collapses to its content height.

`isVersionsDragOver` state (in `MediaBucket`) drives the gold border / tinted background. The `onDragLeave` handler uses `e.currentTarget.contains(e.relatedTarget as Node)` to avoid flickering when the pointer moves over child elements within the column.

When clips exist (or a search query is active), `ScrollArea` renders as normal for the clip list.

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

All three PATCH routes accept an optional `author` field in `req.body`. It is destructured out before passing updates to storage (so it never reaches Drizzle's `.set()`). Used as the comment author, falling back to `"Unknown"`. The frontend sends `user.username` from `useAuth()` for all patches. Do not use `task.assignee` as the author.

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

**Comment CRUD with threading:**
- `GET /api/clips/:clipId/comments` — fetched by `useQuery(["clip-comments", effectiveId])` with `enabled: open`; returns `ClipCommentWithReplies[]` (top-level comments each with a `replies: ClipComment[]` array)
- `POST /api/clips/:clipId/comments` — `{ author, text, parentId? }` — `parentId` omitted for top-level, set to parent comment ID for replies; invalidates query key on success
- `PATCH /api/clip-comments/:id` — inline edit; pencil icon on hover
- `DELETE /api/clip-comments/:id` — server deletes replies first, then the parent

**Threading UI:**
`expandedThreadId: string | null` — one thread open at a time. `toggleThread(commentId)` flips it and resets `replyText`/`replyMentionQuery`. Top-level comments show a "Reply" link and, when replies exist, a "N replies" toggle with `ChevronDown`/`ChevronUp`. Expanded thread renders replies indented (`ml-7 border-l pl-3`) followed by the reply input row. `lastReplyRef` attaches to the last reply element; after `handleAddReply` resolves, `setTimeout(() => lastReplyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)` scrolls it into view. Thread stays open after posting (no `setExpandedThreadId(null)`). Author display: `c.author === user?.username ? 'You' : capitalize(c.author)`.

Reply input uses `placeholder={\`Reply to {Author}…\`}` (or "yourself" for self-replies) and is styled identically to the main comment input (`bg-black/40 border-white/10 text-sm h-9 placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic`).

**@ mention autocomplete — portal pattern:**
Both the main comment input and the reply input use `createPortal` (from `react-dom`) to render their dropdowns into `document.body`, escaping the modal's `transform` stacking context that would otherwise clip `position: fixed` children. The rect is read from the input ref during render: `noteInputRef.current?.getBoundingClientRect()`. Main input opens dropdown downward (`top: rect.bottom + 4`); reply input opens upward (`bottom: window.innerHeight - rect.top + 4`). Both use `zIndex: 9999`.

`handleNoteChange` detects `/@(\w*)$/` and sets `mentionQuery`. `handleNoteKeyDown` handles ArrowUp/Down/Enter/Escape. `onMouseDown + e.preventDefault()` on each dropdown item prevents blur before the click registers.

**`avatarColor` returns hex, not a CSS class** — unlike `ProductionTracker` where the avatar helper returns a Tailwind class, `Clip.tsx`'s `avatarColor` returns a hex string. Dropdown avatar divs must use `style={{ backgroundColor: avatarColor(name) }}` with `text-black`, not a className.

### More Info panel — real file metadata — ✅ Built

`ClipInfoWindow` in `Clip.tsx` is fully populated with real data from both the upload pipeline and client-side audio analysis.

**Upload pipeline (server):**
`POST /api/upload` in `routes.ts` parses the audio buffer with `music-metadata` (`parseBuffer`) and extracts:
- `sampleRate` — formatted as `"44.1kHz"` or `"48kHz"` (Hz → kHz with one decimal if not a round number)
- `bitDepth` — formatted as `"24-bit"`
- `channels` — `"Mono"` (1), `"Stereo"` (2), or `"5.1"` (6); empty string for other counts
- `uploadedDate` — ISO date string of upload (e.g. `"2026-05-18"`)
- `uploadedBy` — `"Jordan"` placeholder until auth is built (`// TODO: replace with real auth user`)

These are returned in the upload response. `MediaBucket.tsx` destructures them and passes them into the `metadata` JSON when calling `POST /api/ideas/:ideaId/clips`. Musical Intelligence fields (`bpm`, `key`, `timeSignature`) and `tags` start empty for user entry — no longer hardcoded.

**Peak level (client-side, state only):**
`ClipInfoWindow` receives an optional `audioBuffer?: AudioBuffer` prop. `TimelineClip` passes `decodedBufferRef.current` (already decoded for waveform rendering — no extra fetch). For `BucketClip`, `audioBuffer` is undefined, so `ClipInfoWindow` decodes the audio on-demand when `open` becomes true by fetching `clip.src` and calling `AudioContext.decodeAudioData()`. Peak = `20 * Math.log10(max absolute sample across all channels)`, displayed as `"-7.1 dBFS"`. Stored in component state (`peakLevel`), never written to the DB.

**Duration formatting:**
`formatDuration(secs)` — under 60s: `"4.84s"`; 60s or more: `"1m 4s"`.

**Musical Intelligence (editable, blur-to-save):**
BPM, Time Signature, and Key/Scale are `<Input>` fields with local state initialized from `clip.metadata`. On blur, `patchMeta(updates)` merges the changed field into the existing metadata and sends `PATCH /api/clips/${effectiveId}` with `{ metadata: merged }`. A 1.5s green "Saved" flash appears next to the field label via `savedField` state + `flashSaved(field)` helper. BPM uses `type="text" inputMode="decimal"` (no spinner arrows). Key/Scale treats stored `'Unknown'` as empty so the placeholder `"e.g. C Minor"` shows. All three inputs have `placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic` styling.

**Meta Tags (editable):**
`tags` state initializes from `clip.metadata?.tags ?? []`. User types into a text `<Input>` and presses Enter to add a tag (lowercased, spaces → hyphens, deduped). Each existing tag renders as a pill with an `×` button that removes it immediately. Both add and remove call `patchMeta({ tags: next })` and invalidate `['bucket', songId]`. "Saved" flash on add only.

**`patchMeta` and invalidation:**
```ts
const patchMeta = async (updates: Partial<NonNullable<Clip['metadata']>>) => {
  const merged = { ...(clip.metadata ?? {}), ...updates };
  await fetch(`/api/clips/${effectiveId}`, { method: 'PATCH', ... body: JSON.stringify({ metadata: merged }) });
  queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
};
```
The `PATCH /api/clips/:clipId` route handles metadata updates without triggering `isFinal` sync logic (since `isFinal` is not in the body). `ClipInfoWindow` receives `songId?: string` (default `'patchbay-default'`) for scoped invalidation.

**Header:** Shows only the clip name (and `(FINAL)` if applicable). The type badge and clip ID have been removed.

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
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change'
      | 'review-shared' | 'clip-unmarked-final' | 'clip-replaced' | 'clip-added-to-timeline'
      | 'clip-removed-from-timeline' | 'section-added' | 'section-deleted'
      | 'track-added' | 'track-deleted' | 'review-comment' | 'review-reply'
      | 'song-created' | 'idea-created';
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
  // present on review-shared, review-comment, review-reply for deep-link routing
  reviewId?: string;
  commentId?: string;
}
```

**Two-tier event sourcing:**

Events come from two sources that `getActivity()` merges and sorts by timestamp:

**Tier 1 — existing tables (text-parsed at read time):**
1. **`file-added`** — one event per `clips` row (joined through `ideas → instrument_tracks → songs`). Description: `"{uploadedBy} added {clipName} to {trackName} — {sectionName}"` — actor resolved from `clip.metadata.uploadedBy`, falling back to `'Someone'`. Timestamp: `clip.createdAt`.
2. **`marked-final`** — from `task_comments` rows where `text.startsWith('Clip marked as final:')`. Clip name extracted from the text. Timestamp is the moment the user marked it final. Includes `taskId`.
3. **`clip-comment`** — from `clip_comments` where `isNull(parentId)` (top-level only — replies are excluded to avoid duplicate events). Joined through `clips → ideas → instrument_tracks → songs`. `author = 'Unknown'` renders as `"You"`. Description: `"You commented on {trackName} · {sectionName}"`. Includes `source: 'clip'` and `clipId`.
4. **`task-comment` / `status-change`** — from `task_comments` where `isNull(parentId)` (top-level only). Joined through `production_tasks → songs`. Routed by text pattern — see routing rules below.
5. **`review-shared`** — one event per `song_reviews` row. Description: `"{createdBy} exported {name} to Review"`. Song-level only (no `instrument` or `sectionName`).

**Tier 2 — `activity_log` table (type + description stored verbatim at write time):**

All tier-2 events resolve the actor from `req.session.userId → storage.getUser()?.username`, falling back to `'Someone'` if the session can't be resolved. The pattern appears at the top of each route handler as a const before the `logActivity` call.

6. **`clip-added-to-timeline`** — logged from `POST /api/tracks/:trackId/clips`. Description: `"{user} added {clipName} to {trackName} — {sectionName}"`.
7. **`clip-removed-from-timeline`** — logged from `DELETE /api/timeline-clips/:id`. Description: `"{user} removed {clipName} from {trackName} — {sectionName}"`.
8. **`clip-replaced`** — logged from `PATCH /api/timeline-clips/:id` when name+src both change. Description: `"{user} replaced {oldName} with {newName} in {trackName} — {sectionName}"`.
9. **`clip-unmarked-final`** — logged from `PATCH /api/timeline-clips/:id` and `PATCH /api/clips/:clipId` on `isFinal=false`. Description: `"{user} unmarked {clipName} as final"`.
10. **`section-added`** — logged from `POST /api/tracks/:trackId/ideas` with 5-second dedup. Description: `"{user} added section {sectionName}"`. **Skipped entirely when the parent song has `type='idea'`** — sub-bucket creation for idea Parts is an invisible implementation detail. The type check fetches the song via `storage.getSongById(ideaTrack.songId)` after the dedup check.
11. **`section-deleted`** — logged from `DELETE /api/songs/:songId/sections/:sectionName`. Description: `"{user} deleted section {sectionName}"`.
12. **`track-added`** — logged from `POST /api/songs/:songId/tracks`. Description branches on parent song type: `"{user} added a part — {trackName}"` when `song.type === 'idea'`; `"{user} added an instrument — {trackName}"` when `song.type === 'song'`. Song is fetched via `storage.getSongById(req.params.songId)` after track creation.
13. **`track-deleted`** — logged from `DELETE /api/tracks/:trackId`. Description: `"{user} deleted an instrument — {trackName}"`.
14. **`review-comment`** — logged from `POST /api/reviews/:reviewId/comments` (top-level). Description: `"{author} commented on {reviewName}"`.
15. **`review-reply`** — logged from `POST /api/reviews/:reviewId/comments` (reply). Description: `"{author} replied to {parentAuthor}'s comment on {reviewName}"`.
16. **`song-created`** — logged from `POST /api/songs` when `type !== 'idea'`. Description: `"{user} created a new song — {name}"`.
17. **`idea-created`** — logged from `POST /api/songs` when `type === 'idea'`. Description: `"{user} created a new idea — {name}"`.

**`task-comment` / `status-change` routing (tier 1, event type 4):**
   - `text.startsWith('Status changed to ')` → `status-change`: `"{actor} changed status to {label} — {instrument} · {sectionName}"` — actor is `row.author` (the session user stored at write time), falling back to `'Someone'` if author is `'System'` or `'Unknown'`.
   - `text.startsWith('Clip marked as final:')` → `marked-final` (see above).
   - `text.startsWith('Clip unmarked as final')` → skipped (these `task_comments` rows are written by `PATCH /api/production-tasks/:id` and would duplicate the `clip-unmarked-final` events already in `activity_log`).
   - `author === 'System'` or `'Unknown'` (any other text, e.g. assignee/due-date changes) → silently skipped; audit trail only.
   - All other comments → `task-comment`: `"You commented on {instrument} · {sectionName} task"`. Includes `source: 'task'` and `taskId`.

**Implementation note — status-change author:** Status-change comments in `task_comments` are written by `PATCH /api/production-tasks/:id` with `author` set to the session user (resolved via `req.session.userId → storage.getUser()`), falling back to the `commentAuthor` from the request body, then `'Unknown'`. This stores the actual actor (not the assignee) so the activity feed can attribute the action correctly. Assignee/due-date system comments still use the same `author` resolution. Mark-final comments (e.g. `"Clip marked as final: ..."`) use `commentAuthor || 'Unknown'` from the request body — the client always sends `user.username` here.

**JS-level merge, no SQL UNION:** Each event type is fetched with a separate Drizzle query (or read from `activity_log`) and merged into a single `events[]` array in JavaScript, then sorted by `timestamp` descending. No SQL UNION needed.

**Frontend queries:**
```ts
// Dashboard — cross-song
useQuery({ queryKey: ['activity'], queryFn: () => fetch('/api/activity').then(r => r.json()), refetchInterval: 10000 })

// SongHome — per-song
useQuery({ queryKey: ['activity', songId], queryFn: () => fetch(`/api/songs/${songId}/activity`).then(r => r.json()), refetchInterval: 10000 })
```

**TanStack Query invalidation:** `queryClient.invalidateQueries({ queryKey: ['activity'] })` uses prefix matching — it invalidates both `['activity']` (Dashboard) and `['activity', songId]` (SongHome) simultaneously. Every mutation that triggers an activity event must call this in its `onSuccess` (or `.then()` for fire-and-forget fetches). Mutations that currently do this: song created (modal), idea created (modal), file upload, clip added to timeline, clip removed from timeline, clip marked/unmarked final (both bucket and timeline), clip replaced, section added, section deleted, track (instrument/part) added, track deleted, review shared, review comment/reply posted.

**Current user:** Auth is built — `CURRENT_USER` is no longer a hardcoded constant anywhere in the codebase. On the client, `Dashboard.tsx` and `SongHome.tsx` read `user?.username ?? ''` from `useAuth()` to filter tasks to the logged-in user. On the server, actors are resolved from `req.session.userId → storage.getUser()` for all activity events — `uploadedBy`/`createdBy` in upload/review routes, `author` on status-change task comments, and tier-2 `activity_log` descriptions. `getActivity()` in `storage.ts` reads `row.author` (stored at write time) and `clip.metadata.uploadedBy` for tier-1 events — no hardcoded name anywhere.

**Deep-link navigation from activity rows:**

```ts
function activityUrl(event: ActivityEvent): string {
  const base = `/songs/${event.songId}/workspace`;
  const songBase = `/songs/${event.songId}`;
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
  if (event.type === 'review-shared' && event.reviewId)
    return `${songBase}?tab=review&reviewId=${event.reviewId}`;
  if ((event.type === 'review-comment' || event.type === 'review-reply') && event.reviewId) {
    const params = new URLSearchParams({ tab: 'review', reviewId: event.reviewId });
    if (event.commentId) params.set('commentId', event.commentId);
    return `${songBase}?${params}`;
  }
  if (event.type === 'song-created')
    return `/?tab=files&filter=songs&songId=${event.songId}`;
  if (event.type === 'idea-created')
    return `/?tab=files&filter=ideas&ideaId=${event.songId}`;
  if (event.instrument && event.sectionName)
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  return songBase;
}
```

- **`status-change`** and **`task-comment`** events open the workspace Production tab with the task modal auto-opened (ProductionTracker reads `?taskId=` from the URL on mount).
- **`clip-comment`** events open the workspace File Browser navigated to the matching instrument + section, then automatically open the More Info / inspection modal for the specific clip with the notes input focused. See `autoOpenInfo` prop below.
- **`song-created`** navigates to `/?tab=files&filter=songs&songId=X` — Dashboard reads this via `useSearch()` and auto-selects the song in the Files tab Songs column.
- **`idea-created`** navigates to `/?tab=files&filter=ideas&ideaId=X` — Dashboard reads this and auto-selects the idea in the Ideas column.
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

### Promote to Song (Ideas file browser) — ✅ Built

Right-clicking a clip in the IDEAS mode FILES column shows **"Promote to Song"** (gold `Sparkles` icon, separated from "Add to Song" by a `ContextMenuSeparator`). This creates a brand-new song from the clip and places a copy of the audio in a chosen instrument + section of that new song.

**Modal state (in `Dashboard.tsx`):**
```ts
const [promoteClip, setPromoteClip] = useState<ApiClipDash | null>(null);
const [promoteSongName, setPromoteSongName] = useState('');
const [promoteInstrument, setPromoteInstrument] = useState('');
const [promoteSection, setPromoteSection] = useState('');
const [isPromoting, setIsPromoting] = useState(false);
```

**On menu click** — pre-populates:
- `promoteSongName` = clip name with file extension stripped (`clip.name.replace(/\.[^.]+$/, '')`)
- `promoteInstrument` = first entry from `settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS`
- `promoteSection` = first entry from `settings?.defaultSections ?? DEFAULT_SECTIONS`

**Modal** — user can edit all three fields. Instrument and section selects are driven by `settings?.defaultInstruments`/`settings?.defaultSections` (falls back to `DEFAULT_INSTRUMENTS`/`DEFAULT_SECTIONS`). Submit is disabled until all three fields are non-empty and `isPromoting` is false.

**`handlePromoteToSong` — sequential async steps:**
1. `POST /api/songs` — creates the new song using `settings.defaultBpm`, `settings.defaultSections`, `settings.defaultInstruments`, `type: 'song'`. This triggers the normal seed bootstrap (instrument tracks + section ideas auto-created).
2. `GET /api/songs/:newSongId/bucket` — fetches the freshly seeded bucket to resolve real `trackId`/`ideaId` for the selected instrument + section name.
3. `fetch(promoteClip.src)` → re-uploads the audio via `POST /api/upload` with the correct `instrument`, `section`, `ideaId`.
4. `POST /api/ideas/:ideaId/clips` — creates the clip record in the new song's bucket. Clip name follows the Songs convention: `"{instrument} {section} V1"`. Metadata is copied from the upload response.
5. `PATCH /api/clips/:sourceClipId { addedToSongs: [...] }` — stamps the source clip with `{ songId, songName, instrument, section }` so a gold pill badge appears on the original clip without waiting for a refetch. Also calls `setSelectedInstrument(prev => ...)` for immediate local state update.
6. Invalidates `['bucket', sourceFileId]` and `['songs']`.
7. `closePromoteModal()` then shows a toast: `"Promoted to {songName} — {instrument} · {section}"` with an **"Open Workspace →"** `ToastAction` that navigates to `/songs/:newSongId/workspace?instrument=...&section=...`.

**No backend changes** — reuses `/api/songs`, `/api/songs/:id/bucket`, `/api/upload`, `/api/ideas/:id/clips`, and `/api/clips/:id`.

---

### Review tab — ✅ Built

The Review tab lives on the SongHome page (`/songs/:songId`) as one of three tabs (Overview / Files / Review). It lets band members share exported mixes and leave time-stamped feedback directly on the waveform.

**Tab and data:**
`activeTab`, `autoReviewId`, and `autoCommentId` are derived directly from `useSearch()` (wouter's reactive search hook) on every render — not stored in `useState`. This means navigating to the same SongHome route with different search params (e.g. an activity-feed deep-link while already on the page) correctly re-derives all three values without a remount. `useSearch()` returns the query string reactively; **do not revert to `window.location.search` or wouter's `useLocation()` for these values** — `useLocation()` does not include query strings. Clicking a tab calls `setLocation` with `?tab=review` or `?tab=files` appended (Overview deletes the param for a clean URL). `activeTab` is derived as `tabParam === 'review' || tabParam === 'files' ? tabParam : 'overview'`. Reviews are fetched via `useQuery(['reviews', songId])` against `GET /api/songs/:songId/reviews`. The tab label shows `Review (N)` when at least one review exists. The upload button in the Review tab header fires `POST /api/songs/:songId/reviews` as multipart — no separate upload page.

**Activity feed deep-link routing to the Review tab:**
`activityUrl` in both `Dashboard.tsx` and `SongHome.tsx` handles three review event types explicitly (before the `instrument+sectionName` fallthrough):
- `review-shared` → `/songs/:id?tab=review&reviewId=X` (SongHome, not workspace)
- `review-comment` / `review-reply` → `/songs/:id?tab=review&reviewId=X&commentId=Y`

`SongHome` reads `autoReviewId` and `autoCommentId` from `useSearch()` and passes `autoCommentId` to the matching `ReviewPlayer` (the one whose `review.id === autoReviewId`). `ReviewPlayer` accepts an `autoCommentId?: string | null` prop and uses a `useEffect([autoCommentId, comments.length])` to scroll and highlight once comments are loaded:
- **Top-level comment**: sets `highlightedCommentId`, scrolls to `#review-comment-${commentId}`, clears after 1500ms
- **Reply**: finds the parent comment, sets `expandedThreadId`, scrolls to the parent element

`autoHighlightFired` is `useRef<string | null>(null)` — stores the last highlighted comment ID (not a boolean) so clicking a second activity row with a different `commentId` re-fires correctly. The guard is `autoHighlightFired.current === autoCommentId`.

Review files are stored in `uploads/reviews/` (auto-created by the server if absent). Naming: `review_{songId}_{timestamp}.{ext}`. `GET /api/songs/:songId/reviews` returns reviews newest-first.

**`ReviewPlayer` component (inline in `SongHome.tsx`):**

Each `SongReview` row renders a `ReviewPlayer` — a self-contained card with its own audio element, waveform canvas, comment state, and input handlers. It is not a separate file.

**Data types:**
```ts
interface ReviewType {
  id: string; songId: string; name: string; src: string;
  format: string; duration: number; createdAt: string; createdBy: string;
}
interface ReviewComment {
  id: string; reviewId: string; parentId?: string | null;
  author: string; text: string; timestamp: number; createdAt: string;
  resolved?: boolean; editedAt?: string | null;
  replies?: ReviewComment[];   // only present on top-level comments
}
```

**Schema additions (`shared/schema.ts`):**
`songReviewComments` has two extra columns beyond the base spec:
- `resolved: integer("resolved", { mode: "boolean" }).notNull().default(false)` — whether a comment has been resolved
- `editedAt: text("edited_at")` — nullable ISO timestamp; set automatically by the PATCH route when `text` is changed

These were added after initial scaffolding via `npx drizzle-kit push --force` (interactive `db:push` fails without a TTY — always use `--force`).

**Threaded comment types (in `storage.ts`):**
```ts
export type ClipCommentWithReplies  = ClipComment  & { replies: ClipComment[] };
export type TaskCommentWithReplies  = TaskComment  & { replies: TaskComment[] };
type ReviewCommentWithReplies = SongReviewComment & { replies: SongReviewComment[] };
```
All three use the same pattern: fetch all rows for the parent entity, separate top-level (`!parentId`) from replies, build a `replyMap`, and attach replies to each parent. `getClipComments` and `getTaskComments` are exported from `IStorage` and return the `WithReplies` shapes. `getReviewComments` is internal to the review section.

**`delete*Comment` methods in `storage.ts`:**
All three (`deleteClipComment`, `deleteTaskComment`, `deleteReviewComment`) delete child replies first (no FK ON DELETE CASCADE since `parentId` is a self-reference), then delete the parent. This prevents orphaned reply rows.

**Audio playback:**
`ReviewPlayer` creates `new Audio(review.src)` in a `useEffect([review.src])`. `timeupdate` events drive `currentTime` state. `ended` resets the player. The audio element is managed entirely through the `audioRef` ref — no Web Audio API routing.

**Waveform canvas:**
- `canvasRef` holds a `<canvas>` element inside the waveform div.
- `decodedBufferRef` holds the decoded `AudioBuffer` (channel 0 only). Decoded once via a `fetch(review.src) → arrayBuffer() → AudioContext.decodeAudioData()` effect. Cancellation flag prevents stale writes after unmount.
- `drawRef.current` is reassigned every render so it always closes over current `currentTime`. It reads `canvas.offsetWidth`/`offsetHeight`, applies device pixel ratio (`canvas.width = w * dpr; ctx.scale(dpr, dpr)`), and draws one vertical bar per CSS pixel. Played region: `rgba(212,175,55,0.85)` (gold); unplayed: `rgba(255,255,255,0.2)`. The gold playhead line is a separate `position: absolute` div (not canvas-drawn) to avoid full redraws on every timeupdate frame.
- Three effects trigger redraws: decode complete, `currentTime` change, `ResizeObserver` on the canvas element.

**Drag-to-scrub:**
The waveform div uses pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`) with `setPointerCapture` for reliable cross-element drag. An `isDraggingRef` guards move events. A `dragTimeRef` holds the latest computed time so a rAF-throttled frame (`dragRafRef`) can call `setCurrentTime(dragTimeRef.current)` — one React state update per frame regardless of mouse speed. `audioRef.current.currentTime` is set on every move (immediate audio sync) while the React state update is throttled.

**Avatar markers on waveform:**
Top-level comments are grouped into clusters: `avatarGroups` is a `useMemo([visibleComments])` that sorts comments by timestamp and groups any within 0.25s of each other. **The dependency must be `[visibleComments]`, not `[comments]`** — if it were `[comments]`, toggling `showResolved` would not recompute the groups because `comments` (from TanStack Query) doesn't change when only the filter changes.

Each group renders one marker element positioned absolutely below the waveform (`paddingBottom: '14px'` on the outer div lets markers straddle the bottom edge). Single comment → colored avatar circle with author initials. Multiple comments → gold circle with count. Both show a tooltip on hover (`hoveredAvatarId` state). Resolved markers render at `opacity: 0.35` (single: grey background; cluster: full opacity reduced).

Clicking a single marker: seeks playhead + scrolls the comment into view + highlights it for 1500ms (`highlightedCommentId` state → `ring-1 ring-inset ring-primary/40 bg-primary/5`).
Clicking a cluster: seeks to the first comment's timestamp, then highlights each comment in the group sequentially with a 1500ms gap (`setTimeout(fn, i * 1500)`).

**Comment list:**
`visibleComments = showResolved ? comments : comments.filter(c => !c.resolved)`, sorted by timestamp ascending. Rendered in a `max-h-64 overflow-y-auto` scrollable div. The main comment input is pinned below the scrollable area with a `border-t` separator — it is not inside the scrollable div.

Clicking a comment card calls `toggleThread(comment.id)` (expand/collapse replies). The timestamp badge inside the card has its own `onClick` with `e.stopPropagation()` to seek the playhead without toggling the thread.

When the ••• menu is open for a comment, that card has `bg-white/[0.04]` applied (active highlight) and the ••• button is forced fully visible with `bg-white/10` (activated state). This makes it unambiguous which comment's menu is open.

**Thread expand/collapse:**
`expandedThreadId: string | null` — one thread can be open at a time. `toggleThread` flips it and resets `replyText`/`replyMentionQuery`. When a thread is expanded, its replies render indented (`pl-14`) below the parent, followed by a reply input area. Replies inherit the parent's timestamp — `submitReply` reads `comments.find(c => c.id === parentId)?.timestamp` and sends it in the POST body so replies appear at the same waveform position as the parent.

Replies support their own ••• menu (Edit + Delete only — no Resolve on replies). The ••• menu for replies uses the same `openMenu` / `menuOpenId` mechanism as top-level comments.

**••• menu architecture:**
`menuOpenId: string | null` tracks which comment's menu is open (works for both top-level and replies since all IDs are unique). `openMenu(e, id)` stores `e.currentTarget` in `menuButtonRef` and toggles `menuOpenId`. A document `click` capture listener closes the menu on outside clicks — but skips closing if the click target is `menuButtonRef.current` (the ••• button itself), letting `openMenu`'s toggle logic run cleanly so clicking ••• again closes the menu. All menu item actions use `onMouseDown` (not `onClick`) to prevent the document capture listener from closing the menu before the action fires.

**Delete flow:**
Clicking Delete in the ••• menu sets `deleteConfirmId`. An inline confirmation row appears below the comment (`bg-red-950/20 border-t border-red-900/30`) with Cancel and Delete buttons. Confirming calls `DELETE /api/review-comments/:id`. If the deleted comment has `expandedThreadId === commentId`, the thread is closed. For top-level deletions the message notes how many replies will also be deleted.

**Resolve / edit flow:**
- **Resolve:** `PATCH /api/review-comments/:id { resolved: true/false }`. Refetches comments. Resolved comments show `line-through text-white/40` text and a `CheckCircle2` icon in the header.
- **Show resolved toggle:** Only shown when `resolvedCount > 0`. Toggles `showResolved` state. Both the comment list and the waveform avatar markers respect this filter.
- **Edit:** `startEdit` sets `editingId` + `editText`, focuses `editInputRef`. Inline input replaces the comment text. Save calls `PATCH /api/review-comments/:id { text }` — the server sets `editedAt` automatically. `(edited)` label appears next to the author name when `editedAt` is set.

**@ mention autocomplete:**
`mainMentionQuery: string | null` (for the main input) and `replyMentionQuery: string | null` (for the reply input). **The type is `string | null`, not `string`** — `null` means not in mention mode; `''` means `@` was typed with no chars yet (show all members). Using `''` as the "inactive" sentinel is a bug because `''` is falsy — the `!== null` guard is required. `/@(\w*)$/` regex captures the characters after `@`; `setMainMentionQuery(m ? m[1] : null)` — `m[1]` is `''` when user types just `@`, which is intentionally shown (displays all members). `BAND_MEMBERS` is a module-level constant; results filter by `startsWith`. ArrowUp/Down navigate the list; Enter inserts the mention with a trailing space; Escape dismisses. Dropdown renders above the input (`bottom-full`) as an `absolute` positioned div. Each item uses `onMouseDown` + `e.preventDefault()` to prevent the input from losing focus before the click registers.

**Helper functions (module-level in `SongHome.tsx`):**
- `memberAvatarColor(name)` — deterministic hex color from a fixed palette, hashed from the name string
- `memberInitials(name)` — first two chars of first + last name, or first two chars if single word
- `formatTime(secs)` — `"M:SS"` format
- `formatReviewDate(iso)` — `"Month D, YYYY"` display format

### Placement feedback (Add to Timeline) — ✅ Built

Context-menu "Add to Timeline" fires a styled toast and scrolls the newly placed clip into view with a brief flash halo. Drag-and-drop placement is **deliberately silent** — do not add toasts or flashes to the drag path (`handleDragEnd`).

**Flash halo pattern (`TimelineClip` in `Clip.tsx`):**
An `absolute inset-0 rounded-md` overlay div is rendered as the last child inside the clip's `relative` container. It uses `transition-opacity duration-700` to fade between `opacity-100` (flash active) and `opacity-0` (idle). Key classes: `border-2 border-white/90 shadow-[0_0_12px_rgba(255,255,255,0.6)] z-20 pointer-events-none`. **Do not use `ring-*` classes on timeline clips** — `overflow-hidden` on the clip container clips inline box-shadows (rings) to a sliver on one edge.

**Flash plumbing:**
- `insertClipInSection` returns the new clip's `id` (`nanoid()` generated, same value POSTed to the server)
- `flashClipId: string | null` state lives in `Timeline`; a `flashTimerRef` clears it after 1800ms
- Threaded as props: `Timeline (flashClipId)` → `TimelineTrack (flashClipId?)` → `SectionCell (flashClipId?)` → `TimelineClip (isFlash = flashClipId === clip.id)`
- A `useEffect([isFlash])` in `TimelineClip` calls `clipContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })` when `isFlash` becomes true; `combinedRef` satisfies both dnd-kit's `setNodeRef` and the local `clipContainerRef`

**Toast style convention for placement/creation toasts:**
Gold-bordered card: `className: 'border-primary/50 bg-[#161410] shadow-[0_0_24px_rgba(234,179,8,0.25)]'`. Title: small-caps gold text with a lucide icon (`text-[11px] font-bold uppercase tracking-[0.2em] text-primary`). Description key values: `text-white font-semibold`; separator: `text-white/40`. The Add-to-Song toast in Dashboard predates this treatment — align it when next touched.

**`useToast` / `ToasterToast` type fix (`client/src/hooks/use-toast.ts`):**
`ToasterToast` uses `Omit<ToastProps, 'title'>` (not bare `ToastProps &`) to prevent the HTML `title?: string` attribute from collapsing the `title?: React.ReactNode` field to `string` via TypeScript intersection.

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

2. ~~**Authentication provider:**~~ **Resolved.** Basic session auth is implemented using `express-session` + `bcrypt`. Six seeded users exist (jordan/alex/jamie/sam/taylor/riley). Role-based permissions (Band Leader / Band Member / Engineer) are the next auth milestone — they are defined in the data model but not yet enforced.

3. **Real-time vs async:** The spec calls for async collaboration to start. WebSockets (`ws`)
   is installed. Leave real-time for a future milestone.

4. ~~**Song sections as user-defined vs enum:**~~ **Resolved.** Sections are stored as a JSON
   array of strings (`text` column with `mode: "json"`) on the `songs` table. Fully flexible.

---

## Known Issues

None currently tracked.

---

## Timeline playhead & occlusion — hard-won rules (do not relearn these)

- Playhead line lives INSIDE the scroller content at left = playheadPositionState (content
  coordinates). Never position it with scrollLeft math or toggle it from scroll events: Safari
  throttles scroll events during momentum/rubber-band (sparse deltas, negative scrollLeft) while
  the compositor moves content every frame — JS cannot keep up, by construction.
- The draggable flag is a separate element inside the sticky flag band (band z-35 so the flag,
  which overflows the 6px band, paints over the z-30 ruler). Line and flag both read
  playheadPositionState.
- WEBKIT LAW: position:sticky creates a stacking context even at z-index auto. Occluders must BE
  the sticky element (z on the leaf, plain non-sticky/z-auto/transform-free ancestors up to the
  scroll content root) — never a child of a sticky band root. Band spacers are content-root
  siblings overlaying their bands via negative margins.
- Z-map (leaves only; all containers z-auto): panel spacers/cells 50 > playhead line 40 >
  flag band 35 > ruler & section bands 30 (fully opaque) > resize strip 25.
- The top-edge pane-resize strip must stay BELOW the flag band and the flag opts into pointer
  events (band is pointer-events-none, flag pointer-events-auto) — the strip intercepted all
  scrub input for multiple debugging rounds before DevTools inspection caught it.
- Debugging discipline proven repeatedly: if a fix produces IDENTICAL symptoms, the causal model
  is wrong — stop patching; instrument (console logs) or inspect the live DOM (DevTools element
  picker). Source-reading cannot see browser-specific behavior or hit-testing.
