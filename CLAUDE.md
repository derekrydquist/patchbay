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

## Navigation

### Global nav — AppHeader

`AppHeader` renders on every surface. Its left side always contains the logo, then the **Home** and **Library** nav links.

- **Logo** — always routes to `/` via an internal `setLocation('/')` call. The `onLogoClick` prop has been removed; do not reintroduce it.
- **Home** (`/?tab=dashboard`) — the activity dashboard. Nav link highlighted when `activeNav === 'home'`.
- **Library** (`/?tab=files`) — the global file browser. Nav link highlighted when `activeNav === 'library'`.
- Song-level surfaces (`SongHome`, `Workspace`) pass no `activeNav` prop — both links render dimmed; neither is highlighted.

### Tab persistence and bare-URL resolution

`Dashboard.tsx` derives `activeTab` reactively from `useSearch()` (wouter) on every render. When no `?tab=` param is present, it reads `localStorage.getItem('patchbay-last-home-tab')` as a fallback. An explicit `?tab=` param always wins — deep links are never overridden. The Home nav link always navigates to `/?tab=dashboard` (explicit param) so it reliably overrides the memory.

Every successful normal login and the `/login` already-authenticated redirect in `App.tsx` navigate to `/?tab=dashboard`, never bare `/`. The remembered tab is stored per browser, not per user, so a bare `/` would land a newly signed-in user on whatever tab the previous user left open. The demo login is the one exception: it lands in Workspace (see "Demo login").

**Do not reintroduce a mount-only redirect `useEffect`** for tab memory — the reactive `useSearch()` derivation already handles every SPA navigation case, including navigating back to `/` from a song page.

### Song-level breadcrumb

A `/ {song name}` element is passed via `postLogoSlot`:
- **SongHome** — static `<span>` (you are already on the song's page)
- **Workspace** — `<button>` that navigates to `/songs/:songId` (Song Home)

### Workspace mode tabs

The **Arrangement | Production** tabs are no longer in the top `AppHeader` at all. `Workspace.tsx` builds a single `modeTabs` node (state + `onValueChange` owned by `Workspace.tsx`) and passes it as a prop into each mode's own surface, left-aligned and horizontally level with that surface's toolbar:

- **Arrangement** — threaded `Workspace.tsx` → `Timeline` (`modeTabs` prop) → `MediaBucket` (`modeTabs` prop), rendered left-aligned in `MediaBucket`'s header row, level with the "Search project assets..." input and the Upload button (that row's className switches from `justify-end` to `justify-between` when `modeTabs` is present, so `MediaBucket`'s other caller, `SongHome.tsx`'s Song Files tab — which passes no `modeTabs` — is unaffected).
- **Production** — threaded `Workspace.tsx` → `ProductionTracker` (`modeTabs` prop), rendered left-aligned in `ProductionTracker`'s own header row, before the "Production Whiteboard" title block.

The tabs are duplicated across the two call sites (not lifted into one always-mounted shared row) because Radix `TabsContent` only mounts the active panel — `Timeline`/`MediaBucket` and `ProductionTracker` are never both in the DOM at once, so the same `modeTabs` element reference is passed to both without ever rendering twice. This keeps the switcher visible and functional regardless of which mode is active. `TabsTrigger` styling is unchanged from its original spec (see below).

### Naming conventions

| Label | Surface | Destination |
|---|---|---|
| **Home** | Global nav link | `/?tab=dashboard` — activity dashboard |
| **Library** | Global nav link | `/?tab=files` — global file browser |
| **Song Files** | SongHome tab label | `?tab=files` — song-scoped file browser |

Never label a **nav link** or tab just **"Files"** — it is ambiguous between Library and Song Files. The rule is about navigation, not column headers: the third column of every file browser (MediaBucket in Workspace and Song Files, the Library Songs quick-browser, the Ideas shelf) is labelled **"Files"**, since the surrounding surface already makes its scope clear. (MediaBucket's column was labelled "Versions" until Oct 2026; internal ids such as `bucket-versions||` and `bucketVersionsDropId` keep the old name.)

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

### Home and Library page headers — sibling pair

The Home tab (`activeTab === 'dashboard'`) and Library tab (`activeTab === 'files'`) both open with an identical type block and spacing: a `mb-4` wrapper, an `<h1>` (`text-2xl font-heading font-black tracking-tight text-white`), and a `<p>` subline (`text-sm mt-1 text-white/70`).

- **Home** renders the personalized greeting + status/flavor line
- **Library** renders `"Library"` + live counts (`N Songs · N Ideas · N Albums`)

They are a matched pair. Restyling one requires restyling the other — change them together.

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
| `instrument_tracks` | One row per instrument per song (Drums, Bass, etc.); names are unique per song, active or hidden (`uniq_song_track_name`) — a duplicate is a 409 that points to restore when the clash is hidden; has `active` boolean — false = hidden; `volume` integer (default 100, range 0–100) — persisted via `PATCH /api/tracks/:trackId`, debounced 500ms on slider drag; read back on initial load and every live-sync poll; `pan` integer (default 0/center, range -100 full left to 100 full right) — persisted via the same `PATCH /api/tracks/:trackId` route. The L/C/R button UI only ever writes `-65`, `0`, or `65`; the column allows the full range for forward compatibility, but nothing currently sets anything outside those three values. See "Track panning" in `client/src/components/daw/CLAUDE.md` for the audio-graph side. |
| `ideas` | A section slot per instrument (e.g. "Drums — Verse 1"); has `active` boolean — false = hidden |
| `deleted_sections` | Tracks intentionally deleted default sections (songId + sectionName) so bootstrap doesn't re-add them |
| `clips` | Versions uploaded to a bucket idea (linked to `ideas`); `isFinal` marks the chosen version |
| `loose_files` | Files uploaded without an organized destination. `songId` is nullable — NOT NULL means the file belongs to that song (real or idea-type), sitting unorganized alongside its content; NULL means band-wide/unassigned, scoped by `bandId` instead, sitting at the top of the Ideas shelf until dragged onto an Idea. `trackId` is also nullable and adds a third resting tier: NOT NULL means the file is **Track-scoped** — its Track is known but it has no `sectionName` yet — and it renders only in that Track's own Sections column (below the Section list) in MediaBucket, not the Tracks column. Reachable three ways, all converging on `POST /api/loose-files/:id/assign-track` (a plain field update — unlike organize/place-on-timeline below, this never materializes a `clips` row): (1) drag a Tracks-column file onto a Track row, (2) drag one directly into the Sections column's open background, (3) drag a Track-scoped file from one track's Sections column onto a *different* track's row — deliberate cross-track reassignment, not an accident. A Finder file dropped on a Track row or the Sections background lands in this tier too, created in one write via `POST /api/songs/:songId/loose-files` with `trackId` (never upload-then-assign — a failure in between would leave a song-level file). Dragging onto a Section row still organizes into a real `clips` row via the route below, unchanged. No `isFinal`/`active`/`sectionName` — those concepts don't apply until a file is organized. `POST /api/loose-files/:id/organize` and `POST /api/loose-files/:id/place-on-timeline` are the only two write paths that turn a loose file into a real `clips` row (and, for the latter, a `timeline_clips` row too) — both go through a single shared `materializeLooseFile`-family function in `storage.ts`, so a loose file can never be duplicated or left half-migrated; `materializeLooseFileCore` resolves its destination entirely from its own `trackId`/`sectionName` parameters, never from the loose file's own `trackId` column, so a Track-scoped file organized into a Section works with no special-casing. `GET/POST /api/loose-files/unassigned` handle the band-wide tier specifically; `GET /api/tracks/:trackId/loose-files` backs the Track-scoped tier. `assign-track` also accepts an explicit `trackId: null` to un-assign (drop on the Tracks-column background → back to the Tracks shelf); a missing `trackId` is still a 400. The full Track-scoped tier (assign-track, un-assign, Sections-column shelf, both column backgrounds) works in Workspace, SongHome, and the Library Songs quick-browser. **Notes** live in `loose_file_comments` (mirrors `clip_comments`); list routes return `commentCount`/`latestCommentAt`. **Metadata** (BPM 20–400, key free-form max 20 chars, time signature, tags) is editable via `PATCH /api/loose-files/:id/metadata`, which merges only the keys sent; organize copies the edits onto the clip. `added_to_songs` (same shape as `clips.addedToSongs`) is copied back onto the clip by organize, so "added to song" pills survive a move out and back in. `POST /api/clips/:clipId/make-loose` is the reverse: one transaction turns an Ideas-shelf clip into a band-wide loose file, reusing the clip id, moving notes with the same ids, never unlinking the file. Idea-type clips only; final, removed or timeline-placed clips get a 409. `POST /api/clips/:clipId/move-to-loose` is the real-song path back (see "Moving real-song versions"). Song-scoped loose files have `bandId` null (scoped via `songId`). Organize/place-on-timeline reuse the loose file's id as the clip id and move its notes into `clip_comments` with the same ids, flagged `carried_from_comment_id` so the feed skips them. **Deletable via right-click "Delete"** on every surface that renders one (Songs quick-browser, Ideas shelf — both the Column 1 list and the one-off preview card, SongHome, Workspace/MediaBucket) — one shared `LooseFileDeleteMenu` component (`client/src/components/daw/LooseFileRow.tsx`) drives all of them via `DELETE /api/loose-files/:id`, no confirmation dialog. `storage.deleteLooseFile` also unlinks the physical file from `uploads/`, but only after confirming no other `loose_files`/`clips`/`timeline_clips` row still has that same `src` — this guard exists because of the old upload collisions (see "File Uploads" below): many existing rows share one physical file, and organize/place-on-timeline copy `src` as-is; deleting one row must never take that shared file out from under the others. |
| `timeline_clips` | Clips placed on the arrangement timeline (linked to `instrument_tracks`); `isFinal` mirrors the corresponding bucket clip's final state; `trimStart` (real, default 0) and `trimEnd` (real, nullable) store non-destructive trim points in seconds; `section_offset` (real) is the clip's position in seconds from the start of its home section (`sectionName`) — the only stored position that counts; negative = a pickup (see "Timeline layout and arrangement order"). Clips on one track in one section never overlap; every write path checks (409). `start` (NOT NULL) is a stale cache: server-written values come from the shared layout, the client never sends it on PATCH, and nothing reads it except for legacy full takes (absolute start, outside sections). |
| `song_sections` | One row per song × section name (unique on song + section name). `sort_order` is the song's **arrangement order** (the order it plays in), read only by the timeline, Export, `computeSongLayout` and `getClipDependents`. `base_length` (nullable integer, **whole beats**, max 4096; NULL = fit to content) is read by the layout and written only by `PUT /api/songs/:songId/sections/base-length` (see "Base length" under "Timeline layout and arrangement order"). Rows are created by `ensureSongSection` (song, idea, track and section creation, clip placement). A section with no timeline clips has no position: its row's place is ignored until its first clip places it (see "Timeline layout and arrangement order"). Hand-authored migration in `server/db.ts`. |
| `clip_comments` | Timestamped comments on bucket clips; `parentId` (nullable self-reference, no FK) supports one level of replies — same pattern as `song_review_comments`. Also backs the clip comment indicator badge (see Planned Features) via `GET /api/songs/:songId/clip-comment-summary`, which aggregates `MAX(timestamp)` per `clipId` across both top-level comments and replies. |
| `production_tasks` | Kanban tasks linked to a song. A task belongs to its track by `track_id` (reads join on it); older routes still look tasks up by instrument name (`getTaskByInstrumentSection`), which works only because track names are unique per song — new code uses `getTaskByTrackSection`. Idea-type songs get no tasks (they have no timeline to complete them). **Startup self-heal** (`storage.relinkNullTaskTracks`, right after `backfillBands()` in `server/index.ts`): a NULL `track_id` is relinked when exactly one track in the song matches the instrument name (case-insensitive, active preferred); ambiguous/unmatched rows are left and logged; a failure is logged and never stops boot. **Hidden sections:** task reads (`getTasksForSong`, `getAllTasks`, the PATCH response) return a computed `sectionHidden` — true when an `ideas` row for the task's track + section has `active = 0` (an `exists` subquery, not a join; nothing makes track + section unique in `ideas`). Production Tracker renders such a cell disabled ("Section removed for this track / Restore it from Add Section"), with no status, click, focus or modal; a `?taskId=` deep link to it toasts instead. My Tasks, Dashboard progress counts, SongHome's open tasks and `GET /task-counts` exclude them. Routes that write a task or its comments call `assertTaskEditable` (409); server-internal writes don't. Hiding never changes the stored status — restore recomputes it (see "Section hide and restore"). |
| `task_subtasks` | Checklist items on a task |
| `task_comments` | Comments on a task; `parentId` (nullable self-reference, no FK) supports one level of replies |
| `song_reviews` | Exported mix files shared for review (linked to `songs`); stores src URL, format, duration, createdBy |
| `song_review_comments` | Timestamped comments on a review; `parentId` (nullable self-reference) supports one level of replies; `resolved` boolean; `editedAt` nullable ISO timestamp |
| `activity_log` | Dedicated log store for song-scoped events. No FK dependencies — `songId` is a plain text column so events survive even if associated rows are deleted. `type` and `description` are stored verbatim; `getActivity()` passes them through without text parsing. `author` is a nullable text column (retrofitted — pre-existing rows have `author=null`); populated at every `logActivity()` call site by resolving `req.session.userId → storage.getUser()?.username`. `author` is the key input to `getSongsWithLastActive`, which sorts the Dashboard "Your Songs" list by `MAX(activity_log.timestamp WHERE author = session username)` per song, falling back to `createdAt`. Optional `review_id` and `comment_id` columns support deep-link routing for review-comment and review-reply events. Nullable `clip_id` (guarded `ALTER TABLE` in `server/db.ts`) links organize, place and Final rows to their clip. Since Oct 2026, `clip_id` is also set on `file-uploaded` (the clip's id) and `loose-file-uploaded` (the loose file's id) rows, on both the old and the new upload routes (no backfill), so Undo can delete an upload's feed row. `getActivity`'s clip-hiding rule reads `clip_id` only on organize/place rows, so this changes nothing in the feed. |
| `global_settings` | Single-row config table (PK = `'global'`). Stores `defaultInstruments` (JSON string[]), `defaultSections` (JSON string[]), and `defaultBpm` (integer). `getSettings()` auto-inserts the factory row on first read so the row always exists. Used by the New Project modal to pre-populate tracks/sections/BPM. |
| `lyrics_comments` | Timestamped comments on song lyrics, anchored to a text selection (linked to `songs`); `anchorText` + `anchorOffset` store the selected substring and its offset for re-anchoring on render — if the anchor text can't be found (lyrics were edited), the comment is preserved and shown unanchored rather than deleted; `resolved` boolean supports a Google-Docs-style resolve/unresolve flow; `parentId` (nullable self-reference, no FK) supports one level of replies, same pattern as `clip_comments`/`task_comments`/`song_review_comments`. |

**Naming note:** the `instrument_tracks` table, its `instrument` column/field references, and internal identifiers (`instrumentForUpload`, `group/instrument`, `AddInstrumentModal`, etc.) are unchanged. Only the **user-facing label** was renamed, app-wide, from "Instrument"/"Instruments" to "Track"/"Tracks" (client-side UI copy across MediaBucket, Track.tsx, AddInstrumentModal, AddSectionModal, ProductionTracker, Dashboard, and AppHeader; server-side display strings in `routes.ts`'s duplicate-name/error messages and Activity Feed descriptions).

**Loose-file Activity Feed wording (idea-type songs):** loose-file upload/organize descriptions branch on the parent song's `type` to avoid the redundant "...to/into Files — Files" wording every idea-type song used to produce (every idea resolves to the same single hidden default track/section, both literally named "Files"). Real songs are unchanged. See "Loose-file events" in `.claude/skills/activity-feed/SKILL.md` for the exact wording per event type.

`songs.lyrics` — nullable plain-text column holding the song's lyrics. Edited via a dedicated `PATCH /api/songs/:id/lyrics` route (not the general song PATCH), following the same "dedicated route for a single frequently-written field" pattern as `timeline_clips.trimStart`/`trimEnd`.

**`songs.sections` is written once at song creation and never updated afterward** — `POST /api/songs/:songId/sections` and section hide/restore both operate on `ideas` rows only. Do not treat `songs.sections` as live section state for any feature; derive the current section list from active `ideas` rows instead (the union of `sectionName` across active tracks/ideas is the live equivalent). Discovered while building the loose-file "Place on Timeline" picker, whose Section dropdown originally would have silently gone stale using this column. The order of that live list (`ideas.sortOrder`) is the **filing order**. The playing order lives in `song_sections.sort_order` — see "Timeline layout and arrangement order".

**`timeline_clips` vs `clips`:** These are intentionally separate tables. `clips` holds the uploaded source material (versions inside bucket ideas). `timeline_clips` holds the arranged instances placed on the timeline, each positioned by its home section and `section_offset`. Dragging from the bucket to the timeline creates a new `timeline_clips` row — it does not move the source clip.

**File display color comes from the track, never the stored column.** `clips.color`, `timeline_clips.color` and `loose_files.color` are copied once at creation and never follow the file, so they go stale after organize, place-on-timeline or a cross-track move. They are still written (NOT NULL) but never read for display. Every place that shows a file's color uses `client/src/lib/track-color.ts`: a file on a track shows its track's color (`hsl(var(--chart-1))` if the track's color is null, same fallback as the timeline track header); a Track-scoped loose file shows its track's color; a loose file with no track (song-level or band-wide), or whose track isn't found, shows an empty outlined swatch, never gold — gold reads as Drums. Display sites: TimelineClip body and its More Info, the timeline-clip drag ghost dot, MediaBucket version card edge (`BucketClip` → `WaveformPlayerCard` `color`) and its More Info, the Library More Info, and the loose-file More Info (which reads the song's track list from already-loaded `bucketKeys.bucket(songId)` data, never fetching). Each passes a separate `trackColor` prop; `clip.color` is left alone so Replace and bucket → timeline placement still copy the stored value as before. TimelineClip's body, border and waveform all derive from the `trackColor` prop: body and border through `clipBodyColor` / `clipBorderColor` in `client/src/lib/track-color.ts`, waveform in the track color itself (see "Timeline clip look").

### Song and Idea deletion

- `deleteSong` first deletes Track-scoped loose files and `bucket_folder_views` rows explicitly (no cascade on those FKs), in one transaction; another song's file pointing at its track only loses `trackId`.
- Audio is unlinked after commit unless another row still uses it (`unlinkUploadIfUnreferenced`). Review mixes in `uploads/reviews/` are not cleaned up.
- Logs `song-deleted` / `idea-deleted` inside the same transaction, with the band id; see the activity-feed skill for how deleted songs' rows render.
- UI: right-click Delete Idea (Ideas shelf rows) and Delete Song (Library Songs rows), both confirmed, both through `DELETE /api/songs/:id`.

### Default song bootstrap

`server/storage.ts` exports `DEFAULT_SONG_ID = "patchbay-default"`. The first call to `GET /api/songs/:id/timeline` auto-creates this song and its five default instrument tracks if they don't exist yet (using `INSERT OR IGNORE`). The default track IDs are stable strings: `track-drums`, `track-bass`, `track-guitar-1`, `track-guitar-2`, `track-vocals`.

`storage.ts` also exports `DEFAULT_SECTIONS = ["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Outro"]`. The bootstrap inserts 35 idea rows (5 tracks × 7 sections) using stable IDs like `idea-track-drums-0`, and 35 production task rows using stable IDs like `task-track-drums-0`. Both ideas and tasks use `onConflictDoNothing()` — existing rows (including hidden ones) are preserved. Default tracks check for existence first: if a track exists with `active = false`, the bootstrap skips it entirely (does not re-show it). All mechanisms ensure hide/restore persists across server restarts.

### Track IDs must be stable

`INITIAL_TRACKS` in `daw-data.ts` uses the same stable string IDs (`track-drums`, etc.) — **not** `nanoid()`. This is required because the timeline's live sync matches local `Track` objects to `ApiTrack` objects by `id`, and `timelineClips.trackId` is a DB foreign key that must match. If IDs diverge, the live sync silently mismatches tracks and DB relationships break. Do not change `INITIAL_TRACKS` to use generated IDs.

---

## Environment Variables

Create a `.env` file in the project root. It is already in `.gitignore`.

```
# Required for SQLite — path to the database file
DATABASE_URL=./patchbay.db

# Required for sessions — generate a random string
SESSION_SECRET=replace-this-with-a-long-random-string

# Demo bandmate password (mara, theo, kai). Optional — if unset, only the
# demo guest is created and the boot log says so. Set separately in Railway.
DEMO_PASSWORD=replace-this-with-a-password

# Set automatically by npm scripts — do not set manually
# NODE_ENV=development
```

The dev script runs `tsx --env-file-if-exists=.env server/index.ts`, so `.env` values reach the local server. (Before Oct 2026 the dev script was plain `tsx server/index.ts` and `.env` was never read; the server silently used fallback values.) Railway does not read `.env` — production variables (`SESSION_SECRET`, `UPLOADS_DIR`, `DEMO_PASSWORD`, etc.) are set in the Railway service's Variables tab.

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

### Tests and type check

```bash
npm test        # Vitest (vitest run), config in vitest.config.ts — pure logic, no DOM
npm run check   # tsc
```

Tests live next to their code as `*.test.ts` under `shared/`, `server/` and `client/src/`. Server tests (`server/*.test.ts`) run the real routes and storage against a throwaway SQLite file holding only `patchbay.db`'s schema (no data; `patchbay.db` is opened read-only); they are skipped when there is no local `patchbay.db`.

Automated browser checks (Playwright, headless WebKit) are not proof for positioned or floating UI, or for Safari audio: twice they passed while a real browser showed the Lyrics composer in the wrong place. Confirm those in a real browser.

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

## API Conventions

All API routes live under `/api/`. Define them in `server/routes.ts`.

Always return JSON. Use standard HTTP status codes. Wrap errors as:
```json
{ "message": "Human-readable error description" }
```

## File Uploads

The upload pipeline is fully implemented. Here's how it works end-to-end:

1. **Client** (`UploadModal` in `client/src/components/daw/UploadModal.tsx`) — `POST /api/upload` as multipart with fields: `file`, `instrument`, `section`, `ideaId`. On success, immediately fires `POST /api/ideas/:ideaId/clips` to persist the clip record to the DB.
2. **Server** (`server/routes.ts`) — multer uses memory storage (50MB limit, audio/* filter). The handler:
   - Counts existing clips for the idea to assign the next version number
   - Writes the buffer to `uploads/{instrument}_{section}_v{n}_{token}.{ext}` (8-char token from `randomUUID()`; write fails rather than overwrite)
   - Extracts duration via `music-metadata`'s `parseBuffer` — first attempt with mimetype, second without (auto-detect). Falls back to `duration = 5` if result is `< 1`
   - Returns `{ url: '/uploads/...', duration, format, originalFileName }`
3. **Static serving** — `server/index.ts` serves `/uploads` via `express.static` so `<audio src="/uploads/...">` works directly in the browser.

This two-step flow (upload, then create) is UploadModal's. Finder drops use one-request routes instead — see "Finder drops (immediate upload)".

Files are stored in `uploads/` in the project root (git-ignored). Physical name: `{instrument}_{section}_v{n}_{8-char token}.{ext}`, unique per upload. `buildFilename` sanitizes instrument/section to `[a-z0-9-]` and the extension to `[a-z0-9]`; the route also checks the path stays inside `uploads/`. Nothing parses the name; format comes from the upload, downloads use `metadata.originalFileName`.

**Old uploads still share files.** Before Oct 2026 names weren't unique (loose uploads were all `loose_unplaced_v1.*`; section uploads reused `{instrument}_{section}_v{n}` across songs), so many existing rows share one `src` and their original audio is gone. Left unrepaired; `deleteLooseFile` keeps its src-sharing guard for them.

**Clip naming convention** (display name; separate from the file on disk):
- **Real songs:** every clip that lands in a section (upload, organize, place-on-timeline, move-to-section) is named `{track} {section} V{highest + 1}` server-side by `landingClipName` (`storage.ts`), counting inactive clips. Gaps stay; nothing existing is renamed. Full Take sections are excluded.
- The pre-rename name is kept in `metadata.originalFileName` when that's empty (shown in More Info). Ideas clips and loose files keep their names.

Video → audio extraction exists inside UploadModal only: `client/src/lib/extractAudioFromVideo.ts` (ffmpeg.wasm, `@ffmpeg/core` loaded from unpkg on first use) converts video to MP3 before upload. Finder drops route video to it via the Extract audio toast.

**Download names:** `{Song name}_{clip name}.{ext}` via `buildDownloadFilename` (`client/src/lib/download-name.ts`); spaces → `_`, illegal characters stripped, ~120-char cap, extension from `src` first.
The original filename stays in `metadata.originalFileName` / More Info. Export builds its own names.

---

## UploadModal Architecture

`UploadModal` lives in `client/src/components/daw/UploadModal.tsx` — the single upload dialog used everywhere in the app. It is imported by both `MediaBucket.tsx` and `Dashboard.tsx`.

```tsx
interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId?: string;                // required for 'placed'/'loose'; omitted for 'band-loose'
  defaultIdeaId?: string;         // pre-selects destination; user can still change
  defaultInstrumentName?: string; // used for physical filename when pre-filled
  defaultSectionName?: string;    // used for physical filename when pre-filled
  initialFiles?: File[];          // pre-populate pending file list on open
  songType?: 'song' | 'idea';     // controls clip naming convention (default: 'song')
  mode?: 'placed' | 'loose' | 'band-loose'; // default: 'placed'
  looseTrackId?: string;          // 'loose' only: create the file in this Track's Track-scoped tier
  announceDestination?: boolean;  // Finder drops: header reads "Adding to Drums" / "Adding to Drums > Intro"
  onUploadSuccess?: (result: UploadSuccessResult) => void; // fires for all three modes
}

interface UploadSuccessResult {
  mode: 'placed' | 'loose' | 'band-loose';
  destTrackId: string | null;     // 'placed' only
  destIdeaId: string | null;      // 'placed' only
  landed: LandingFlashItem[];     // every landed file { id, zone }, in upload order
}
```

**After success** — the modal passes `landed` to `requestLandingFlash` itself (see "Landing flash"). A placed upload's destination is followed by MediaBucket and by the Songs quick-browser (selects the track and section, updates the URL); loose uploads don't move the selection. Upload-button uploads only; drops have no follow-on-finish.

**No success toast** — dialog uploads show no success toast — the dialog closing and the landing flash confirm them. Known gap: a dialog closed mid-upload gives no feedback when the upload finishes or fails (see Upload button parity under On the horizon).

**Finder drops vs. Upload buttons** — a Finder drop carries its own destination: Track row / Sections background → loose file on that Track; Section row / Files column → clip in that section; Idea row / Ideas Column 2 → that Idea; Tracks-column background → song-level loose file; Ideas Column 1 background → band-wide. Finder drops no longer open UploadModal — see "Finder drops (immediate upload)". The destination mapping above is what each drop target passes to `startDropUpload`. `looseTrackId` / `announceDestination` / `initialFiles` are set only by the Extract audio action and cleared when the dialog closes; the Upload buttons never set them and follow the selection as before. Loose-file uploads invalidate `looseFileKeys.all()` (song list + every `byTrack`).

**`mode`** — `'placed'` (default) resolves a real destination and creates a `clips` row, same as always. `'loose'` skips destination resolution entirely — files land in `loose_files` scoped to `songId`, to be organized later via drag (see `loose_files` in the Tables list above). `'band-loose'` also skips destination resolution but has no `songId` at all — files land in `loose_files` with `songId: null`, scoped to the session's band instead; never pass `songId` alongside this mode. `'band-loose'` is the only mode the Ideas shelf's Column 1 "Upload Files" uses — it must work with no Idea selected, so it can't depend on a destination existing at all.

**Destination dropdown** — shown only in `'placed'` mode, at the top of the modal in a consistent position, visible before any files are added. Options format: `"{Track} → {Section}"` (e.g. `"Guitar 2 → Chorus 2"`). The selected value also displays in this format. When `defaultIdeaId` is provided, the dropdown pre-selects the matching option but the user can change it. When `defaultIdeaId` is not provided, it shows "Select Destination" placeholder. `'loose'`/`'band-loose'` show neither the dropdown nor a fixed "Uploading to" box — just a note that files are added without a destination.

**Instrument/section for physical filename** — `instrumentForUpload` and `sectionForUpload` use `defaultInstrumentName`/`defaultSectionName` props when the user hasn't changed the destination away from `defaultIdeaId`; otherwise fall back to `destTrack.name` / `destIdea.sectionName` from the DB. This matters for Ideas mode where the Dashboard passes `defaultSectionName = selectedFile.name` (the idea's display name) rather than the DB `sectionName`.

**Scrollable pending list** — `max-h-48 overflow-y-auto` with a thin custom scrollbar; scrolls when more than ~4 files are queued.

**Used in:**
- `MediaBucket.tsx` — opened by the header Upload button, "Add Files" and the Extract audio toast action; also reused, unmodified, by the SongHome Song Files tab and the Workspace Arrangement tab (both just mount `MediaBucket`)
- `Dashboard.tsx` — opened by the FILES column Upload button (Songs quick-browser, `'placed'` mode) and the Ideas shelf's Files column Upload (`'placed'`, destination always the Idea's single auto-created Folder — see "Idea-type songs" under Database above); also Column 1's "Upload Files" (`'band-loose'`), on real songs "Add Files" (`'loose'`), and the Extract audio toast action

---

## Finder drops (immediate upload)

Finder (OS) file drops upload immediately, with no dialog, on every surface: MediaBucket (Workspace, SongHome Song Files), the Library Songs quick-browser and the Ideas shelf. Upload buttons and "Add Files" still open UploadModal, unchanged.

- **Store** — `client/src/lib/drop-upload.tsx`, outside every surface, so uploads, toasts and Undo survive unmounts (including the Arrangement ↔ Production tab switch). `startDropUpload({ files, destination, label, onExtractAudio, scrollPage? })`; `files` is `takeDropFiles`'s `{ audio, video }`; destination is `{ kind:'placed', songId, ideaId }`, `{ kind:'loose', songId, trackId | null }` or `{ kind:'band-loose' }`; label is the human-readable destination built by the drop site ("Drums › Intro", the track name, the song name, the Idea name, "Ideas"). One call = one batch, files uploaded sequentially; separate drops run side by side. A failed file doesn't stop the batch.
- **Routes** — one request per file, file and row written together, the file unlinked if the row fails: `POST /api/ideas/:ideaId/clips/upload` (returns the clip + `taskAdvanced`), `POST /api/songs/:songId/loose-files/upload` (optional `trackId`), `POST /api/loose-files/unassigned/upload`. They build rows identical to UploadModal's two-step flow (placed clips go through `createClip`, so `landingClipName`, the `file-uploaded` row and `advanceTaskOnClipAdded` behave the same). Shared server helpers: `storeUploadedFile`, `storeUploadThenCreate`, `looseFileUploadMetadata`, `looseFileUploadRow`, `logLooseFileUploaded`, `afterClipUploaded`.
- **Destination and selection** — each drop target resolves its own destination (same mapping as "Finder drops vs. Upload buttons" under UploadModal Architecture) and changes the selection at drop time. Nothing moves the selection when the upload finishes; a user who navigated away stays there. The Idea row resolves its hidden section before uploading; Ideas Column 2 waits for the selected Idea's bucket to load before uploading. Either one failing → destructive toast, nothing uploaded.
- **As each file lands** — the same query invalidation as UploadModal's onSuccess for that mode, plus `requestLandingFlash`. MediaBucket passes `scrollPage` (see Landing flash); the Library's columns scroll themselves.
- **Toasts** — a progress toast appears only if the batch is still running after 1 s ("Uploading 2 of 3 files to …"). On finish it's dismissed and a new result toast appears ("Uploaded 3 files to …", partial: "Uploaded 2 of 3 files to … — kick.wav failed: <reason>") with an Undo action, at the normal toast duration. The progress toast is replaced, not updated in place: Radix sets a toast's remaining time once from its first duration, so a toast created with an infinite duration never closes after a hover. File names in these toasts are shortened to ~40 characters, keeping the start and the extension; the Undo action never shrinks.
- **Undo** — `POST /api/uploads/undo` `{ items: [{ kind:'clip', id, ideaId, taskAdvanced } | { kind:'loose-file', id, songId, trackId }] }` → per-item `undone` / `refused` + reason (400 only for a malformed body). Undo means "this upload never happened": a hard delete, the upload's own feed row deleted (found via `activity_log.clip_id`), no new feed row, and for a placed clip with `taskAdvanced` the task goes back from In Progress to To Do silently (no task comment, no feed row) if the idea has no other active clips. Audio is unlinked after commit via `unlinkUploadIfUnreferenced`. A freed real-song V-number is reused by the next upload. An item is refused unless the file is untouched: it still exists in the session's band, was uploaded by the session user, was created within the last 2 minutes, is still where it landed (same idea and active / same song and track), has no notes, no `addedToSongs`, is not Final, is not on the timeline, and has no metadata edits (detected from an upload's default metadata, no schema change). Follow-up toasts are gold: Undone / Partly undone / Not undone; only a failed Undo request is destructive.
- **Video** — `takeDropFiles` (`use-native-file-drop.tsx`, formerly `takeAudioFiles`) splits a drop: audio uploads; video (`video/*`, incl. .mov) is not uploaded and gets a gold "Video needs audio extraction" toast whose "Extract audio" action opens that surface's UploadModal with the files and the drop's destination preset (`useExtractAudioRequest`, `extractAudioModalProps`), where the existing ffmpeg extraction runs; anything else gets the unsupported-file toast, including in mixed drops. If the surface has unmounted, the action does nothing.
- **Leaving** — a `beforeunload` warning is registered while any batch is running.

---

## Spring-loaded tracks and sections (loose-file, version and Finder drags)

All in `use-loose-file-organize-dnd.ts` (`useSpringLoadedRows`, `useNativeSpringLoadedRows`; Finder-drag timing and tracker in `use-native-file-drop.tsx`); mounted in MediaBucket (Workspace, SongHome) and the Songs browser (`SongsSpringLoadedRows`), not the Ideas shelf.

- **Track spring** — a loose-file or version (`bucket-clip`) drag held over a Track row for 800ms (`SPRING_LOAD_DELAY_MS`) selects that track, as a click does. Applies to loose-file drags (Tracks column, a track's shelf) and version drags (Files column); never springs the currently selected track. A drag that springs away can spring its own track back open; a loose file's own Track row springs without the gold highlight, since dropping there does nothing.
- **Section spring** — a Section row of the selected track, held the same 800ms, selects that section, as a click does, so the Files column shows it and takes the drop. Only when `organizeDropRules.sectionRow` accepts the drag (springing and highlighting always agree: never a version's own section or a Full Take for a version); never the selected section.
- **One timer, one start selection** — both kinds of row share one timer, one `sprungRef` and one drag-start selection (track + section), so a track-then-section spring restores both.
- **Scroll guard (in-app drags only)** — when the timer fires, the pointer (tracked by the hook) must still be inside the row's live rect, or nothing opens; a list scrolled under a resting pointer can leave dnd-kit's `over` stale. Rows are found by `data-spring-row` (`springRowAttrs(dropId)`), since `over` carries no DOM node.
- **Flash** — `flashSpringOpenedColumn` flashes gold the column a spring fills: the Sections column for a track, the Files column for a section (150ms rise, 150ms hold, 900ms fade). A thin wrapper over `flashGold` (`use-landing-flash.ts`): Web Animations API, no remount, skipped under `prefers-reduced-motion`; never on a click or restore.
- **Songs browser selection** — `selectSongsSection(idea)` (state + URL with `sectionId`) is shared by the Section-row click, the Finder section drop and the spring; `selectSongsTrack` as before for tracks.
- **Restore** — a drag that ends without moving the file (Escape, release over nothing, own-track drop, cancelled placement dialog) restores the drag-start track and section, only if a spring changed them.
- **Drop report** — `handleDragEnd` calls `reportLooseFileDrop(id, 'moved')` before each mutation; Timeline reports `'deferred'` when the placement dialog opens. Version drops always report `'deferred'`, then resolve: success follows the file; failure, Cancel or Escape in the in-use dialog restores the drag-start selection. No report = no move.
- **Drag snapshot** — the drag data (`LooseFileDragData`, or `BucketClipDragData` `{ clip, type, trackId, trackName, ideaId, songId, isFullTake }`) + active id, saved at drag start by the hook's `handleDragStart` on every surface, Workspace included (Timeline's `handleDragStart` calls it): a dragged row can unmount mid-drag when a column changes, and dnd-kit then discards its data. Drops read live data first, then the snapshot (`resolveDrag`); Timeline's `handleDragEnd` falls back to its own drag-start copy the same way.
- **Finder drags** — `useNativeSpringLoadedRows` returns `{ trackHold, sectionHold }`, sharing one start-selection ref (a track-then-section Finder drag restores both); Track and Section rows pass theirs as `hold` to `useNativeFileDrop`, undefined for the selected row. `createHoldTimer` is shared with the in-app spring. After `SPRING_LOAD_DELAY_MS` the hold is due; the row opens on the next `dragover`, as a click does, and its column flashes. No scroll guard needed: `dragenter`/`dragleave` are geometric.
- **Finder drag end** — a window capture-phase tracker in `use-native-file-drop.tsx` ends the drag on a drop, the page-wide enter/leave counter reaching 0, or the first `pointermove` with non-zero movement. No accepted drop → the drag-start selection is restored. No timeouts.
- **Tracker self-heal** — every `dragover` re-arms it (active, counter ≥ 1); the start selection lasts the whole drag, cleared only by a drop or a fresh drag (`dragenter` with null `relatedTarget`, unreliable in Safari).
- **Chrome quirks** — a real Finder drag sends one zero-movement `pointermove` after a spring re-renders a column (ignored). Escape fires no event at all, so the restore lands on the next real mouse move.
- **Copy cursor** — every `useNativeFileDrop` target sets `dropEffect = 'copy'` on each `dragover`; left unset, the + badge vanished after a spring.
- **Songs browser active drag** — `SongsDragSurface` calls `useActiveOrganizeDrag()` once and shares it through `SongsActiveDragContext` (`useSongsActiveDrag()`); every Songs-browser drop target reads that. A row that calls the hook itself and mounts mid-drag (after a spring) misses `onDragStart` and never highlights. MediaBucket passes it down as a prop for the same reason.
- **Testing** — drag COPIES of audio files: a drag out of the browser window can move the Finder original.

---

## Moving real-song versions

A version (a clip in a real song's section) can be dragged out of the Files column in Workspace, SongHome and the Library Songs quick-browser (drag type `'bucket-clip'`). Plumbing in `use-loose-file-organize-dnd.ts` (`organizeDropRules`, `useVersionMoveDnd`); routes in `routes.ts`, writes in `storage.ts`.

- **Sources** — `BucketClip` (id `bucket-{id}`) and `SongsClipContextMenuCard` (id `songs-clip-{id}`). No transform; the source dims. Right-click **Remove** (soft, with the in-use check) is on both; the Library runs it through `useRemoveVersion` (`use-bucket-mutations.ts`) with one surface-level `ClipInUseDialog` in `Dashboard()`. `BucketClip` uses the same hook with its dialog inside the card.
- **Move A, to another section** — drop on a Section row, or on the Files column showing another section (same song; cross-track and cross-section via track and section springs). `POST /api/clips/:clipId/move-to-section` `{ ideaId }` (`moveClipToSection`). Renamed by `landingClipName`; Final cleared; id, `createdAt`, notes, metadata and `addedToSongs` kept.
- **Moves B/C/D, back to a loose file** — Tracks background → song-level (`trackId` null); Sections background → the track it shows; Track row → that track, **including the version's own track** (a real move, unlike loose files). Right-click "Remove from Section" = B. `POST /api/clips/:clipId/move-to-loose` `{ trackId: string | null }` (`moveClipToLoose`). Same id, original `createdAt`, named by `metadata.originalFileName` (current name if empty), notes moved to `loose_file_comments` with the same ids, audio never unlinked.
- **In-use check** — both routes answer 409 `clip-in-use` only for timeline copies or Final, never for a task change alone. Confirming releases them via `releaseClipDependencies`. One dialog per surface (`VersionMoveInUseDialog`), since the source card can unmount.
- **Tasks** — the section left: `applyTaskAfterVersionLeaves` (pre-move `isFinal`). A Move A destination: `advanceTaskOnVersionArrived` (To Do → In Progress only, by track id). A version arriving never un-completes a Complete task — Final is the user's choice.
- **Feed** — one visible row per move (`clip-moved-to-section` / `clip-moved-to-loose`). A version going loose loses its synthesized "added" and clip-comment feed rows (same as Ideas make-loose); the notes themselves are kept.
- **Not movable** — Full Take versions (`ideas.isFullTake`, never the section name): no target accepts them and both routes refuse them. Hidden ideas and tracks aren't rendered, and move-to-section / move-to-loose refuse a hidden destination.
- **View follows the file** — Move A selects the destination section; C/D select the destination track with no section; B leaves the selection.

---

## Section hide and restore

- **Hide = doesn't exist for that track.** Remove Section (per track: MediaBucket, Library Songs browser) sets `ideas.active = false` and hard-deletes that track + section's `timeline_clips`; versions, their audio and their Final marks stay. Remove Track does the same for the whole track. Production Tracker's Remove Section is song-wide: `POST /api/songs/:songId/sections/hide` (one `section-hidden` feed row).
- **Restore scope matches remove scope.** MediaBucket and the Library restore one track via `POST /api/ideas/:ideaId/restore` (`useRestoreSection`). Production restores song-wide via `POST /api/songs/:songId/sections/restore` (`useRestoreSectionSongWide`), which flips only ideas that were hidden; its list comes from `GET /api/songs/:songId/hidden-sections` (sections hidden on any visible track). A newly created idea for a track added while hidden takes the section's lowest `sortOrder` on the other tracks.
- **Task on restore** — `taskStatusAfterRestore` (`shared/clip-dependents.ts`), via `applyTaskAfterRestore` on per-idea, song-wide and track restore, only for ideas actually hidden: Complete with no timeline clips → In Progress (active versions) or To Do (none); In Progress with no versions → To Do; To Do and Will Not Play unchanged. System comment, sort-only `task-auto-reverted` row. Never touches `isFinal` — a restored Final version keeps its badge with an In Progress task.
- **Library Remove Track / Remove Section are confirmed** (dialogs in `Dashboard()`); MediaBucket's are not. Library clears its selection only when the removed row was selected.

---

## Timeline layout and arrangement order

Rules for the timeline's data and layout. They apply to the client, `shared/` and the server alike. The client internals (refs, preview wiring, veils, outlines, edge scroll, z-order) are in `client/src/components/daw/CLAUDE.md`.

- **One layout for everything** — `layoutTimeline({ sections, clips, bpm, timeSignature })` in `shared/timelineLayout.ts` is used by the timeline, Export and the server (`computeSongLayout` in `storage.ts`). Never add another layout copy. Beat maths lives in `shared/musicalTime.ts` (the client's `musical-time.ts` re-exports it).
- **Rules** — clip position = its section's start + `section_offset`. Only sections with at least one non-full-take clip appear. Section length, in whole beats = max(`base_length` ?? 0, content need rounded up to the next beat, 1). Content need = the furthest clip end (offset + trimmed length) across all tracks (`sectionContentNeeds` / `contentNeedBeats`, shared by the layout and the server's base-length clamp). Every section starts on a beat; bar 1 = song time 0; no stored BPM = 120. Legacy full takes keep their stored absolute start and stay outside sections. A section with clips but no row is an orphan, laid out after all rows, alphabetically.
- **Base length** — `song_sections.base_length` is whole beats (NULL = fit to content, max 4096), so a tempo change keeps a section's bars. Written only by `PUT /api/songs/:songId/sections/base-length` (`setSongSectionBaseLength`): a value at or below the content need is stored as NULL, not refused; 400 for a bad body or no row; 409 for a section with no timeline clips. Reset to NULL when a section gets its first clip back. No client calls the route yet.
- **Pickups ("cut, don't push")** — a negative `section_offset` is a pickup: it belongs to its section but starts before the downbeat (it may end before it too). Earliest start: `pickupLeftLimit` = the latest of one bar before the section, song time 0, and the end of the previous clip on its track. A pickup never moves a section and adds to no section's length; where there isn't room the layout cuts its head (`clipHeadCuts`) and the stored offset stays, so the full pickup comes back when room returns. A clip cut to nothing isn't drawn or played. Server writes are lenient: an offset at or after the clip's current offset is always allowed (`pickupOffsetError`).
- **No packing** — clips are not contiguous and nothing re-packs. Remove leaves a gap; Replace keeps the clip's offset and is cut short (`trimEnd`) where the next clip starts (not the last clip in a section); trims change only the trimmed clip; Smart Clear keeps finals at their offsets. Appends (menu "Add to Timeline", POST clips or place-on-timeline without `sectionOffset`) go after the furthest clip end on that track in that section (`appendOffset`); the server picks the offset. Placement helpers live in `shared/timelinePlacement.ts`, used by client and server.
- **Two section orders, on purpose** — the arrangement order is `song_sections.sort_order` (timeline, Export, server layout, clip in-use dialog). The filing order is `ideas.sortOrder` (Media Bucket, Library browser, Production Tracker, hidden-sections and restore, every section picker, `getBucket`, `getSongById`). A timeline reorder never changes the filing order; Add Section still appends at the bottom of it.
- **Section reorder** — `PUT /api/songs/:songId/sections/order` `{ section, before, after }` moves only that row within the song's full list and renumbers every row 0…n−1 (shared `moveSection` in `shared/sectionOrder.ts`; the client's optimistic update uses the same function). A drag with no target, or Esc, sends nothing.
- **A section's first clip** — when a section goes from 0 to 1 non-full-take timeline clips, `placeSectionInArrangement` places it where the clip was dropped. POST clips and place-on-timeline take an optional hint `{ before, after }` (`firstClipHintAt`: left half of a section → before it, right half → after it, past the last section's midpoint → the end). No hint → after the last section on the timeline; a bad hint falls back to the end, never an error. A section that loses its last clip keeps its row, ignored until its next first clip.
- **What the server checks** — clips on one track in one section never overlap: every write path checks and answers 409, rolling back the whole request. Offsets must be finite (400); a negative offset must respect the pickup limits (400); a new clip is never a pickup. Batch moves go through `PUT /api/songs/:songId/timeline-clips/offsets` `{ clips: [{ id, sectionOffset }] }` (one transaction). A new clip and the clips it pushes are one `POST /api/tracks/:trackId/clips` with `pushed: [{ id, sectionOffset }]` (same track and section only, pushes only move later, a pickup is never pushed). A loose file placed at a position is one `POST /api/loose-files/:id/place-on-timeline` with `id`, `sectionOffset`, `pushed` (the section must already be on the timeline, 409 otherwise; on any failure the file stays loose). `PATCH /api/timeline-clips/:id` takes a field whitelist: `name, type, color, src, duration, trimStart, trimEnd, bucketClipId, isFinal, sectionOffset`. Full route contracts: the api-reference skill.
- **Polls and live sync** — the timeline and `['song-sections', songId]` queries poll every 3 s while the Timeline is mounted. Live sync takes clips and offsets from the server as they are, orders each section by offset, and never re-packs or writes. Both polls are held during any edit whose preview isn't saved yet (clip, trim, version and loose-file drags, through the save and the refetch after it), and any response already in flight is dropped.
- **Activity** — position saves log the sort-only `timeline-reordered`; base-length writes the sort-only `section-length-changed`. Neither shows in the feed.
- **Export** — plays each clip from its layout start (full takes from their stored start) and from `trimStart` + head cut, skipping zero-length clips; length = the end of the last section or of any clip past it.
- **Smart Clear ("Leave Final Clips")** — one transaction: deletes non-final clips (gaps stay) and refreshes the remaining clips' `start` cache from the layout. Never moves a final full take; never touches `song_sections`.

---

## Timeline placement rules

How a drag, trim or drop decides where a clip lands. The core lives in `shared/timelinePlacement.ts`; the server enforces the hard limits.

- **Gaps model** — a clip lands in the free gap the pointer points at among the other clips on its track in its section (`placeInGap`; inside a clip, its first half picks the gap before it, its second half the gap after). If it fits, it lands at the wanted spot clamped into the gap and nothing else moves; if not, it lands at the gap's start and every clip from the gap's end on moves later by its length, gaps kept. No clip ever moves earlier: no reorders or swaps. Snap runs first (`snapDragStart`, then `placeDraggedClip`). A release on the clip's own drawn spot saves nothing (`placementChanged`).
- **Where each drag can land** — a timeline clip stays on its own track in its home section; only the pointer's horizontal position counts, anywhere over the timeline, and a release off the timeline cancels. A Media Bucket version does the same on its own track and section (a version whose section isn't on the timeline starts that section). A loose file lands on the track row and the section under the pointer, the section taken from the **stored** layout (before the drag's growth), and only where that track has the section folder; a release with no landing outline does nothing, a release with one asks to confirm, and a release past the last section on a track with off-timeline folders asks which new section to start at the end. File drags never land by dnd-kit's `over`.
- **Snap** — on by default (Bar / 1/4 / 1/8 / 1/16, magnet on/off, per browser). A dragged clip's start snaps to the nearest of: the grid, its section's start, flush against another clip on the track, the pickup limit, and its own current spot. Shift or magnet off places freely. Applies to clip, version and loose-file drags, never to trims.
- **Pickups** — only Option creates one, on a drag or a left trim. A clip that is already a pickup moves within the pickup area without Option until it lands on or after the downbeat; crossing back then needs Option. A file drop, an append, Replace and apply-to-instances never create one. A normal clip stops at a pickup's end and never moves it.
- **Trims** — free, no snap. Both edges stop at the neighbouring clips on the same track in the same section (`trimNeighbours` / `clampTrim`); the right edge also stops at a later section's pickup (`nextPickupStop`); a section's last clip can grow past the section's end. A left trim moves the clip's start with the audio. Minimum clip length 0.5 s, or the whole file if shorter (`MIN_TRIM_LENGTH` / `minTrimLength`). Every trim write goes through `writeTimelineClipTrim`.
- **Failures and cancels** — every drop or drag save shows its result at once and, if the server refuses, rolls everything back on screen with a destructive toast. Esc and losing window focus cancel a drag or trim.

---

## Landing flash

After a file lands (version moves, Remove from Section, organize, assign/un-assign, Ideas moves, make-loose, uploads) it scrolls into view in its own column and flashes gold. One module: `client/src/hooks/use-landing-flash.ts`.

- **Request / match** — the shared mutation paths (`use-bucket-mutations.ts`, `UploadModal`) call `requestLandingFlash({ id, zone }[])`; each row or card calls `useLandingFlash(id, zone, ref)` with its own id and a zone from its own data. Zones: `clip:<ideaId>`, `track:<trackId>`, `song:<songId>`, `band`. Matching on zone means a stale row at the old location never flashes. Works whether the row mounts before or after the request; requests expire after ~6s.
- **Scrolling** — only the file's own scroller (Radix viewport or `overflow-y` auto/scroll ancestor), never `scrollIntoView`, so the page, the timeline and overflow-hidden parents never move. A multi-file batch scrolls the minimum to show all of them when they fit, otherwise the topmost. Instant under `prefers-reduced-motion`. Exception: `requestLandingFlash` takes an opt-in `scrollPage`. When the file's own column can't scroll (SongHome Song Files, whose columns grow and the page scrolls), it scrolls the page by the minimum needed. Only MediaBucket drop uploads pass it; every other landing path still never scrolls the page.
- **`flashGold`** — row/card peak `LANDING_FLASH_PEAK_ALPHA` (0.36); the spring column flash is a thin wrapper with its original look. Under `prefers-reduced-motion`: no animation, a static gold ring for ~1.5s (the column flash just skips).
- **Rows and cards** — `BucketClip`, `SongsClipContextMenuCard`, `IdeaClipCard`, `LooseFileRow`. Cards flash via `WaveformPlayerCard`'s `cardRef`. Make-loose flashes only the Ideas Column 1 row; the preview card never takes a landing flash.
- **Timeline** — every file landing on the timeline glows gold (`flashGold` `look: 'outerGlow'`): Place on Timeline, "Add to Timeline", and version and loose-file drops once saved. Moving a clip already on the timeline doesn't. A placed loose file is also shown in the Media Bucket without changing its selection. Details: "Placement feedback" in `client/src/components/daw/CLAUDE.md`.
- **Arrival links** — `?file=<id>` (Add to Song / Promote toasts) and `?clipId=` scroll to and flash the file in MediaBucket. The old 3-second `?file=` ring is gone.

---

## Timeline clip look

- **Origin** — restyled Oct 2026 from the "PatchBay Timeline Sandbox" prototype. `TimelineClip` lives in `Clip.tsx` (there is no `TimelineClip.tsx`).
- **Body** — `clipBodyColor(trackColor)` = `color-mix(in srgb, <trackColor> 24%, #181C26)`. `#181C26` is `CLIP_BODY_SURFACE` in `track-color.ts`; no theme token exists for it. `color-mix` resolves `hsl(var(--chart-N))` fine (Safari 16.2+).
- **Border** — 1px `clipBorderColor(trackColor)` (`color-mix` 70% into transparent), drawn as its own `aria-hidden` `pointer-events-none absolute inset-0 rounded-md` layer at `z-[5]` (above the canvas at z-2, below the label/final badge at z-10). Never on the root: the selection overlay (`inset-0 border-2`, `z-[19]`) sits inside any root border, so a selected clip showed a colored line outside the gold. Now the selection covers the border exactly — nothing of the clip shows outside the selection box.
- **Root** — paints nothing itself: no background, border or shadow. The body (`data-clip-body`), border, waveform and pickup marker are layers inside a clipped `rounded-md overflow-hidden` box, so a torn edge can clip them. The `flashGold` placement glow (the root's box-shadow) is the only thing that paints outside a clip.
- **Torn edges** — a trimmed side (or a pickup's head cut) is drawn as a fine zigzag (`tornEdges` / `TornEdgeLines` in `Clip.tsx`): body, waveform, border, selection outline and hover ring all follow it, with square corners on that side.
- **Pickup marker** — the part of a pickup before its section's start is dimmed (`PickupMarker`, `bg-black/35`, z-6).
- **While dragged** — the clip floats (`isRaised`: z 12, opacity 0.85) over its `data-clip-drag-lift` shadow layer (z 11), under the dashed landing outline (z 13).
- **Waveform** — canvas, one column per CSS pixel from the min to the max sample, in the track color, canvas CSS opacity 0.5. Canvas `fillStyle` cannot resolve `var()`, so the canvas element's CSS `color` is set to `trackColor` and `drawRef` reads `getComputedStyle(canvas).color`. The redraw effect depends on `trackColor`. A "blocky" style (2px bars in 3px slots) was tried and rejected in favor of this one.
- **Name** — top-left (absolute row, `pt-1 pl-1.5`), `text-[10px] leading-none font-semibold text-white/90` with a subtle text shadow, `min-w-0` so it truncates; the row's `pr-5` keeps it clear of the Final badge. Moved out of the clip's middle so it doesn't sit where you watch while trimming. No grip icon (it was decorative; the whole clip is the drag handle).
- **Section divider** — `SectionCell`'s divider is an inset box-shadow (`inset -1px 0 0 hsl(var(--border)/0.2)`), not `border-r`, which would take the cell's last pixel column.
- **Unchanged by the restyle** — `CornerBadge`, the gold selection overlay, the grey hover inset glow, the blue detected-trim overlay and its Apply/Dismiss buttons, `flashGold`, `LooseFileDragOverlay`.

---

## Auth Architecture

Session-based auth using `express-session` (server-side sessions, cookie transport) and `bcrypt` (password hashing, cost 10).

### Server setup (`server/index.ts`)

The session secret is `process.env.SESSION_SECRET`, falling back to `"patchbay-dev-secret"` in development; production refuses to start if it is unset. Sessions are stored by a custom `BetterSqlite3Store` (`server/session-store.ts`) in a `sessions` table in the same SQLite file, pruned on boot and every 15 minutes where `expired_at < now`. Cookie `maxAge` is 7 days; every request touches the session and pushes its expiry out.

`storage.seedUsers()` is called at startup. It inserts the six core users (jordan, alex, jamie, sam, taylor, riley — all lowercase, all with password "password") using `INSERT OR IGNORE` semantics — safe to call on every boot. `storage.backfillBands()`, which runs immediately after, also seeds "Band B" and its demo user "zed" (password "password") using the same existence-check pattern. `storage.ensureDemoBand()` runs right after that (see "Demo login" below). No manual `band-admin.ts` step is required.

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

**Cross-tab session sync.** The session cookie is shared by every tab in a browser profile (and Chrome shares one cookie store across all incognito windows), so a login in one tab silently changes who every other tab is on the server. `AuthProvider` therefore re-checks `GET /api/auth/me` on `focus` / `visibilitychange`: a different user id → `queryClient.clear()` + switch user; 401 → user `null` (route guard → `/login`); same id → no-op. `login()`/`logout()` also broadcast on a `patchbay-auth` `BroadcastChannel` so other tabs re-check immediately. **Testing multiple users needs separate browser profiles** (e.g. Chrome + Safari), not two tabs or two incognito windows. Check the avatar initials before writing a note: the server takes the author from the session cookie, not from the page.

### Route guard (`client/src/App.tsx`)

`RequireAuth` component: returns `null` while `isLoading`, renders `<Redirect to="/login" />` if `!user`, otherwise renders children. All non-login routes are wrapped in it. The `/login` route itself redirects to `/?tab=dashboard` if the user is already authenticated (`!isLoading && user`).

### Demo login

A public demo for reviewers: the login page's "Check out a demo project" button logs the visitor in as a guest in the demo band **Glass Harbor**.

- **Band and users** — `storage.ensureDemoBand()` runs at boot right after `backfillBands()`. It ensures the band `demo-band` ("Glass Harbor") and users `demo-guest` (username `guest`), `demo-mara`, `demo-theo` and `demo-kai` exist, each inserted with its `bandId` in the same write (never via `createUser`, which sets `bandId` null and would let `backfillBands` move the user into The Zenith Passage). Existing users are never updated, so passwords set at first boot stay. A taken username is logged and skipped, never a crash.
- **Passwords** — mara, theo and kai get the bcrypt hash of `DEMO_PASSWORD`; if it is unset they are skipped with one log line. The guest's password is the hash of 96 random hex characters, so nobody can log in as guest with a password.
- **Login route** — `POST /api/auth/demo` needs no existing session. It sets `req.session.userId`/`bandId` exactly as `POST /api/auth/login` does and returns the same response shape plus `demoSongId`: the demo band's most recently updated real song (`type = 'song'`, ordered by `updatedAt` then `createdAt`), or null. Returns 503 `{ message: "The demo isn't available right now." }` if the guest is missing.
- **Client** — `loginAsDemo(onSuccess)` in `AuthContext` shares its response handling with `login`. It navigates to `/songs/:songId/workspace?tab=arrangement`, or to `/?tab=dashboard` when `demoSongId` is null. The navigation happens in the same step as setting the user, so the `/login` already-authenticated redirect can't win the race.
- **Welcome dialog** — a successful demo login sets the sessionStorage flag `patchbay-demo-welcome = pending`. `DemoWelcomeDialog` (`client/src/components/DemoWelcomeDialog.tsx`), mounted once in `App.tsx` for signed-in users, opens only when the flag is pending and the user is `demo-guest`. Every way of closing it clears the flag, so it shows once per demo login, not on refresh. The guest id and flag helpers live in `client/src/lib/demo.ts`.
- **Uploads off for the guest only** — `rejectDemoGuestUpload` runs before multer on every route that accepts a file (`POST /api/upload`, `POST /api/ideas/:ideaId/clips/upload`, `POST /api/songs/:songId/loose-files/upload`, `POST /api/loose-files/unassigned/upload`, `POST /api/songs/:songId/reviews`) and returns 403 `{ message: "Uploads are turned off in the demo." }`. Add to Song and Promote to Song re-upload through `POST /api/upload`, so they fail for the guest too. The demo bandmates can upload normally.
- **Content** — built by hand on the live site, logged in as mara, theo and kai. There is no seeding, reset or cleanup: a visitor's changes persist until fixed by hand. The landing song is whichever real song was edited most recently, so the showcase song should be the last one edited.

### AppHeader dropdowns (`client/src/components/AppHeader.tsx`)

The header right side has two separate dropdowns — no combined settings menu:

- **Gear icon** → workspace dropdown: Project Settings, Manage Access. No section label.
- **Avatar button** (shows user initials) → user dropdown: Notification Settings, Profile Settings, then a divider and Sign Out. Sign Out calls `logout()` from `useAuth()` then `setLocation('/login')` via wouter. No section label.

This split keeps workspace-level actions (shared settings, collaborator access) separate from per-user actions (personal preferences, session management).

**Project Settings modal** — opened via the gear dropdown's "Project Settings" item. Reads current values from `useQuery(['settings'])` and seeds draft state via `openProjectSettings()`. Contains three editable fields: Default BPM (number input), Default Tracks (inline tag editor), and Default Sections (inline tag editor). Tag editors render existing values as removable pills; an inline text input appears when the `+` Add button is clicked (autoFocus, confirmed on Enter or blur, dismissed on Escape). Footer has "Restore Defaults" on the left (resets draft to `FACTORY_INSTRUMENTS` / `FACTORY_SECTIONS` / `FACTORY_BPM` — does not save automatically) and Cancel / Save Changes on the right. Save calls `PATCH /api/settings` via `useMutation`; on success invalidates `['settings']` and closes the modal. `FACTORY_INSTRUMENTS`, `FACTORY_SECTIONS`, and `FACTORY_BPM` are module-level constants in `AppHeader.tsx` (not imported from Dashboard).

**New Project modal pre-population** — `Dashboard.tsx` fetches settings via `useQuery(['settings'])`. Opening the New Project modal calls `openProjectModal()` which seeds `newBpm`, `newSections`, and `newInstruments` from the live settings cache before setting `isNewProjectOpen = true`. `closeModal()` is separate and only closes + clears the name field — it no longer resets form state, so `openProjectModal()` is the single source of truth for initial values. `createSong.mutationFn` falls back to `settings?.defaultSections` / `settings?.defaultInstruments` when the user hasn't modified those fields.

### Seeded users

**The Zenith Passage** (default band — seeded by `seedUsers()` + `backfillBands()`):

| Username | Password |
|---|---|
| jordan | password |
| alex | password |
| jamie | password |
| sam | password |
| taylor | password |
| riley | password |

**Band B** (demo fixture — seeded by `backfillBands()`):

| Username | Password |
|---|---|
| zed | password |

**Glass Harbor** (public demo — seeded by `ensureDemoBand()`):

| Username | Password |
|---|---|
| guest | none usable — reached only through the demo button |
| mara | `DEMO_PASSWORD` |
| theo | `DEMO_PASSWORD` |
| kai | `DEMO_PASSWORD` |

All three bands and their users are seeded automatically on every server boot — no manual `band-admin.ts` step required. All usernames are lowercase. Passwords are bcrypt-hashed at cost 10 and are never returned by any API route.

### Author fields throughout the app

- **Client** — most comment/mark-final flows send author-adjacent data from
  `useAuth()`, but author resolution is inconsistent across comment types.
  **`task_comments` and `song_review_comments`** resolve `author` server-side
  from `req.session.userId` and structurally ignore any `author` in the
  request body (the type annotation marks it `author?: string` but it's never
  read). **`clip_comments`** now does too (fixed Oct 2026 — the body `author`
  `ClipInfoWindow` still sends is ignored); **`lyrics_comments`** and
  **`loose_file_comments`** follow the same pattern. Edit and delete are
  **author-only** (403 otherwise, case-insensitive) on `clip_comments` and
  `loose_file_comments`.
- **Server** — `uploadedBy` (file upload) and `createdBy` (review upload) are resolved server-side via `req.session.userId → storage.getUser()`, falling back to `'Unknown'`. Never trust `author` from the request body for these two fields.
- **System comments** (status changes, clip-final events) use `author: 'System'` — never the request body author. Automatic task comments from `reconcileSectionTaskStatus`, the Remove route and the Production tab route are `System`; every other task comment author comes from the session, never the body.

### Dynamic user list

`GET /api/users` is fetched via `useQuery(['users'])` in any component that needs a member list (assignee dropdowns in ProductionTracker, @ mention autocomplete in ClipInfoWindow, ReviewPlayer, ProductionTracker task comments, and Lyrics comments). TanStack Query deduplicates the request — all components share one network call per query key. The route is `requireBand`-scoped via `storage.getUsersByBand(req.bandId!)` (fixed Sept 2026 — previously returned every user across all bands) and sorted alphabetically by username (`orderBy(asc(users.username))`, also added Sept 2026) — every consumer gets a correctly-scoped, alphabetically-ordered list with no client-side filtering or sorting needed.

Submitted comments containing a real `@username` render it in bold + gold via the shared `MentionText` component (`client/src/components/MentionText.tsx`), used identically by ClipInfoWindow, ReviewPlayer, ProductionTracker task comments, and Lyrics comments — see "Replies, resolved state, and @ mentions" in `.claude/skills/lyrics/SKILL.md` for detail.

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
- **Clip positions come only from `layoutTimeline`** — section start + `section_offset`. Never read the stored `timeline_clips.start` for a sectioned clip, never send it from the client, and never compute positions outside the shared module (no new layout copies in Timeline, Export or the server). A clip's drawn/played in-point and length come from `playedSpan` (head cuts included), never a local formula.
- **Do not add overlap capability to the timeline** — PatchBay is plug-and-play, not a freeform DAW. Clips on the same track cannot overlap under any circumstances; the server refuses any write that would (409). Within a section a clip lands in a gap, and when the gap is too small the later clips move later together (`placeInGap`); a section's first clip can also place the section between two others or at the end (see "Timeline placement rules").
- **Never use `ideas.sortOrder` for timeline order, or `song_sections.sort_order` for the Media Bucket, Production Tracker or pickers** — two orders by design; see "Timeline layout and arrangement order".
- **Drag horizontal position comes from the shared drag pointer source, never `activatorEvent.clientX + delta.x`** — dnd-kit's `delta` already includes scrolling of the dragged node's scroll containers, so adding `scrollLeft` counts it twice (this made the header-drag line race to the end). This covers timeline clip drags too (`dragPointerTime`).
- **Nothing re-packs a section** — no write path may close gaps or recompute other clips' offsets (Remove, Replace, trims, Smart Clear, appends, sync). A clip moves only when it is dragged, pushed later by a placement, or its own left edge is trimmed.
- **Hold both timeline polls for any edit whose preview isn't saved yet** — clip, trim, version and loose-file drags hold them through the save and the refetch (`holdPollsForClipDrag` / `takeClipDragHold`, `trim-busy`), and drop in-flight responses. A new drag or edit kind must do the same, or a poll snaps the preview back.
- **Pickups are created only with Option** — on drags and left trims; never by a file drop, an append, Replace or apply-to-instances. Nothing ever moves to make room for a pickup: the layout cuts it.
- **The loose-file confirm dialog's light backdrop (`data-light-backdrop` in `index.css`) relies on the standard Dialog rendering its overlay as the element right before `DialogContent`** (`[data-state]:has(+ [data-light-backdrop])`). Recheck it if `components/ui/dialog` is ever regenerated or upgraded.
- **dnd-kit's auto-scroll never moves the timeline or a file-browser column** — the timeline edge-scrolls with `createEdgeScroller` (`client/src/lib/edge-scroller.ts`), and the Media Bucket and Library Songs columns with `useColumnEdgeScroll` (`client/src/hooks/use-column-edge-scroll.ts`, columns marked `data-column-scroll`). Every `DndContext` rendering them (Timeline, SongHome, Dashboard) excludes them from dnd-kit's `autoScroll` (`isColumnScrollElement`); otherwise they scroll twice.
- **Every gold insertion line goes through `SplitInsertionLine`** — never draw one directly; the sticky header row otherwise paints over it.
- **`PATCH /api/timeline-clips/:id` takes a field whitelist** — add a field to it deliberately; never spread the request body.
- **Never put the timeline clip's track border on the root element or as a root box-shadow** — `flashGold` animates the root's box-shadow and the selection overlay sits inside a root border. Use the inside border layer (see "Timeline clip look").
- **Never pass a CSS-variable color string (e.g. `hsl(var(--chart-1))`) to a canvas `fillStyle`** — canvas silently ignores it and draws black. Resolve it first via `getComputedStyle` on an element styled with that color.
- **Never give `SectionCell` a layout border (`border-r` etc.)** — it eats the cell's last pixel and clips the last clip. Use a box-shadow divider.
- **Do not remove Replit-specific vite plugins without updating `vite.config.ts`** — they are conditionally loaded only when `REPL_ID` is set, so they do no harm locally.
- **Do not set `isFinal` on clips or `timeline_clips` outside the established three-entry-point sync** — `PATCH /api/clips/:clipId`, `PATCH /api/timeline-clips/:id`, and `PATCH /api/production-tasks/:id` all cascade `isFinal` changes across bucket clips, timeline clips, and production task status using the same-name rule. A one-off `isFinal` write (direct DB update, ad-hoc route, or storage method call) will silently desync the three tables, leave stale checkmarks on same-name clip instances, and create inconsistent "Complete" task states. Always go through one of the three established entry points. See the "Same-name rule" section under isFinal ↔ task status bidirectional sync. **Approved fourth path:** Remove, move-to-section and move-to-loose clear Final on that one clip via `releaseClipDependencies`, then recompute the section's task. Never call `PATCH /api/clips` with `isFinal` for this — the same-name sync would un-final other clips.
- **Every write of `trimStart`/`trimEnd` on `timeline_clips` goes through `writeTimelineClipTrim` (`storage.ts`)** — used by `PATCH /api/timeline-clips/:id/trim`, apply/reset trim on all instances, and Replace (via `PATCH /api/timeline-clips/:id` → `updateTimelineClipKeepingSpot`). It enforces the minimum length, the neighbour and pickup limits, and moves `section_offset` with `trimStart`. Never write trim values with an ad-hoc DB update. `clip.duration` is never modified by trim — it always stores the full file length.
- **Query keys: always use `bucketKeys` from `client/src/lib/bucket-api.ts`** — never raw `['bucket', ...]` literals. This prevents drift when the key shape changes.
- **Any mutation that changes loose-file state must invalidate `bucketKeys.bucket`, not just the more specific `looseFileKeys.*` keys, whenever anything cached on the bucket response depends on it.** The bucket response (`GET /api/songs/:id/bucket`) now carries computed per-track fields like `hasLooseFiles` (drives the Tracks-column folder-fill icon) — a mutation that invalidates only `looseFileKeys.list`/`byTrack`/`unassigned` leaves that computed field stale until a manual reload, even though the more specific lists refresh correctly. This was missed on both `useDeleteLooseFile` and `useAssignLooseFileTrack` and needed two separate follow-up fixes — when adding a new loose-file mutation, invalidate `bucketKeys.bucket(songId)` by default rather than assuming the narrower keys are sufficient.
- **Bucket mutations live in `client/src/hooks/use-bucket-mutations.ts`** — surface-specific post-success behavior (auto-select, navigation, pending refs) goes in `onCreated` callbacks at the call site, not inside the hooks themselves.
- **Never force-remount a component via a `key` bump to refresh data** — invalidate the right query key instead. A `key` bump destroys all local state and races against any async callbacks that fire after the unmount.
- **Shared creation modals live in `client/src/components/daw/modals/`** — `AddInstrumentModal` and `AddSectionModal` are controlled presentational components; error state and mutation pending state come from the parent. Both accept `onClearError?: () => void` — the modal calls it on every input keystroke so the parent can clear a stale error message. Always pass this prop at call sites that set an error state.
- **Section "remove" is per-instrument soft-hide (`useHideIdea`)** — right-clicking a section in the bucket hides that idea for one instrument only (sets `active = false` on the `ideas` row) and is fully restorable. A song-wide section-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists and `useDeleteSection` was removed from the hook file as unused; do not re-add it without a product decision on whether full section deletion belongs in the UI.
- **Do not add heuristic fallbacks to `onAddToTimeline` or `handleDragEnd`** — track resolution must use the `trackId` carried in drag data / passed by `BucketClip`. Section resolution must read `clip.sectionName` directly. Previous versions used substring track-name matching with a silent `tracks[0]` fallback and derived sectionName by parsing the clip's filename — both silently misplaced clips, especially for idea-sourced uploads whose names are raw filenames. If `trackId` or `sectionName` is missing, warn loudly and bail.
- **Never omit `requireBand` from an API route** — every route under `/api/` must include `requireBand` as middleware. Routes without it bypass band scoping entirely and expose all bands' data. See the Route ownership rules section under Bands (multi-tenancy).
- **Never spread a partial/request-body object into Drizzle `.values()` or an ON CONFLICT `set:`** — build a filtered object with only the defined keys first. See the "Partial updates" rule under Bands (multi-tenancy). Drizzle safely skips `undefined` in plain `.set()` UPDATEs, but JS spread in `.values()` + conflict upsert will overwrite NOT NULL columns with `undefined` before Drizzle sees the data.
- **When adding a route that touches two independent entity IDs, assert ownership on both** — `assertSongOwned` / `assertAlbumOwned` only cover the single ID passed in; they say nothing about any other ID in the same request body or URL. See the "Two-ID routes" rule under Bands (multi-tenancy).
- **In `Dashboard.tsx`, every `useDroppable`, `useDraggable`, `useActiveOrganizeDrag` and `useDragSurfaceAttrs` call must live in a child component rendered inside the `DndContext`** — `Dashboard()` itself sits outside it, so a hook called there silently never registers.
- **Songs quick-browser `'assign-track'` selects the Track directly (`selectSongsTrack`), not via `pendingInstrumentIdRef`** — that ref is only consumed when the bucket data changes, and an assign-track can leave it unchanged.
- **Ideas shelf `IdeaClipCard` drag handle is the `<div>` `IdeaFileContextMenu` clones** — the play button, waveform canvas and `CornerBadge` stop left-button `pointerdown`, so they never start a drag; don't move the handle onto `WaveformPlayerCard`.
- **Ideas shelf: the dragged file's own Idea row stays an enabled droppable that cancels** (no highlight) — disabling it would let the drop fall through to whatever lies beneath.
- **Never apply the dnd-kit drag `transform` to a file-browser source (`LooseFileRow`, `BucketClip`, `SongsClipContextMenuCard`, Ideas cards)** — every surface already renders a `DragOverlay` ghost; a translated source grows its column's scroll width and dnd-kit auto-scroll shifts the column sideways. Dim the source instead.
- **Comment-badge unread checks use `hasUnreadComments(latestOthersCommentAt, lastViewed)`** (`Clip.tsx`) — never `latestCommentAt`, or your own notes show as unread to you.
- **Live comment queries need `refetchOnWindowFocus: 'always'`, not `true`** — the global `staleTime: Infinity` means `true` never fires. Use the shared `liveCommentRefetch` options (`bucket-api.ts`) on ONE observer per query per surface: every observer runs its own interval, so never add it to per-clip queries in `TimelineClip`/`BucketClip` (`useLiveClipCommentSummary` is the per-surface driver).
- **`POST /api/clips/:clipId/comments/copy-from` is not idempotent** — each call re-copies the source's notes. The client must call it exactly once per copy.
- **Ideas shelf Column 1 background (`ideas-shelf-bg||`) is a fallback drop target** — Idea rows always win over it, and it is enabled only for idea-clip drags (make-loose).
- **After an organize drop, invalidate the DESTINATION song's file list (`refetchType: 'all'`), not just the selected song's** — with `staleTime: Infinity` the destination otherwise shows a stale list.
- **Drag ghosts** — every file drag (versions, loose files, Ideas files) uses `LooseFileDragOverlay`: a small chip 4px below-right of the pointer (`CURSOR_GAP_PX`), so it never covers the targeted row. A `DragOverlay` always renders a wrapper the size of the dragged source, so `LooseFileDragOverlay` sizes it to the ghost (`width: 'max-content'`) — otherwise `restrictToWindowEdges` clamps the source-sized box and a wide card pins the ghost far from the cursor. Mount exactly one `DragOverlay` per `DndContext` (the wrapper renders during any drag, even empty). Nothing reads the overlay's rect; placement uses the pointer. Timeline clip drags have no `DragOverlay`: the clip itself floats in its row (see "Timeline clip drags" in `client/src/components/daw/CLAUDE.md`).
- **Drop highlights come from `organizeDropRules`** — one rule per bucket target, with a branch per drag type (`loose-file`, `bucket-clip`); a target highlights on `isOver` AND its rule, never `isOver` alone. Drop targets read the active drag from `useActiveOrganizeDrag` (`useDndMonitor`), not `useDndContext`.
- **Workspace collisions ignore the timeline while the pointer is over MediaBucket** (`[data-media-bucket]` in `trackFirstCollision`) — track rows match on Y alone and stay measured when scrolled away, so a release on bucket blank space could otherwise place or reorder a clip. Version and loose-file drags drop by the pointer, never by `over`; for them only Media Bucket targets ever match, and only while the pointer is inside the bucket.
- **Ideas shelf selection** — previewing a loose file clears the selected Idea and the URL's `ideaId`. Column 2's button reads "Upload to <Idea>" (into the selected Idea) or "Upload" (band-wide, nothing selected); a Finder drop on Column 2 follows the same rule, and accepts nothing while a loose preview shows.
- **Ideas shelf blank-click deselect** — a click on Column 1's blank space (row gaps, padding, the 48px `pb-12` band after the last row) clears the selected Idea or loose preview. It counts only if both the press and the click land on the list wrapper, so a drag released over blank space never deselects.
- **Ideas shelf organized-file menu** — adds Remove from Idea (same as dropping on Column 1: `make-loose`, shared `makeIdeaClipLoose`) and Delete (`POST /api/clips/:clipId/delete`, no confirmation). Neither appears on the loose-file preview, whose Delete removes the loose file.
- **Ideas clip Delete** — cascades the clip's notes; unlinks the audio only if no other row shares its `src` (`unlinkUploadIfUnreferenced`, shared with `deleteLooseFile`). Refuses real-song (use Remove), Final and timeline-placed clips with 409.
- **Ideas shelf preview card drag** — `IdeaLooseFilePreviewCard` uses the Column 1 row's loose-file payload, with drag id `loose-preview-{id}` (the row has `loose-{id}`). Only Idea rows accept it; Column 2 is `disabled` while a preview shows.
- **No hover styling during drags (`drag-surface`)** — MediaBucket's root, the Songs quick-browser (`SongsDragSurface`) and the Ideas shelf's Column 1 carry `DRAG_SURFACE_GROUP` plus `useDragSurfaceAttrs()` (`data-dnd-active` during any dnd-kit drag). Rows use `not-group-data-[dnd-active]/drag-surface:hover:*` (`DRAG_SURFACE_ROW_HOVER`), as does `WaveformPlayerCard`, so only real drop highlights light up mid-drag. One shared group name because shared rows appear on several surfaces and Tailwind needs it literally. The Ideas preview handle has `focus-visible:outline-none`.
- **Every Finder (OS file) drop target uses `useNativeFileDrop` (`client/src/hooks/use-native-file-drop.tsx`)** — never hand-rolled `onDragOver`/`onDragLeave`/`onDrop`. It reacts only to `dataTransfer.types` containing `'Files'` (dnd-kit drags never fire native events), stops propagation so a row wins over its column, counts dragenter/dragleave instead of using `relatedTarget` (null in Safari → flicker), and cancels `dragenter` as well as `dragover` and `drop` (`preventDefault`, `dropEffect = 'copy'`) — a disabled target included — so the browser never navigates to the dropped file. `dragenter` matters: when the pointer crosses into a new element, Chrome fires only `dragenter`/`dragleave` for that update, and a release on it with an uncancelled `dragenter` opened the file in a new tab with no `drop` event. A hand-rolled drop zone (UploadModal's box) must cancel `dragenter` too.
- **Released Finder files must never open in the browser** — `useWindowFileDropGuard` (mounted once in `App.tsx`) cancels `dragenter`/`dragover`/`drop` for any file drag no target took, with `dropEffect = 'none'`. Targets stop propagation, so it sees only leftovers; it skips `defaultPrevented` events, `<input type="file">` and non-file drags.
- **Finder-drop feedback must never change layout** — no inserted banners, no border-width or padding changes. Rows recolor their existing `border border-transparent` (`NATIVE_DROP_ROW_CLASS`); column blank space gets a tint + inset ring (`NATIVE_DROP_COLUMN_CLASS`, a box-shadow). An in-flow "Drop to upload" banner used to push every row down 39px, making the top row unreachable and churning enter/leave as rows jumped under the pointer. Empty-state text ("No files yet") stays static.
- **`instrument_tracks.pan` writes only go through `PATCH /api/tracks/:trackId`** — same single write path as `volume`; there is no separate pan-specific route. Do not add one.
- **Fill in a column production depends on with a step that runs even when the column already exists** — never only when it's missing. A fill-in that ran only when `production_tasks.track_id` was missing left 213 tasks unlinked in production; the startup self-heal (`relinkNullTaskTracks`) now covers it.
- **Production DB ops: the Railway container has no `sqlite3` CLI** — use a one-off `better-sqlite3` script over `railway ssh`, and download the volume's `.db`/`-wal`/`-shm` first (Hobby plan: no automated backups).
- **Songs browser drop targets read `useSongsActiveDrag()`, never `useActiveOrganizeDrag()` directly** — see "Spring-loaded tracks and sections".
- **Never change a task's stored status when hiding a section or track** — the cell is disabled; restore recomputes it (`taskStatusAfterRestore`).
- **Task and task-comment write routes must call `assertTaskEditable`** — never inside storage functions, which server-internal writes use.
- **Drizzle `max()` over a raw `sql` expression returns a string** — `Number()` it before `new Date()` (it crashed the unread badges with "Invalid time value").
- **`onConflictDoNothing()` on `production_tasks` only catches a repeated id** — with `randomUUID()` ids it never fires, and no unique index covers track + section; check for an existing task before inserting one.
- **Never treat a non-2xx answer as data** — use `apiRequest` (throws on non-2xx) or check `res.ok`; never `fetch(url).then(r => r.json())`, which turns a 404 body into data (it crashed SongHome and took the dev server down). Older call sites still do it; see "On the horizon".
- **Never derive a dnd-kit droppable's `id` from the current selection** — dnd-kit re-registers a droppable on every id change and can lose its rect, swallowing the next drop. Use a fixed id (e.g. `bucketVersionsDropId('media-bucket-files-column')`) and read the destination from `over.data.current`.
- **Drizzle `sql\`\`` templates drop table qualifiers on interpolated columns** — `${ideas.trackId} = ${productionTasks.trackId}` compiled to `"track_id" = "track_id"`, comparing a column with itself. Write fully qualified names in correlated subqueries and print the generated SQL.
- **Finder drops go through `startDropUpload`, never UploadModal** — the only drop-related path into UploadModal is the Extract audio toast action.
- **Never create a toast with an infinite duration and later update it to a finite one** — Radix keeps the first duration's remaining time, so it never closes after a hover. Dismiss it and show a new toast.
- **Toasts (`use-toast.ts`)** — `TOAST_LIMIT` is 3, closed toasts are removed after 1 s and don't count toward the limit. A toast closed by mouse (action or X) releases focus to the page; without that, Radix keeps focus in the toast area and every toast's timer stays paused. Keyboard closes keep Radix's default. Radix also pauses all toast timers while the window is blurred — expected during a Finder drop (Finder has focus); the timer starts when the user returns.
- **Upload Undo never writes a feed row** — it deletes the upload's own row instead.
- **Dev server: only one copy can run at a time (port 3001), and Derek may be running it in his own terminal.** Claude Code may restart it when needed, but always stop every running copy first with `pkill -f tsx`, then start it with `npm run dev`. After restarting, tell Derek, since the copy in his terminal will have stopped.
- **Never read a file's stored `color` for display** — use the track-color helper (`client/src/lib/track-color.ts`) and pass a `trackColor` prop. Never override `clip.color` on the clip object to do it: Replace and bucket → timeline placement copy `clip.color` into new rows. See "File display color" under Database.
- **Never set clip `playbackRate` from bpm** — tempo describes the grid and metronome and must never time-stretch recordings. Clips always play at their recorded speed.
- **Never draw timeline gridlines with a CSS `background-size` tile** — fractional tile sizes get rounded and drift away from clips on long songs. Use the `BeatGrid` SVG pattern (see "Musical grid" in `client/src/components/daw/CLAUDE.md`).
- **Don't put the Transport row back on fixed `w-1/3` thirds** — wider left content spills under the center group's transparent box and its controls stop receiving clicks (this happened to the time signature Select). See "Transport row layout" in `client/src/components/daw/CLAUDE.md`.
- **Every route that accepts a file must call `rejectDemoGuestUpload` before multer runs** — it returns 403 for the demo guest. A new upload route without it lets public demo visitors write to the production disk.
- **Look up the demo band and users by id (`demo-band`, `demo-guest`, …), never by name** — `bands.name` isn't unique, and existing boot code already looks bands up by name.
- **Never navigate to bare `/` after a login** — use `/?tab=dashboard` (or the demo's Workspace landing). See "Tab persistence and bare-URL resolution".

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

## Deep-Dive Architecture Notes — Where They Live

To keep this file loadable in every session without bloating context, subsystem-specific
implementation notes have moved to files that load only when relevant. The safety-critical
"never do X" rules from these areas are already restated in "What To Avoid" above — nothing
load-bearing depends on these loading at the right moment.

| Topic | Location | Loads when |
|---|---|---|
| Timeline drag-and-drop internals (section columns, drop targets and collisions, clip/version/loose-file drags and their previews, drag pointer source, insertion lines, edge scroll, snap controls, poll holds and live sync, stale-closure rules), audio playback system and tempo source, musical grid (bars/beats helper, BeatGrid, ruler marks), Transport row layout, track panning (Web Audio graph, `panNodesRef`/`ensurePanNode`), Safari playback-start failure (parked investigation), non-destructive trim + AI trim detection, apply/reset trim to instances, Media Bucket internals (add section, hidden-tracks invalidation, empty state, session persistence, new-content indicator), Timeline Selection, clip session notes / More Info panel, Musical Intelligence & Meta Tags, timeline clip waveform, Timeline background/clip right-click menus, placement feedback, keyboard shortcuts, pinch-to-zoom, AlertDialog focus management, Sticky Panel & Scroll Guards, Timeline playhead & occlusion, Production Tracker scroll container architecture, clip trim visual redesign, shared CornerBadge component (final/comment badge styling, used by both TimelineClip and WaveformPlayerCard) | `client/src/components/daw/CLAUDE.md` | Editing a file under `client/src/components/daw/` |
| Bands (multi-tenancy) schema, startup backfill, session plumbing, storage additions, Phase 2 query scoping, route ownership rules, band admin & first-login | `server/CLAUDE.md` | Editing a file under `server/` |
| isFinal ↔ task-status bidirectional sync, Complete status guard, clip addition → task in-progress, Replace flow isFinal handling | `.claude/skills/isfinal-sync/SKILL.md` | Working on final-clip / task-status logic |
| Review tab architecture (waveform player, comments, @mentions, avatar markers) | `.claude/skills/review-tab/SKILL.md` | Working on the Review tab |
| Lyrics tab architecture (autosave textarea, select-to-comment anchoring, replies/resolved/@mentions, composer positioning, browser-timing gotchas) | `.claude/skills/lyrics/SKILL.md` | Working on the Lyrics tab |
| Activity feed architecture, Promote to Song | `.claude/skills/activity-feed/SKILL.md` | Working on the activity feed or Dashboard |
| Full API endpoint reference | `.claude/skills/api-reference/SKILL.md` | Adding or modifying an API route |
| Feature-by-feature build status ("Core Features & Status") | `.claude/skills/feature-status/SKILL.md` | Checking whether a feature is built |
| Deployment (Railway) steps, schema migration safety (why `drizzle-kit push` is banned from production) | `.claude/skills/deploy/SKILL.md` | Deploying the app, or making any change to `shared/schema.ts` |

## Doc Sync & Permissions

**Master vs. codebase copy:** This document (`CLAUDE.md`) is authored and maintained as a master
copy in a Claude.ai Project. The codebase's root `CLAUDE.md` is a derived, trimmed copy — never
the source of truth. If the two ever disagree, the Claude.ai master wins.

**Sync workflow:**
1. Edit the master in the Claude.ai Project.
2. Paste the full updated master over the codebase's root `CLAUDE.md`.
3. Run `/sync-claudemd` to route subsystem-specific sections back out to their split files
   (`client/src/components/daw/CLAUDE.md`, `server/CLAUDE.md`, and the task-specific
   `.claude/skills/*/` folders — see the "Deep-Dive Architecture Notes" table above), trimming
   root back down.
4. Expect root `CLAUDE.md` to look noticeably shorter than the master at all times — that's
   intentional, not drift.

**Known gaps in this process (no automated enforcement yet):**
- Sync is manual — if a master edit isn't pasted + synced, the codebase silently runs on a stale
  copy indefinitely. Treat "sync after every master edit" as a required last step, not optional.
- If a split file is edited directly mid-session (e.g. patching `isfinal-sync/SKILL.md` while
  debugging a real bug), that change does NOT automatically flow back into the master. Fold any
  such edits back into the Claude.ai master by hand, or the two will silently diverge.

**Permission mode:** Claude Code's global default is `auto` (routine actions approved by a
safety classifier rather than prompting every time). Auto mode auto-approves plain `git push`,
including to `main`, by default — it only holds back force-push, remote branch/tag deletion,
history rewrites, and pushes to deploy-named branches (`production`, `release`, `gh-pages`).
**PatchBay's Railway deployment auto-builds and deploys on every push to `main`.** Until
2026-08-11, `npm start`'s `prestart` hook ran `drizzle-kit push --force` on every boot, which
skipped Drizzle's normal confirmation for destructive schema changes and caused a full
production crash loop that day (see "Schema changes — drizzle-kit push is banned from
production" in `.claude/skills/deploy/SKILL.md` for the incident and fix). That specific hook
has since been removed — `npm start` now runs `node dist/index.cjs` directly, with no
drizzle-kit involved at boot. The underlying exposure remains, just narrower: a plain `git push`
to `main` still applies whatever is on the branch straight to production with no review gate, so
any other breaking change (code or schema) ships the same way. An explicit override is set in
`~/.claude/settings.json` (user scope — applies to all projects, not just PatchBay):
`"permissions": { "ask": ["Bash(git push *)"] }`. This forces every `git push` to prompt for
confirmation regardless of what the classifier would otherwise decide. **Do not remove this
rule** — it wasn't what caught the 2026-08-11 incident (that fix was reviewed before pushing),
but it remains the only gate standing between any future unreviewed change and production.

## CLAUDE.md Maintenance

**2026-08-11 — ran Claude Code's `/doctor` health check on the PatchBay codebase.** Installation,
extensions, hooks, and version all came back healthy. The one real finding: the codebase's copy
of this document was 258,533 characters and loaded in full into every Claude Code session
regardless of task — about 6.5x the size where Claude Code normally warns about an oversized
context file.

**Decision — split the codebase copy only** into a small root file plus subsystem-specific files
that load only when relevant. No content was deleted, just relocated. See "Doc Sync &
Permissions" above for the ongoing workflow this created.

**Also changed — set Claude Code's permission mode to `auto` globally.** Surfaced the deploy
risk described above; added an explicit `ask` override for `git push` (see "Doc Sync &
Permissions" above) as the compensating control.

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

2. ~~**Authentication provider:**~~ **Resolved.** Basic session auth is implemented using `express-session` + `bcrypt`. Eleven seeded users exist across three bands: six on The Zenith Passage (jordan/alex/jamie/sam/taylor/riley), zed on Band B, and guest/mara/theo/kai on the Glass Harbor public demo. Role-based permissions (Band Leader / Band Member / Engineer) are the next auth milestone — they are defined in the data model but not yet enforced.

3. **Real-time vs async:** The spec calls for async collaboration to start. WebSockets (`ws`)
   is installed. Leave real-time for a future milestone.

4. ~~**Song sections as user-defined vs enum:**~~ **Resolved, then superseded (Nov 2026).** `songs.sections` is only the creation-time list. The filing order is `ideas.sortOrder`; the arrangement order is `song_sections.sort_order` (see "Timeline layout and arrangement order").

---

## Known Issues

- **Midnight Horizon (`patchbay-default`) has 33 sections with no task row** — old test sections; gap accepted.
- **`PATCH /api/production-tasks/:id` passes the whole body (minus `author`) to `updateTask`** — a hand-made request could null `trackId`; the app never sends one and the self-heal repairs it next boot. Planned: allow only status/assignee/due date and similar.
- **Focus ring on draggable cards/rows** — dnd-kit makes them focusable, so the browser ring can show after a click or a canceled drag. `focus-visible:outline-none` fixes it per element (done on `BucketClip`, `TimelineClip`, `IdeaClipCard`, the Ideas preview card and the Songs browser cards); a sweep of the rest is planned.
- **Playback stutter / fails to start on first press (Safari) — parked, unresolved** — the original minor stutter on pressing play is still unexplained on its own (unrelated to the session-state persistence work). This session confirmed a related but more severe symptom via manual testing in real Safari.app: playback fails to start on first press more than 50% of the time. Root cause not yet isolated — a code-level race in `Timeline.tsx`'s rAF playback loop (`audio.play()` firing before `ensurePanNode()`'s Web Audio graph wiring completes, no gate between them) is a lead, not a confirmed cause. Could not be reproduced via headless WebKit (Playwright) as a Safari proxy — real Safari.app is required for any future investigation. Full investigation notes and the headless-repro gotcha: see "Safari playback-start failure" in `client/src/components/daw/CLAUDE.md`.
- **Deleting the currently-looped section correctly disables looping** — the generalized disable-on-reposition watcher catches the transition from a real section to `null` (no section) the same way it catches any other section change, so `isLooping` is set to `false` and `loop-force-disabled` is dispatched cleanly. No lingering state issue.
- **`activity_log.author` is nullable; pre-existing rows have `author=null`** — the column was retrofitted after initial `activity_log` usage. Rows written before the retrofit have no author and will not contribute to any user's personalized "Your Songs" sort. This is acceptable — those events are old and the sort degrades gracefully to `createdAt` for songs with no user-attributed activity.
- **Playhead visual position vs. scroll-state desync — suspected, unconfirmed** — during manual testing of the edge-scroll rebuild, two screenshots appeared to show the rendered playhead position and the actual scroll state disagreeing. Investigated via headless Playwright automation with frame-by-frame position sampling through a full held-drag-and-release cycle; no discontinuity exceeding normal per-frame movement was found in that environment. Per this project's own precedent with the Safari playback-start-failure investigation (never reproducible in headless WebKit despite being real on real hardware), a clean headless result is not proof the desync doesn't exist on real hardware — treat as open, not resolved, pending a deliberate real-browser reproduction attempt.
- **Playhead release snap — suspected, unconfirmed** — a visible snap was reported at the moment of releasing the pointer during active edge-scroll. The fix believed responsible for this class of bug (deferring time-value updates to the rAF loop instead of firing on every pointermove event during active edge-scroll, to prevent render-scheduling contention) was confirmed still intact in the code after the later redesign, but the snap itself was not reproducible via headless Playwright automation (no main-thread stalls or frame gaps found near release across multiple targeted repro attempts). Same caveat as the visual-desync item above — treat as open pending real-browser confirmation.
- **Songs browser URL after an organize drop** — the section is selected on screen but the URL has no `sectionId`.
- **Real-song file cards have no Delete** — only Remove; a dedicated delete session is planned.
- **Home "Your Songs" Delete shows no error toast** — a failed delete is silent there.
- **437 foreign-key violations from older deletes** — orphan tracks/tasks/task comments; they block nothing.
- **MediaBucket and Library Songs Files lists are unsorted** — `getBucket` has no `ORDER BY` on clips; only the Ideas shelf's Column 2 sorts (name, natural and case-insensitive, then `createdAt`).
- **Ideas clips and loose files have no Download menu item** — `buildDownloadFilename` already handles their naming; adding one is a one-line call per menu.
- **Multi-file upload partial failure** — UploadModal only: files that already landed stay in the pending list (Confirm again re-uploads them), and get no invalidation or landing flash. Finder drops don't have this.
- **UploadModal two-step upload can orphan audio** — if the create request fails after `POST /api/upload`, the file stays in `uploads/` with no row. Finder drops use one-request routes and clean up.
- **Old upload routes hang on a nonexistent `ideaId`** — `POST /api/upload` / `POST /api/ideas/:ideaId/clips` never respond. The new `/clips/upload` route answers 404.
- **6 `clips` rows point to audio missing from `uploads/`** — older data; not repaired.
- **Other SongHome landing paths don't scroll the page** — only drop uploads use `scrollPage`.
- **Escape can't cancel some Finder drags** — when the file wasn't already selected in Finder before the drag started (macOS drag-session behavior, outside the app).
- **Timeline content pop-in on page load (parked, low priority)** — `tracks` starts as an empty array on mount; the entire track/clip grid (headers, section bands, clips, waveforms) appears in a single commit when `GET /api/songs/:id/timeline` resolves (~130–140ms locally; could be worse in production). No loading skeleton exists. Confirmed via real-browser testing to be pre-existing and independent of the scroll-persistence work (see "Timeline — session persistence" in `client/src/components/daw/CLAUDE.md`). A secondary, related effect: individual clip waveforms decode and render asynchronously per-clip after the grid appears, with no ordering guarantee tied to track position — decode time appears to scale with clip duration/file size rather than screen position, so a top-of-list track can render its waveform after a lower one. Proper fix (loading skeleton or suspense boundary) is a bigger scope decision, not a quick patch — not scheduled.
- **Library version cards show "Already Final" with no Unmark** — MediaBucket can unmark; parity planned.
- **Library version cards have no Download** — same one-line fix as Ideas clips and loose files.
- **Track-scoped loose files on a removed track are unreachable** — they stay on the hidden track's shelf; same in MediaBucket.
- **`createTrack` sets section `sortOrder` by list position**, not the other tracks' values — a gap in the numbers misaligns the new track.
- **The normal `?taskId=` deep link never clears the param** — a refetch can reopen the task modal.
- **Tasks with no `ideas` row can't be flagged hidden** — six old demo songs plus two "Sort Test" songs; harmless.
- **Songs with null `bpm` show and use 120** — all Ideas plus a few test songs; display only, nothing writes a value to the DB.
- **Demo visitors' changes persist** — the Glass Harbor demo has no reset or cleanup; anything a visitor rearranges or deletes stays until fixed by hand. Check the demo before sending the link to someone important.
- **Demo guest can't use Add to Song or Promote to Song** — both re-upload through the blocked `POST /api/upload`. Could be fixed later by copying the src server-side.
- **Metronome starts late after pause/play** — the first click comes late, then a quick catch-up click. Pre-existing (confirmed on production before the layout rebuild); not investigated yet.
- **Stored `timeline_clips.start` is stale on many rows** — cache only; Smart Clear, Place on Timeline and POST clips refresh it for the clips they write. Nothing reads it for sectioned clips.
- **Export can disagree with the layout for 5 s fallback clips** — when `trimEnd` is null Export plays the decoded length; if a clip's stored duration is the upload's 5 s fallback, the audio and its layout slot differ.
- **Song-wide `DELETE /api/songs/:songId/sections/:name` leaves timeline clips** — it deletes the `song_sections` row but not the clips (latent: no UI calls it). Those clips would lay out as orphans.
- **The playhead keeps its own copy of the edge-scroll logic** — it shares constants with `createEdgeScroller` (`client/src/lib/edge-scroller.ts`) but not code.
- **Timeline's `uiRestored` ref is never reset when `songId` changes (latent)** — the one-shot restore of mute/solo, scroll and selection runs once per mount. If Timeline stays mounted while `songId` changes (`Workspace.tsx` renders it without a `key`), the new song's saved UI state isn't restored. Not seen in practice yet.
- **The dev server exits when an open browser tab reports a client error** — the whole `npm run dev` process stops, not just the page. Restart it (see "Dev server" under What To Avoid).

---

## Albums
- Albums are non-exclusive ordered containers. They are NOT lifecycle status — never use membership
  to mean "in demo phase"; that's a future songs.status field.
- No type field on albums by design: hardcore bands ship EPs named "demo 2026" — the name carries meaning.
- **Schema:** `albums` (id, name, createdAt — no type, no status). `album_songs` join (albumId, songId,
  sortOrder). Cascade: deleting an album deletes its `album_songs` rows but NEVER deletes songs.
  The `songs` table is untouched by album operations.
- **Endpoints:**
  `GET/POST /api/albums` · `PATCH/DELETE /api/albums/:id` · `GET/POST /api/albums/:id/songs` ·
  `DELETE /api/albums/:id/songs/:songId` · `PATCH /api/albums/:id/songs/:songId/move` (body: `{ direction: 'up' | 'down' }`) ·
  `GET /api/album-memberships` (flat rows; client builds `songId → albumNames[]` map).
- **Query keys:** `['albums']` (list) · `['album-songs', albumId]` (tracklist) · `['album-memberships']`
  (membership map). All three are invalidated by every membership mutation (add, remove, move).
- **Ordering:** server assigns `sortOrder = max(existing) + 1` on add (append); Move Up/Down swaps
  the two adjacent rows' `sortOrder` values. Song picker appends in songs-list order. Future:
  drag-reorder replaces Move Up/Down.
- **Duplicate album names:** rejected client-side case-insensitively in `handleCreateAlbum` /
  `handleRenameAlbum`; the API itself allows them (consistent with sections/tracks convention).
- **UI surface** (all in `Dashboard.tsx`): Library filter pill (`filter=albums`), two-column browser
  (albums column + numbered tracklist), Add Album modal (shared-modal conventions), song picker
  (header `+` / empty-state button — see picker bullet below), Add to Album context submenu on song
  rows in the Songs browser. Tracklist rows click → Song Home. Song rows show a Disc icon + tooltip
  membership indicator only; full membership editing is in the album browser, not the song row.
- shadcn TooltipContent gotcha: overriding bg without setting text color leaves text-primary-foreground
  (near-black in this theme) — always set text color when restyling tooltips dark.
- Album membership has two doors by design: song-side right-click (encounter intent, single) and
  album-side picker via tracklist `+` / empty state (curation intent, batch). The picker adds only —
  ordering stays in the tracklist.
- Album song picker: `isAlbumSongPickerOpen` state; opened by Tracklist column header `+` (hover-reveal,
  enabled only when album is selected) and by the empty-tracklist "+ Add songs" button. Shows all
  `type === 'song'` entries; already-in-album rows are checked + disabled + "already added" label.
  POSTs each selected song sequentially in list order (append semantics), then invalidates the three
  query keys once and shows a gold toast.
- Album selection is URL-state (`albumId` param), same pattern as `songId` in the Songs browser —
  refresh and deep links restore selection. Uses a separate `appliedAlbumSearchRef` (not the shared
  `appliedSearchRef`) so it isn't pre-empted by the `[songs, search]` effect. Any future Library
  browser must join this convention. Deselection is natural: navigating to any other filter drops the
  `albumId` param from the URL.

## Creation chooser pattern

- Header creation button is **"+ Create New"** (not "New Project") — opens the chooser dialog titled
  **"Create new…"** with Song / Idea / Album cards. Button + dialog title form a sentence.
- New creatable types get a card in this chooser — do not add a separate button to the header.
- **Deliberate-choice pattern is intentional (taxonomy protection):** do not replace the chooser with
  a default-action split button. The three entity types (Song / Idea / Album) are distinct enough
  that defaulting to one would train users to misfile content.
- Album card: closes the chooser and opens the existing `isAddAlbumOpen` / Add Album modal.
  `createAlbumMutation.onSuccess` navigates to `/?tab=files&filter=albums` and sets `selectedAlbum`
  so the new album is highlighted in the Albums browser immediately on arrival.

## Bands (multi-tenancy)

PatchBay is multi-tenant: each band sees only its own songs, albums, and ideas. The tenancy model
is intentionally server-side and session-bound — the `bandId` a user sees is the one stored in
the `users` table, resolved at login and cached in the session. It is never read from client input
or URL parameters.

### Tenancy rule — same class as `isFinal`

> **The band a session belongs to is always resolved server-side from `req.session.bandId` (set
> at login) or from `users.bandId` (lazy-populated by `enrichSessionBand` for pre-existing
> sessions). Never use a bandId from the request body or URL params for scoping queries.**

Violating this rule lets a user scope queries to a band they don't belong to, exactly as setting
`isFinal` outside the three established entry points silently desyncs the bucket/timeline/tasks.

## On the horizon

- **Manual drag-to-reorder (tracks + sections)** — track `sortOrder` data is now clean and ready; sections `sortOrder` is now clean too (fixed by section-add redesign).
- **Section row-label right-click trigger has no visual affordance** — Production Tracker's sticky left column section labels are right-clickable ("Remove Section") but there's no hover indicator, unlike track column headers' hover-reveal `+`. Consider a tooltip or hover-reveal `···` button.
- ~~**Activity feed feed-worthiness audit (not started)**~~ **Resolved 2026-08-12.** Every Tier 2 event type was audited and classified feed-visible vs. sort-only, and that classification is now enforced server-side via a `notInArray` filter in `getActivity()` — previously it was documentation intent only, and every sort-only type leaked through as a visible feed row. Full per-type classification and rationale: see "Tier 2 event types — full reference" in `.claude/skills/activity-feed/SKILL.md`.
- **Media Bucket clip name truncation not working** — `WaveformPlayerCard`'s clip name text never truncates with an ellipsis regardless of available width or name length; full text always renders. Not yet investigated — likely a `min-w-0` missing on a flex ancestor between the name `<span>` and the outer card container, but unconfirmed. Surfaced while testing the CornerBadge unification (Aug 2026); may be pre-existing and unrelated to that change.
- ~~**Idea Shelf: instrument-assigned but not song-assigned ideas**~~ **Resolved, then flattened further (Sept 2026).** The Library "Ideas" tab was originally built as a three-level hierarchy — Ideas → Parts (Folders) → Files — as a UI-level repurposing of the same Song/InstrumentFolder/Idea tables real songs use. It is now a **flat two-level structure: Idea → Files directly, with no Folder/Part-selection step in the UI at all.** "Ideas" are still `songs` rows with `type = 'idea'` (`Dashboard.tsx` filters `songs.filter(s => s.type === 'idea')`). Under the hood, each idea-type song still has exactly one `instrument_tracks` row + one paired `ideas` row — but it's now auto-created and never surfaced, via `storage.ensureIdeaDefaultFolder(songId)` (called at idea creation, defensively on every bucket fetch, and from the songs-list route), rather than user-created via an "Add Folder" action. So the underlying clip/idea data model didn't need to change — only the UI's navigation depth did; `addPartMutation` and the "Add Folder" modal were deleted outright, not just hidden. `GET /api/songs` now also returns `defaultTrackId`/`defaultSectionName` per idea-type song, so a Column-1 Idea row can itself be a drag-and-drop organize target for a loose file without first being opened. Column 2 (Files) renders the flattened union of clips across every track/idea the song has — normally exactly one, but this stays correct even for a hypothetical legacy idea that ended up with more than one (checked before building: none currently do). **The known follow-up risk from the old three-level design is now moot** — `instrumentTracks.name`/`ideas.sectionName` drift on rename can't happen because there's no UI to rename the (invisible, fixed-named `"Files"`) Folder at all. What's still true from before: the right-click context menu on a shelf file (More Info, Add Note, Add to Song, Promote to Song, no Mark as Final) is unchanged; `Add to Song` still fully copies the clip (new `clips` row, re-uploaded file, `isFinal: false` always, no live link back), and since Oct 2026 also carries the source's key/BPM/tags/time signature and its notes; the `clips.addedToSongs` "belongs to song X" badge is still a denormalized snapshot, not a live join, and can go stale on a rename elsewhere. New in the flattened version: a loose file — band-wide/unassigned (visible in the Ideas list itself, Column 1) or scoped to one Idea (visible in that Idea's flat file list) — can be dragged onto an Idea to organize it in, and **clicking a loose file loads a one-off preview into the Files column** (a new interaction with no prior precedent elsewhere in the app; Workspace/Songs quick-browser only ever preview already-placed clips), taking selection-highlight priority over whatever Idea was previously selected until dismissed or a different Idea is chosen. **Further update (loose-file delete rollout, Sept 2026):** the right-click context menu described above is now a single shared `IdeaFileContextMenu` component (`Dashboard.tsx`) used by both the organized-clip cards (`clips.map`) and the loose-file preview card — previously the preview had no context menu at all (a bare `WaveformPlayerCard`, fixed in the same rollout after being found missing entirely). The dead `{selectedFile?.type !== 'idea' && <Mark as Final>}` branch (this menu only ever renders inside the Ideas-shelf's idea-type flow, so the condition was always false) was dropped during the extraction — no behavior change. Menu items now behave per-source: **More Info and Add Note open the loose file's own notes** (`loose_file_comments`, Oct 2026) with metadata editable (`PATCH /api/loose-files/:id/metadata`) — see `loose_files` in the Database table. **Add to Song and Promote to Song work identically for a loose file** via a `looseFileAsApiClip()` adapter — see "Add to Song" / "Promote to Song" in `.claude/skills/activity-feed/SKILL.md` for the full mechanism, the loose-file adapter, and why the source-update PATCH is skipped for a loose source. And the preview card now also carries **Delete** (`DELETE /api/loose-files/:id`, no confirmation) as a trailing menu item — see `loose_files` in the Database table above.
- **App-wide `fetch(...).then(r => r.json())` sweep** — the rule is in What To Avoid; `SongHome.tsx`'s four queries were fixed, the pattern remains in `Dashboard.tsx`, `Clip.tsx`, `ProductionTracker.tsx`, `Timeline.tsx` and the `['song', songId]` query. Plan: a recon prompt to enumerate every remaining call site, then one implementation pass converting them all to `apiRequest`. Includes the `['song', songId]` query in `SongHome.tsx`, which has a related, unfixed symptom: a Band B user opening a Band A song URL directly gets a silent 404-as-fake-data render (a broken/empty Song Home) rather than a clean error — fixing the fetch will surface a `useQuery` error state, but `SongHome.tsx` has no UI branch for it yet. A "This song isn't available" state needs to be added alongside the fetch fix. Not started.
- ~~**`clip_comments` author-trust gap**~~ **Resolved Oct 2026** — see "Author fields" above.
- **Band-wide loose-file upload has no Activity Feed entry** — `activity_log.songId` is `NOT NULL`, and an unassigned loose file has no song yet, so there's nowhere to log it until it's organized onto an Idea (which does log correctly today). Fix would need `songId` nullable + a `bandId` column on `activity_log`, plus a UI decision for where an unscoped entry renders (likely Dashboard's global feed). Schema change is low-risk; the UI placement decision is the real work. Not committed to — revisit if the visibility gap becomes a real problem in practice.
- ~~**More Info and Add Note for loose files**~~ **Resolved Oct 2026** — notes live in `loose_file_comments` and move with the file on organize; see `loose_files` in the Database table. Editable metadata for loose files followed (Oct 2026), via `PATCH /api/loose-files/:id/metadata`.
- **Real-song clip deletion (a real `clips` row)** — Ideas-shelf clips can be deleted (`POST /api/clips/:clipId/delete`), but real-song versions only have Remove (soft, with the in-use check — see "Remove and the in-use check" in `client/src/components/daw/CLAUDE.md`). A real-song Delete is still planned (see Known Issues).
- **Remove → Delete rename** — the version menu's "Remove" is planned to become "Delete" in a separate audit.
- **Loose-file preview on song surfaces** — clicking a loose file in Workspace, SongHome or the Songs quick-browser shows a preview card in the Files column, modelled on the Ideas shelf. Open: effect on the selected section, where the selection is remembered, Workspace playback, whether moves B/C/D should open it. Planned in its own chat.
- **Upload button parity** — the Songs quick-browser's Files-column Upload asks for a section; Workspace/SongHome's header Upload uploads loose files. Decide one model, likely alongside the loose-file preview. Also decide whether dialog uploads should confirm the same way as drops (toast, Undo), and give feedback when a dialog is closed mid-upload — today there is none.
- **Feed comment links could scroll to the exact comment** — they open More Info but don't scroll to the comment. Not a bug; possible improvement.
- **Spring-loaded Idea rows (Ideas shelf)** — its own piece of work: Column 2 isn't ready when a spring fires (the Idea's bucket loads after selection), idea-clip drags have no drag-start snapshot, and restore has three states (an Idea, a loose preview, nothing).
- **Spring restore scrolls with `scrollIntoView`** — restoring a selection scrolls the selected row into view, which can scroll ancestors; switch to the landing flash's own-scroller helper.
- **`instrument`/`section` URL params after Timeline scrolls** — decide whether to consume them too (they stay after the arrival-link cleanup), so a refresh falls back to the saved selection.
- **Retention and hard-delete policy** — removal only hides files for now. Before charging for storage, decide when hidden content is actually deleted (never, after N days, explicit "empty trash"), whether hidden files count toward quota, and how Remove vs Delete is explained. Ties together the paused undo model, real-song Delete and the R2 move; the shared-`src` unlink guard carries over.
- **Full Take removal** — the concept is being removed; don't build or test around it.
- **Spring hover style** — possible subtle "will open" hover for rows that spring but don't accept the drop.
- **User-added tracks are always gold** — `POST /api/songs/:songId/tracks` defaults to `hsl(var(--chart-1))` and the client sends only `{ name }`, so every added track matches Drums. Likely should rotate through the palette like the seeded tracks.
- **`--primary` and `--chart-1` are different strings for the same gold** — files stored `hsl(var(--primary))` and tracks stored `hsl(var(--chart-1))` look identical but never compare equal. Matters for any future color comparison or repair query.
- **Stored file color columns** — unused for display and stale on some rows. Decide whether to repair them to their track's color once, stop writing them, or drop them; a production count is needed first.
- **Library version cards have no color edge** — MediaBucket's version cards show the track color on their left edge; `SongsClipContextMenuCard` shows none. Parity optional.
- **Files-column card restyle** — `WaveformPlayerCard` (MediaBucket, SongHome, Library Songs browser, Ideas shelf, loose-file preview) still has the old look. Considering the timeline clip look; needs a recon first (shared component, different waveform code with playback progress, trackless loose files need a neutral non-gold tint).
- **Section-header drag ghost and track header stripe read raw `track.color`** — the ghost still draws solid bars, out of step with the clips and wrong for a null-color track; the stripe has the same raw read. Both should use `trackDisplayColor`.
- **2px seam between adjacent timeline clips** — each draws its own 1px border. Possible follow-up.
- **Invalid-drop veil and read comment badge tuned for bright fills** — the veil (`rgba(0,0,0,0.5)`) and the read comment badge (`bg-white/25`) need checking against the dark clip body.
- **Timeline waveform rescans every sample on each redraw** — including every zoom tick; caching peaks would help on long clips.
- **Timeline placement model** — the "sections grow" model was chosen (Oct 2026). Built: steps 1–3 (stored per-clip offsets, `song_sections`, the shared layout engine) and step 4a–4g1 (clips drawn at row level, pointer-driven drags with the gaps model, snap and Shift, live section growth, pickups and head cuts, trims that stop at neighbours, version and loose-file drops with live preview, the base-length route). See "Timeline placement rules".
- **Timeline placement rebuild, what's left** — the section-end handle UI (calls the existing base-length route), Option ring-over (`tailSeconds` is 0 for now), nudge keys, timeline copy/cut/paste with references, File Browser "Copy file to" / "Move file to", full takes, and a regression pass. The design spec is kept in the Claude.ai Project (the timeline placement spec), not in the repo.
- **"Copy section to ▸ [section]"** on the section header's right-click menu — copies a section's clips on all tracks into another section as references, keeping their offsets. Planned with timeline copy/paste.
- **Repeated sections (the same section placed twice) — undecided.** Today each section appears once; repeats use separately named sections.
